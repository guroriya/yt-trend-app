#!/usr/bin/env node
/* scripts/collect.mjs — 収集の入口（ORDER §4 / §6 P1・P2）
 *
 *   node scripts/collect.mjs                       … 実行すべきジョブだけ走らせる
 *   node scripts/collect.mjs --jobs=top24h,map     … ジョブを指定
 *   node scripts/collect.mjs --force               … 間隔を無視して全ジョブ
 *   node scripts/collect.mjs --dry-run             … 予算表と実行予定を出すだけ（API を叩かない）
 *
 * 環境変数: YT_API_KEY（GitHub Secrets からのみ渡す。ログには絶対に出さない）
 * 出力: public/data/*.json（公開）と state/（内部・git に入れない）
 */

import { join } from 'node:path';
import {
  BACKFILL, CATEGORIES, COUNTRIES, SECTIONS, PERIODS, MAP_COUNTRIES, QUOTA, RETENTION, SEARCH_Q, datasetId,
} from '../public/js/config.js';
import {
  DATA_DIR, STATE_DIR, chunk, ensureDir, listDir, log, parseArgs, quotaDate, readJSON, writeJSON,
} from './lib/util.mjs';
import { formatPlan, isDue, listsOfJob, planSchedule } from './lib/plan.mjs';
import { QuotaExceededError, YouTube, publishedAfterFor } from './lib/youtube.mjs';
import { SHORT_MAX_SEC, confirmShorts } from './lib/shorts.mjs';

/** 国 → search.list に渡す q（言語別・config.js の SEARCH_Q が正本）。 */
function searchQFor(countryCode) {
  const hl = COUNTRIES.find(c => c.code === countryCode)?.hl;
  return SEARCH_Q[hl] || SEARCH_Q.default;
}
import {
  appendSnapshot, applyRanks, computeGrowthItems, growthFeature, loadPrevRanks,
  snapshotForDaysAgo, writeIndex, writeList, writeMap, writeTags,
} from './lib/store.mjs';
import { isMultiWriterList, mergeIntoList } from './lib/chart.mjs';
import { rankTerms } from './lib/tags.mjs';
import { runRetention } from './lib/retention.mjs';
import {
  BACKFILL_FILE, backfillWindows, loadPool, poolCountries, poolEvict, poolApplyRefresh,
  poolStaleIds, poolUpsert, rebuildRanking, savePool,
} from './lib/backfill.mjs';

const BUDGET_FILE = join(STATE_DIR, '_budget.json');
const SHORTS_FILE = join(STATE_DIR, '_shorts_cache.json');
const LASTRUN_FILE = join(STATE_DIR, 'last-run.json');

const args = parseArgs();
const now = new Date();
const nowISO = now.toISOString();

/* ------------------------------------------------------------- 予算と状態 */

/* バックフィル（全期間の遡り収集）の進み具合。窓の一覧は config から毎回決定的に作るので、
   state に持つのは国ごとのカーソルと完了フラグだけ（詳細は scripts/lib/backfill.mjs）。 */
const backfillState = (await readJSON(BACKFILL_FILE, null)) || { startedAt: null, countries: {} };
const bfWindows = backfillWindows(BACKFILL, now);
const bfCursorOf = code => Math.min(backfillState.countries[code]?.cursor ?? 0, bfWindows.length);
const bfAllDone = COUNTRIES.every(c => backfillState.countries[c.code]?.done || bfCursorOf(c.code) >= bfWindows.length);

/* 定常ジョブに使わせない予約枠。バックフィル中は 窓ぶん＋リフレッシュぶん、完走後はリフレッシュぶんだけ。 */
const reservedUnits = !BACKFILL.enabled ? 0
  : (bfAllDone ? BACKFILL.refreshDailyUnits : BACKFILL.dailyUnits + BACKFILL.refreshDailyUnits);

const plan = planSchedule({ dailyUnits: QUOTA.dailyUnits, reservedUnits });
log.step('budget plan');
console.log(formatPlan(plan));

await ensureDir(STATE_DIR);
await ensureDir(DATA_DIR);

const today = quotaDate(now, QUOTA.resetTimeZone);
let budget = await readJSON(BUDGET_FILE, null);
if (!budget || budget.date !== today) budget = { date: today, spent: 0, byJob: {}, byEndpoint: {} };

const shortsCache = (await readJSON(SHORTS_FILE, {})) || {};
const lastRunFile = (await readJSON(LASTRUN_FILE, {})) || {};
/* lastRun は「ジョブを最後に完走した時刻」。cursor は「途中で予算切れしたジョブの再開位置」。
   1回の費用が1日の予算を超えるジョブ（例: カテゴリ×週月＝8,080 units）は、
   カーソルが無いと毎回先頭からやり直して末尾に永久に到達しない（2026-08-25 レビュー指摘）。
   lap は「その周回で残っているリスト数と、書き損ねの有無」。カーソルだけだと再開時に
   また1周まるごと歩こうとするため、「1回では歩き切れない予算しか無い日」が続くと
   同じリストに割当を二重に払い続けて永久に完走しない（2026-08-26 シミュレーションで実測）。 */
const lastRun = lastRunFile.lastRun || lastRunFile;   // 旧形式（フラットな {jobId: ISO}）も読める
const cursor = lastRunFile.cursor || {};
const lap = lastRunFile.lap || {};                    // 旧形式には無い（無ければ新しい周回として扱う）

const HARD_STOP = Math.floor(QUOTA.dailyUnits * 0.95);
const spentAtStart = budget.spent;
let currentJob = 'unknown';

const onSpend = (units, endpoint) => {
  budget.spent += units;
  budget.byJob[currentJob] = (budget.byJob[currentJob] || 0) + units;
  budget.byEndpoint[endpoint] = (budget.byEndpoint[endpoint] || 0) + units;
};
/* デイリー枠の取り置き: 毎日ジョブ（everyHours ≤ 24）が今日のクォータ日にまだ完走していない間、
   その費用ぶんは他のジョブに使わせない。実行順の並べ替え（デイリー枠優先）は1回の実行の中でしか
   効かないので、top24h の期限が日の途中に来る日は、先に走った未消化の山が残額を使い切ると
   その日の 24h 更新が飛ぶ（2026-08-26 の事故の変種）。取り置きがあれば、いつ期限が来ても
   デイリー枠のぶんだけは必ず残っている。実行中のジョブ自身は取り置きから除く。 */
const ranToday = id => !!lastRun[id] && quotaDate(new Date(lastRun[id]), QUOTA.resetTimeZone) === today;
const dailyReserve = () => plan.jobs
  .filter(j => !j.skipped && j.everyHours <= 24 && j.costPerRun > 0
    && j.id !== currentJob && !ranToday(j.id))
  .reduce((sum, j) => sum + j.costPerRun, 0);
const canSpend = units => budget.spent + units <= HARD_STOP - dailyReserve();

/** 消費した割当は取り返せない。落ちても巻き戻らないよう、こまめに書き出す。 */
async function persistState() {
  try {
    await writeJSON(BUDGET_FILE, budget, { pretty: true });
    await writeJSON(SHORTS_FILE, shortsCache);
    await writeJSON(LASTRUN_FILE, { lastRun, cursor, lap }, { pretty: true });
    if (BACKFILL.enabled || backfillState.startedAt) {
      await writeJSON(BACKFILL_FILE, backfillState, { pretty: true });
    }
  } catch (err) {
    log.warn(`could not persist state: ${err.message}`);
  }
}
// タイムアウトで殺されたとき（Actions の timeout-minutes 等）にも最後の一手で保存する。
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { persistState().finally(() => process.exit(1)); });
}

/* --------------------------------------------------------- 実行ジョブ決定 */

const requested = typeof args.jobs === 'string'
  ? args.jobs.split(',').map(s => s.trim()).filter(Boolean)
  : null;

const dueJobs = plan.jobs.filter(j => {
  if (j.skipped) return false;
  if (requested) return requested.includes(j.id);
  if (args.force) return true;
  return isDue(j, lastRun[j.id], now);
});

/* 実行順は2段構え:
   ① デイリー枠（planner が「毎日」と約束したジョブ＝everyHours ≤ 24。top24h と map）を先頭に。
      2026-08-26 実測: 第3弾でカテゴリ系ジョブが一斉に新設された翌日、未実行ジョブ（overdue=∞）が
      約37,000 units ぶん先頭に並び、毎日更新のはずの top24h が予算切れで丸1日飛んだ。
      デイリー枠は合計 2,484 units と安いので、先に走らせても他の回復を妨げない。
   ② 残りは priority 固定ではなく「待たされた度合い」で決める（エイジング）。
      固定順だと、重いジョブ（カテゴリ×週月＝8,080 units）が毎日の残り予算を食い尽くし、
      その下にいる年間・全期間が永久に順番を得られない（60日シミュレーションで実測）。
   overdue = 経過時間 / 予定間隔。1.0 なら定刻、4.0 なら4周期ぶん待たされている。 */
const overdueOf = j => {
  const last = lastRun[j.id];
  if (!last) return Infinity;                       // 一度も取れていないものが最優先
  const elapsedH = (now.getTime() - new Date(last).getTime()) / 3600e3;
  return elapsedH / Math.max(1, j.everyHours);
};
const dailyTierOf = j => (j.everyHours <= 24 ? 0 : 1);  // 予算不足で planner が間隔を広げた日は自然に枠から外れる
dueJobs.sort((a, b) => (dailyTierOf(a) - dailyTierOf(b))
  || (overdueOf(b) - overdueOf(a)) || (a.priority - b.priority));

/* バックフィルと poolrefresh は SCHEDULE のジョブではない（1回きり／自己制限つき）ので別枠で判定。 */
const bfSpentToday = jobId => budget.byJob[jobId] || 0;
const backfillWanted = BACKFILL.enabled && !bfAllDone
  && (!requested || requested.includes('backfill'))
  && bfSpentToday('backfill') + QUOTA.costSearch + QUOTA.costVideos <= BACKFILL.dailyUnits;
const refreshWanted = BACKFILL.enabled
  && (!requested || requested.includes('poolrefresh'))
  && bfSpentToday('poolrefresh') + QUOTA.costVideos <= BACKFILL.refreshDailyUnits
  && (await poolCountries()).length > 0;

log.step('jobs');
log.info(`spent today: ${budget.spent} / ${QUOTA.dailyUnits} units (hard stop ${HARD_STOP})`);
log.info(`due: ${dueJobs.map(j => j.id).join(', ') || '(none)'}`);
if (BACKFILL.enabled) {
  const doneWindows = COUNTRIES.reduce((s, c) => s + bfCursorOf(c.code), 0);
  log.info(`backfill: ${doneWindows}/${bfWindows.length * COUNTRIES.length} windows`
    + `${bfAllDone ? ' (complete)' : ''} — reserve ${reservedUnits} u/day`);
}

if (args['dry-run']) {
  log.step('dry run — no API calls were made');
  for (const j of dueJobs) {
    const lists = listsOfJob(j.id);
    log.info(`${j.id}: ${lists.length} list(s), ${j.costPerRun} units`);
    lists.slice(0, 4).forEach(l => log.info(`   ${datasetId(l.country, l.section, l.period, l.category)} (${l.size})`));
    if (lists.length > 4) log.info(`   … +${lists.length - 4} more`);
  }
  if (backfillWanted) {
    const left = COUNTRIES.map(c => `${c.code} ${bfCursorOf(c.code)}/${bfWindows.length}`).join(', ');
    const remainUnits = (bfWindows.length * COUNTRIES.length - COUNTRIES.reduce((s, c) => s + bfCursorOf(c.code), 0))
      * (QUOTA.costSearch + QUOTA.costVideos);
    log.info(`backfill: ${left} — ~${remainUnits} units left, `
      + `~${Math.ceil(remainUnits / Math.max(1, BACKFILL.dailyUnits))} day(s) at ${BACKFILL.dailyUnits} u/day`);
  }
  process.exit(0);
}

const apiKey = process.env.YT_API_KEY;
if (!apiKey) {
  log.warn('YT_API_KEY is not set — skipping collection.');
  log.warn('The site keeps whatever data is already in public/data (sample data before human gate A).');
  log.warn('See NEEDS_HUMAN.md gate A for how to issue the key.');
  process.exit(0);
}

if (!dueJobs.length && !backfillWanted && !refreshWanted) {
  log.done('nothing due — exiting without touching public/data');
  process.exit(0);
}

if (budget.spent >= HARD_STOP) {
  log.warn(`daily hard stop reached (${budget.spent}/${QUOTA.dailyUnits}) — skipping this run`);
  await writeJSON(BUDGET_FILE, budget);
  process.exit(0);
}

const yt = new YouTube({ apiKey, onSpend, canSpend });

/* ------------------------------------------------------------ 収集ロジック */

/** 1本のランキングを取る。 */
async function collectList(desc, { adaptive = false } = {}) {
  const pages = Math.ceil(desc.size / QUOTA.pageSize);
  const publishedAfter = publishedAfterFor(desc.days, now);
  const videoDuration = desc.section === 'shorts' ? 'short' : undefined;

  const ids = [];
  let pageToken;
  for (let p = 0; p < pages; p++) {
    // q なしの search.list は常に 0 件（2026-08-25 実測・DECISIONS 参照）。
    const res = await yt.search({
      regionCode: desc.country,
      publishedAfter,
      videoCategoryId: desc.ytCategoryId || undefined,
      videoDuration,
      q: searchQFor(desc.country),
      maxResults: QUOTA.pageSize,
      pageToken,
      costSearch: QUOTA.costSearch,
    });
    ids.push(...res.ids);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }

  let details = [];
  for (const part of chunk([...new Set(ids)], 50)) {
    details.push(...await yt.videos(part, { costVideos: QUOTA.costVideos }));
  }

  // ショート判定（API 割当は消費しない）
  const candidates = details.filter(d => d.durationSec > 0 && d.durationSec <= SHORT_MAX_SEC);
  const { decided, checked, failed } = await confirmShorts(candidates, shortsCache, { now: now.getTime() });
  details = details.map(d => ({ ...d, isShort: decided.get(d.videoId) ?? false }));
  if (checked) {
    const line = `shorts check: ${checked} verified, ${failed} fell back to duration`;
    // 失敗が半数を超えるのは「同意画面に飛ばされている」等の系統的な失敗。
    // 判定が丸ごとヒューリスティックに落ちて部門の精度が落ちるので、目立つように出す。
    if (failed / checked > 0.5) log.warn(`   ${line} — 判定がほぼ機能していません（要調査）`);
    else log.info(`   ${line}`);
  }

  let items = details.filter(d => (desc.section === 'shorts' ? d.isShort : !d.isShort));

  // 動画部門はショートを除いたぶん目減りする。余裕があれば1ページだけ買い足す（全ジョブ）。
  if (adaptive && desc.section === 'video' && items.length < desc.size * 0.6 && pageToken && canSpend(QUOTA.costSearch + QUOTA.costVideos)) {
    log.info(`   thin list (${items.length}/${desc.size}) — fetching one extra page`);
    const extra = await yt.search({
      regionCode: desc.country, publishedAfter,
      videoCategoryId: desc.ytCategoryId || undefined,
      q: searchQFor(desc.country),
      maxResults: QUOTA.pageSize, pageToken, costSearch: QUOTA.costSearch,
    });
    const more = await yt.videos(extra.ids.slice(0, 50), { costVideos: QUOTA.costVideos });
    const cand2 = more.filter(d => d.durationSec > 0 && d.durationSec <= SHORT_MAX_SEC);
    const r2 = await confirmShorts(cand2, shortsCache, { now: now.getTime() });
    // 追加ページは前ページと重なることがある。videoId の重複はスキーマ違反なので必ず落とす。
    const seenIds = new Set(items.map(i => i.videoId));
    items.push(...more
      .map(d => ({ ...d, isShort: r2.decided.get(d.videoId) ?? false }))
      .filter(d => !d.isShort && !seenIds.has(d.videoId)));
  }

  items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  items = items.slice(0, desc.size);
  return items;
}

/** 国ごとの母集団（tags と growth が使う）。videoId → item */
const pools = new Map(COUNTRIES.map(c => [c.code, new Map()]));
const allSeen = new Map();           // スナップショット用（国をまたいだ和集合）
/* この実行で API から実際に取った動画（候補プールへの還流用）。
   pools は後段で公開中 JSON からも埋まる（＝取得が古い）ので、fetchedAt を「今」にして
   よいのはこちらだけ（ORDER §8: プールの中身は常に30日以内の取得値でなければならない）。 */
const freshByCountry = new Map(COUNTRIES.map(c => [c.code, new Map()]));
const written = [];

/**
 * @returns {Promise<boolean>} 全リストを取り切れたら true。
 *   途中で打ち切った場合に true を返すと lastRun が進み、次の実行間隔まで穴が埋まらない。
 */
async function runListJob(jobId) {
  currentJob = jobId;
  const lists = listsOfJob(jobId);
  // 前回この番号で力尽きた続きから始める。1周ぶんの本数を超えないよう常に丸める。
  const start = Math.min(Math.max(0, cursor[jobId] | 0), Math.max(0, lists.length - 1));
  /* 周回（ラップ）は実行をまたいで数える: 予算切れで止まった続きの実行では「残りのリスト」
     だけを歩き、全リストを1回ずつ取り終えた時点で完走とする。毎回1周まるごと歩き直すと、
     取り直しに割当を二重に払ううえ、「1回で歩き切れない予算しか無い日」が続くジョブは
     永久に完走せず、他のジョブを追い越し続けて飢餓させる（2026-08-26 実測）。
     リングの構成が変わったら（国の追加・入替等。署名 sig の不一致で検出）、
     残数を引き継ぐと新しいリストを取らないまま完走扱いにしてしまうので、新しい周回にする。 */
  const ringSig = (() => {
    let h = 5381;
    for (const l of lists) for (const ch of `${l.country}.${l.section}.${l.period}.${l.category};`) {
      h = ((h * 33) ^ ch.charCodeAt(0)) | 0;
    }
    return h;
  })();
  const lapValid = lap[jobId]?.sig === ringSig
    && Number.isInteger(lap[jobId]?.left) && lap[jobId].left >= 1 && lap[jobId].left <= lists.length;
  const lapLeft = lapValid ? lap[jobId].left : lists.length;
  const lapDirty = lapValid && lap[jobId].dirty === true;
  // 書き損ねで閉じた周回の連続回数。閉じた周回の取り直し（下の dirtyLaps 判定）に使う。
  const prevDirtyLaps = lap[jobId]?.dirtyLaps | 0;
  const order = [...lists.slice(start), ...lists.slice(0, start)].slice(0, lapLeft);
  log.step(`${jobId} — ${lists.length} list(s)`
    + `${start ? ` (resuming at #${start + 1}, ${lapLeft} left in this lap)` : ''}`);
  let complete = !lapDirty; // この周回を最後まで歩き、かつ（前の実行ぶんも含めて）全部書けた
  let walkedAll = true;     // この周回の残りを最後まで歩いた（0件で飛ばしたぶんは含む）
  let done = 0;
  const parkAt = i => {
    cursor[jobId] = (start + i) % lists.length;
    lap[jobId] = {
      left: lapLeft - i, sig: ringSig,
      ...(complete ? {} : { dirty: true }),
      ...(prevDirtyLaps ? { dirtyLaps: prevDirtyLaps } : {}),
    };
  };
  try {
  for (const desc of order) {
    if (!canSpend(QUOTA.costSearch)) {
      // 次回はここから。予算を使い切っても必ず前へ進む。
      parkAt(done);
      log.warn(`hard stop reached — stopping this job `
        + `(resume at #${cursor[jobId] + 1}/${lists.length}, ${lapLeft - done} left)`);
      walkedAll = false;
      break;
    }
    done++;
    const id = datasetId(desc.country, desc.section, desc.period, desc.category);
    try {
      // 動画部門はショートを除いたぶん目減りする。薄いときは1ページだけ買い足す
      // （予算に余裕があるときだけ。US の月間が3件になっていた 2026-08-25 の実測より）
      const raw = await collectList(desc, { adaptive: true });
      // 0 件を書くと公開中のデータと prev（順位変動の比較元）まで消える。前回のものを残す。
      if (!raw.length) { log.warn(`${id}: 0 items — keeping the previous file`); complete = false; continue; }
      const { ranks, generatedAt: prevGeneratedAt } = await loadPrevRanks(id);
      const windowStart = desc.days == null ? null : new Date(now.getTime() - desc.days * 864e5).toISOString();
      const prev = await readJSON(join(DATA_DIR, `${id}.json`), null);
      const prevCount = prev?.items?.length || 0;

      /* 書き手が2つあるリスト（chart ジョブも書く 24h/週間/月間×総合）は素の上書きにしない。
         上書きすると chart だけが知る動画（＝search の索引が返さないもの＝この改修の存在理由）が
         完走のたびに消え、急上昇の寿命より窓が長い週間・月間では二度と戻らない
         （2026-08-30 レビューの確定指摘）。合流規則は chart 側と同じ1本を使う。 */
      const merged = isMultiWriterList(desc)
        ? mergeIntoList(prev?.items, raw, { windowStart, size: desc.size, prune: true })
        : { items: raw, dropped: 0 };
      const nextRaw = merged.items;

      // 前回より極端に痩せた結果で上書きしない（API の気まぐれで「3件の月間ランキング」を
      // 公開してしまうのを防ぐ）。半分未満に減った場合だけ見送る。
      // 合流するリストでは「合流後の件数」で見る: search の収量だけで測ると、chart が足したぶん
      // 基準（prevCount）が系統的に上振れして、薄いリストが恒久的に据え置かれ、
      // そのたびに周回を取り直して割当を空費する（同レビューの確定指摘）。
      if (prevCount >= 20 && nextRaw.length < prevCount / 2) {
        log.warn(`${id}: ${nextRaw.length} items vs ${prevCount} before — keeping the previous file`);
        complete = false;
        continue;
      }
      const items = applyRanks(nextRaw, ranks);
      const res = await writeList({
        ...desc,
        items,
        windowStart,
        generatedAt: nowISO,
        prevGeneratedAt,
      });
      written.push(res);
      const bucket = pools.get(desc.country);
      const freshBucket = freshByCountry.get(desc.country);
      items.forEach(i => { bucket?.set(i.videoId, i); freshBucket?.set(i.videoId, i); allSeen.set(i.videoId, i); });
      log.done(`${id}: ${items.length} items`);
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn(`${id}: ${err.message}`);
      complete = false;
    }
  }
  } catch (err) {
    // 割当ガードが途中で止めた場合。そのリストは書けていないので、次回はそこから retry する
    // （取り直すので「書き損ね」には数えない）。
    if (err instanceof QuotaExceededError) { parkAt(done - 1); walkedAll = false; }
    throw err;
  }
  if (!walkedAll) return false;                 // 予算切れで停止。lap に残数を残してある
  // 周回を閉じたのでカーソルとラップを畳む（0件で飛ばした行があっても、位置としては先頭に戻ってよい）
  delete cursor[jobId];
  delete lap[jobId];
  if (complete) return true;
  /* 書き損ね（0件・激減の据え置き・単発エラー）で閉じた周回は、次の実行で新しい周回として
     1度だけ取り直す。無制限に取り直すと、慢性的に書けないリストが1本あるだけで永久に完走せず、
     毎時の実行がリング1周ぶんの割当を払い続けて他のジョブを飢餓させる（2026-08-26 レビューで
     実測: top24h なら1日で 2,424×4周 ≈ 9,700 units ＞ ハード停止）。2周続けて駄目なら慢性と
     みなし、lastRun を進めて次の間隔まで諦める（据え置いた前回のデータが出続けるだけで、
     壊れはしない）。 */
  const dirtyLaps = prevDirtyLaps + 1;
  if (dirtyLaps < 2) {
    lap[jobId] = { dirtyLaps };
    return false;
  }
  log.warn(`${jobId}: ${dirtyLaps} lap(s) in a row closed with kept-previous lists — `
    + 'giving up until the next interval');
  return true;
}

/**
 * 公式急上昇（chart=mostPopular・1 unit/国）を 24h/週間/月間ランキングへ合流させる（2026-08-30 改訂）。
 * search が取りこぼす大物と、top24h が毎日1回になった古さを、ほぼ無料の側路で補う。
 * 年間・全期間はここで直接触らず、freshByCountry → feedPools → rebuildFromPool の既存経路に乗せる。
 * @returns {Promise<boolean>} 全カ国を回れたら true（途中で予算が尽きたら false＝次の毎時で続き）。
 */
async function runChartJob() {
  currentJob = 'chart';
  log.step(`chart — ${COUNTRIES.length} countries`);
  const CHART_PERIODS = ['24h', 'week', 'month'];
  const sizeAll = CATEGORIES.find(x => x.id === 'all')?.size ?? 100;
  for (const c of COUNTRIES) {
    if (!canSpend(QUOTA.costVideos)) {
      log.warn('chart: hard stop reached — stopping this job');
      return false;
    }
    try {
      const top = await yt.mostPopular({ regionCode: c.code, maxResults: 50, costVideos: QUOTA.costVideos });
      // ショート判定は search 経路と同じ道具・同じキャッシュ（部門の純度は schema が守る約束）
      const candidates = top.filter(d => d.durationSec > 0 && d.durationSec <= SHORT_MAX_SEC);
      const { decided } = await confirmShorts(candidates, shortsCache, { now: now.getTime() });
      const fresh = top
        .filter(d => d.viewCount != null)
        .map(d => ({ ...d, isShort: decided.get(d.videoId) ?? false }));
      for (const v of fresh) {
        allSeen.set(v.videoId, v);
        pools.get(c.code)?.set(v.videoId, v);
        freshByCountry.get(c.code)?.set(v.videoId, v);
      }
      for (const s of SECTIONS) {
        const subset = fresh.filter(d => (s.id === 'shorts' ? d.isShort : !d.isShort));
        if (!subset.length) continue;
        for (const pid of CHART_PERIODS) {
          const per = PERIODS.find(p => p.id === pid);
          const id = datasetId(c.code, s.id, pid, 'all');
          // search がまだ一度も作っていないリストは作らない（chart 50本だけの薄いリストを公開しない）
          const cur = await readJSON(join(DATA_DIR, `${id}.json`), null);
          if (!cur?.items?.length) continue;
          const windowStart = per.days == null ? null : new Date(now.getTime() - per.days * 864e5).toISOString();
          const { items: rawMerged, added, touched, dropped } = mergeIntoList(cur.items, subset, {
            windowStart,
            size: Math.min(sizeAll, per.size ?? 100),
          });
          // 変化が無いのに書くと prev（↑↓の比較元）だけが無駄に進む
          if (!added && !touched && !dropped) continue;
          const { ranks, generatedAt: prevGeneratedAt } = await loadPrevRanks(id);
          const items = applyRanks(rawMerged, ranks);
          written.push(await writeList({
            country: c.code, section: s.id, period: pid, category: 'all',
            items, windowStart, generatedAt: nowISO, prevGeneratedAt,
          }));
          if (added) log.done(`${id}: +${added} from chart (${touched} refreshed)`);
        }
      }
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn(`chart ${c.code}: ${err.message}`);
    }
  }
  return true;
}

async function runMapJob() {
  currentJob = 'map';
  log.step(`map — ${MAP_COUNTRIES.length} countries`);
  const items = [];
  const usedVideoIds = new Set();   // 国ごとに違う動画を出すための重複よけ
  for (const mc of MAP_COUNTRIES) {
    if (!canSpend(QUOTA.costVideos)) break;
    try {
      // その国の「人気チャート1位」をそのまま代表にする。再生数の絶対値で選び直すと、
      // 世界的にバズった同じ動画が何か国もの代表になってしまう（2026-08-25 発注者指摘）。
      // maxResults を 10 にしても費用は同じ 1 unit。上位10本は top としてミニリストに出す
      // （2026-08-25 発注者改訂 第3弾「地図拡充」）。
      const top = await yt.mostPopular({ regionCode: mc.code, maxResults: 10, costVideos: QUOTA.costVideos });
      const ranked = top.filter(v => v.viewCount != null);
      // それでも重なるときは、まだ使っていない上位の動画に譲る（同じ絵が並ぶのを避ける）。
      const best = ranked.find(v => !usedVideoIds.has(v.videoId)) || ranked[0];
      if (!best) continue;
      usedVideoIds.add(best.videoId);
      // normalizeVideo は isShort:false 固定。長さから補正したものを母集団にも入れる
      // （補正前を入れると「伸び」ランキングの部門分けが全部 video 側に寄る）。
      const withShort = v => ({ ...v, isShort: v.durationSec > 0 && v.durationSec <= SHORT_MAX_SEC });
      const item = withShort(best);
      items.push({
        country: mc.code, lat: mc.lat, lon: mc.lon,
        videoId: item.videoId, title: item.title, channelTitle: item.channelTitle,
        viewCount: item.viewCount, isShort: item.isShort,
        top: ranked.slice(0, 10).map(withShort).map(v => ({
          videoId: v.videoId, title: v.title, channelTitle: v.channelTitle,
          viewCount: v.viewCount, isShort: v.isShort,
        })),
      });
      for (const v of ranked.map(withShort)) {
        allSeen.set(v.videoId, v);
        pools.get(mc.code)?.set(v.videoId, v);
        freshByCountry.get(mc.code)?.set(v.videoId, v);
      }
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn(`map ${mc.code}: ${err.message}`);
    }
  }
  // 予算切れで数カ国しか取れなかったときに、公開中の全26カ国を細らせない。
  // 足りないぶんは前回の内容で埋める（古い行が混じるほうが、地図が虫食いになるよりまし）。
  if (items.length) {
    if (items.length < MAP_COUNTRIES.length) {
      const prev = await readJSON(join(DATA_DIR, 'map.json'), null);
      const have = new Set(items.map(i => i.country));
      const kept = (prev?.items || []).filter(i => !have.has(i.country));
      if (kept.length) {
        log.warn(`map: ${items.length}/${MAP_COUNTRIES.length} countries fetched — keeping ${kept.length} from the previous file`);
        items.push(...kept);
      }
    }
    await writeMap({ items, generatedAt: nowISO });
    log.done(`map: ${items.length} countries`);
  }
}

/** タグ集計は API を使わない。公開中の JSON を母集団にする。 */
async function runTagsJob() {
  currentJob = 'tags';
  log.step('tags — 0 units');
  for (const c of COUNTRIES) {
    const files = (await listDir(DATA_DIR)).filter(f => f.startsWith(`${c.code}-`) && f.endsWith('.json'));
    // 同じ動画が期間・カテゴリをまたいで何本ものリストに載る。素朴に連結すると
    // 露出の多い動画の語だけが最大10倍に効いてしまう（カテゴリ全期間化で悪化）。
    // videoId で1本にまとめてから数える。
    const uniq = new Map();
    for (const f of files) {
      const d = await readJSON(join(DATA_DIR, f), null);
      if (!d?.items) continue;
      for (const it of d.items) if (!uniq.has(it.videoId)) uniq.set(it.videoId, it);
    }
    const items = [...uniq.values()];
    if (!items.length) continue;
    const prev = await readJSON(join(DATA_DIR, `tags-${c.code}.json`), null);
    const prevRanks = new Map((prev?.items || []).map(x => [x.term, x.rank]));
    const ranked = rankTerms(items, { prevRanks });
    await writeTags({ country: c.code, period: '24h', items: ranked, generatedAt: nowISO });
    log.done(`tags-${c.code}: ${ranked.length} terms`);
  }
}

/* --------------------------------------------- バックフィル（ORDER §2-1 改訂 / BACKFILL） */

/**
 * 年窓を1つずつ歩いて候補プールを埋める。1窓 = search 1ページ + videos.list = 101 units。
 * 1日の消費は BACKFILL.dailyUnits で自己制限し、窓カーソルは国ごとに state に残す（冪等）。
 * @returns {Promise<boolean>} 今回1窓でも取ったら true
 */
let poolsTouched = false;            // rebuildFromPool を呼ぶかどうか（毎時の delta 乱高下よけ）

async function runBackfillJob() {
  if (!backfillWanted) return false;
  currentJob = 'backfill';
  if (!backfillState.startedAt) backfillState.startedAt = nowISO;
  log.step(`backfill — ${bfWindows.length} window(s) × ${COUNTRIES.length} countries`);
  let ran = false;
  for (const c of COUNTRIES) {
    const st = backfillState.countries[c.code] ||= { cursor: 0, done: false };
    if (st.done || st.cursor >= bfWindows.length) { st.done = true; continue; }
    const pool = await loadPool(c.code);
    let dirty = false;
    try {
      while (st.cursor < bfWindows.length) {
        const windowCost = QUOTA.costSearch + QUOTA.costVideos;
        if ((budget.byJob.backfill || 0) + windowCost > BACKFILL.dailyUnits) {
          log.info(`backfill: daily reserve used (${budget.byJob.backfill || 0}/${BACKFILL.dailyUnits})`);
          break;
        }
        if (!canSpend(windowCost)) break;
        const w = bfWindows[st.cursor];
        const res = await yt.search({
          regionCode: c.code,
          publishedAfter: w.after,
          publishedBefore: w.before,
          videoDuration: w.section === 'shorts' ? 'short' : undefined,
          q: searchQFor(c.code),
          maxResults: QUOTA.pageSize,
          costSearch: QUOTA.costSearch,
        });
        const details = res.ids.length
          ? await yt.videos([...new Set(res.ids)], { costVideos: QUOTA.costVideos })
          : [];
        const candidates = details.filter(d => d.durationSec > 0 && d.durationSec <= SHORT_MAX_SEC);
        const { decided } = await confirmShorts(candidates, shortsCache, { now: now.getTime() });
        const items = details.map(d => ({ ...d, isShort: decided.get(d.videoId) ?? false }));
        poolUpsert(pool, items, nowISO);
        dirty = true;
        ran = true;
        poolsTouched = true;
        st.cursor++;
        // 古い年代の窓が 50 件未満しか返さないのは正常（プールに足すだけなので問題ない）。
        log.done(`backfill ${c.code} ${w.section} ${w.after.slice(0, 10)}〜${w.before.slice(0, 10)}: `
          + `${items.length} videos (${st.cursor}/${bfWindows.length})`);
        await persistState();                     // 消費とカーソルは窓単位で確実に残す
      }
      if (st.cursor >= bfWindows.length) {
        st.done = true;
        log.done(`backfill ${c.code}: all ${bfWindows.length} windows walked`);
      }
    } finally {
      // 予算切れ・quotaExceeded で抜けても、取れたぶんのプールは必ず書き残す。
      if (dirty) { poolEvict(pool, BACKFILL.poolMaxPerCountry); await savePool(c.code, pool); }
      await persistState();
    }
    if ((budget.byJob.backfill || 0) + QUOTA.costSearch + QUOTA.costVideos > BACKFILL.dailyUnits
      || !canSpend(QUOTA.costSearch)) break;     // 予約を使い切った。残りの国は次回
  }
  return ran;
}

/**
 * 候補プールの中身を古い順に videos.list で取り直す（50件 = 1 unit / ORDER §8 のリフレッシュ）。
 * @returns {Promise<boolean>} 今回1回でも取り直したら true
 */
async function runPoolRefresh() {
  if (!refreshWanted) return false;
  currentJob = 'poolrefresh';
  let ran = false;
  for (const code of await poolCountries()) {
    const pool = await loadPool(code);
    let dirty = false;
    while ((budget.byJob.poolrefresh || 0) + QUOTA.costVideos <= BACKFILL.refreshDailyUnits
      && canSpend(QUOTA.costVideos)) {
      // 今日すでに触った項目まで取り直すと無限に回るので、1日より新しいものは対象外。
      const stale = poolStaleIds(pool, { limit: QUOTA.pageSize, now: now.getTime() })
        .filter(id => now.getTime() - Date.parse(pool[id].fetchedAt || 0) > 864e5);
      if (!stale.length) break;
      const fresh = await yt.videos(stale, { costVideos: QUOTA.costVideos });
      poolApplyRefresh(pool, stale, fresh, nowISO);
      dirty = ran = poolsTouched = true;
    }
    if (dirty) await savePool(code, pool);
  }
  if (ran) log.done(`poolrefresh: ${budget.byJob.poolrefresh || 0} units today`);
  return ran;
}

/**
 * この実行で API から取った動画を候補プールへ還流する（0 units）。
 * 24h・週間・月間・地図の上位が全期間ランキングの候補として貯まっていく。
 */
async function feedPools() {
  if (!BACKFILL.enabled) return;
  for (const c of COUNTRIES) {
    const items = [...(freshByCountry.get(c.code)?.values() || [])];
    if (!items.length) continue;
    const pool = await loadPool(c.code);
    if (!Object.keys(pool).length && !backfillState.countries[c.code]) continue;  // プールはバックフィルが最初に作る
    poolUpsert(pool, items, nowISO);
    poolEvict(pool, BACKFILL.poolMaxPerCountry);
    await savePool(c.code, pool);
  }
}

/**
 * プールから year / all の総合ランキングを再構成して公開する（0 units）。
 * 毎時の delta 乱高下を避けるため、バックフィルか poolrefresh が実際に動いた実行だけ呼ぶ。
 * カテゴリ別（catyearall）のプール化は BACKLOG（プールに categoryId は保存済み）。
 */
async function rebuildFromPool() {
  currentJob = 'rebuild';
  log.step('rebuild year/all from pool — 0 units');
  for (const c of COUNTRIES) {
    const pool = await loadPool(c.code);
    if (!Object.keys(pool).length) continue;
    for (const s of SECTIONS) {
      for (const pid of ['year', 'all']) {
        const days = PERIODS.find(p => p.id === pid)?.days ?? null;
        const raw = rebuildRanking(pool, { section: s.id, days, size: 100, now });
        if (!raw.length) continue;                // 空で上書きしない（前回を残す）
        const id = datasetId(c.code, s.id, pid, 'all');
        // search 由来の既存リストより極端に痩せた結果で上書きしない（runListJob と同じガード）。
        const prevCount = (await readJSON(join(DATA_DIR, `${id}.json`), null))?.items?.length || 0;
        if (prevCount >= 20 && raw.length < prevCount / 2) {
          log.warn(`${id}: pool rebuild has ${raw.length} vs ${prevCount} published — keeping the previous file`);
          continue;
        }
        const { ranks, generatedAt: prevGeneratedAt } = await loadPrevRanks(id);
        const items = applyRanks(raw, ranks);
        const res = await writeList({
          country: c.code, section: s.id, period: pid, category: 'all',
          items,
          windowStart: days == null ? null : new Date(now.getTime() - days * 864e5).toISOString(),
          generatedAt: nowISO, prevGeneratedAt,
        });
        written.push(res);
        log.done(`${id}: ${items.length} items (from pool)`);
      }
    }
  }
}

/**
 * 「伸び」の母集団を、この実行で取ったぶんだけでなく公開中の JSON でも埋める。
 * こうしないと、例えば top24h だけ走った実行で week/month の伸びが空になり、
 * 直前に公開していた伸びランキングを空で上書きしてしまう。
 */
async function seedPoolsFromPublished() {
  for (const f of await listDir(DATA_DIR)) {
    if (!f.endsWith('.json') || f === 'index.json' || f === 'map.json' || f.startsWith('tags-')) continue;
    const d = await readJSON(join(DATA_DIR, f), null);
    if (!d?.items || d.metric === 'growth') continue;      // 伸び自身は母集団にしない
    const bucket = pools.get(d.country);
    if (!bucket) continue;
    for (const it of d.items) if (!bucket.has(it.videoId)) bucket.set(it.videoId, it);
  }
}

/** 「伸び」ランキング。蓄積が足りたら自動で生える（ORDER §2-14）。 */
async function runGrowth(feature) {
  if (!feature.enabled) {
    log.info(`growth: not enabled yet (${feature.daysCollected}/${feature.requiredDays} days of snapshots)`);
    return;
  }
  currentJob = 'growth';
  log.step(`growth — periods: ${feature.periods.join(', ')} (0 units)`);
  for (const pid of feature.periods) {
    const days = PERIODS.find(p => p.id === pid)?.days;
    const past = await snapshotForDaysAgo(days, now);
    if (!past) continue;
    for (const c of COUNTRIES) {
      for (const s of SECTIONS) {
        const scoped = pools.get(c.code) || new Map();
        const items = computeGrowthItems({ pool: scoped, past, size: 100, section: s.id });
        if (!items.length) continue;                       // 空で上書きしない（前回を残す）
        const id = datasetId(c.code, s.id, pid, 'all', 'growth');
        const { ranks, generatedAt: prevGeneratedAt } = await loadPrevRanks(id);
        const ranked = applyRanks(items, ranks);
        const res = await writeList({
          country: c.code, section: s.id, period: pid, category: 'all', metric: 'growth',
          items: ranked,
          windowStart: new Date(now.getTime() - days * 864e5).toISOString(),
          generatedAt: nowISO, prevGeneratedAt,
        });
        written.push(res);
        log.done(`${id}: ${ranked.length} items`);
      }
    }
  }
}

/* ------------------------------------------------------------------ 実行 */

let quotaHalted = false;
let fatal = null;

// ── 1段目: API を使う収集。割当を使い切ったらここで止まる。
try {
  for (const job of dueJobs) {
    let complete = true;
    if (job.id === 'map') await runMapJob();
    else if (job.id === 'chart') complete = await runChartJob();
    else if (job.id === 'tags') continue;                 // 最後にまとめて走らせる
    else complete = await runListJob(job.id);
    // 途中で打ち切ったジョブは lastRun を進めない。次の実行で残りを取りにいく。
    if (complete) lastRun[job.id] = nowISO;
    else log.warn(`${job.id}: incomplete — will be retried on the next run`);
    await persistState();                                 // ジョブ単位で確実に残す
  }
  // バックフィルと poolrefresh は SCHEDULE 外の別枠（予約 units の範囲で自己制限する）。
  // 定常ジョブの後に回すことで、初回取得や日々の更新を遡り収集が妨げない。
  await runBackfillJob();
  await runPoolRefresh();
} catch (err) {
  if (err instanceof QuotaExceededError) {
    quotaHalted = true;
    log.warn(`stopped early: ${err.message}`);
  } else {
    fatal = err;                                          // 後始末を済ませてから投げ直す
    log.warn(`run failed: ${err.message}`);
  }
} finally {
  await persistState();
}

/* ── 2段目: API を1 unit も使わない後工程（スナップショット・伸び・ワード集計）。
   1段目と同じ try に入れていたため、予算切れで止まった日は丸ごと飛ばされていた。
   予算を使い切る日が普通にある設計（docs/BUDGET.md）なので、公開中の tags が
   いつまでも作られない実害が出ていた（2026-08-25 実データで発覚）。
   致命的エラー（fatal）のときだけは、壊れた状態で上書きしないよう飛ばす。 */
if (!fatal) {
  try {
    if (allSeen.size) await appendSnapshot([...allSeen.values()], now);
    const feature = await growthFeature(PERIODS, now);
    await seedPoolsFromPublished();
    await runGrowth(feature);

    await feedPools();                          // 0 units: 今回取ったぶんを候補プールへ還流
    if (poolsTouched) await rebuildFromPool();  // 0 units: year/all をプールから再構成

    // 母集団は公開中の JSON なので、今回1本も書けていなくても集計できる。
    if (dueJobs.some(j => j.id === 'tags') || written.length || quotaHalted) {
      await runTagsJob();
      lastRun.tags = nowISO;
    }
  } catch (err) {
    // ここで落ちても収集済みのデータは守る（後工程は次回また回る）
    log.warn(`post-processing failed: ${err.message}`);
  } finally {
    await persistState();
  }
}

/* -------------------------------------------------------- 後始末と index */

// ORDER §8 の保持期間（スナップショット31日／取得データ30日／前回順位／判定キャッシュ）。
// 中身は scripts/lib/retention.mjs にあり、APIキー無しの scripts/retention.mjs からも同じものを呼ぶ。
await runRetention({ now, shortsCache, saveShorts: false });

// index.json は public/data の実物から作る（部分実行でも整合する）
const datasets = {};
for (const f of await listDir(DATA_DIR)) {
  if (!f.endsWith('.json')) continue;
  if (f === 'index.json' || f === 'map.json' || f.startsWith('tags-')) continue;
  const d = await readJSON(join(DATA_DIR, f), null);
  if (!d?.id) continue;
  const ageDays = (now.getTime() - Date.parse(d.generatedAt)) / 864e5;
  datasets[d.id] = {
    generatedAt: d.generatedAt,
    count: d.items?.length ?? 0,
    stale: ageDays > RETENTION.dataMaxAgeDays,
  };
}

const feature = await growthFeature(PERIODS, now);
// 遡り収集の進み具合（UI の「全期間ランキングを拡充中 (n/total)」表示に使う）。
const bfDoneWindows = COUNTRIES.reduce((s, c) => s + bfCursorOf(c.code), 0);
const bfTotalWindows = bfWindows.length * COUNTRIES.length;
await writeIndex({
  source: 'youtube-api',
  countries: COUNTRIES.map(c => c.code),
  datasets,
  features: {
    growth: feature, map: true, tags: true,
    backfill: {
      active: BACKFILL.enabled && bfDoneWindows < bfTotalWindows,
      done: bfDoneWindows,
      total: bfTotalWindows,
    },
  },
  quota: {
    spentToday: budget.spent,
    dailyUnits: QUOTA.dailyUnits,
    degraded: plan.degraded || quotaHalted,
  },
  generatedAt: nowISO,
});

await persistState();

log.step('summary');
log.info(`lists written: ${written.length}`);
log.info(`units spent this run: ${budget.spent - spentAtStart} (today total ${budget.spent}/${QUOTA.dailyUnits})`);
log.info(`growth: ${feature.enabled ? feature.periods.join(', ') : `off (${feature.daysCollected}/${feature.requiredDays} days)`}`);

// 後始末（state の保存と index の生成）を終えてから、致命的な例外は投げ直して CI を赤くする。
if (fatal) throw fatal;
log.done('done');

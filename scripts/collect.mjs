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
  COUNTRIES, SECTIONS, PERIODS, MAP_COUNTRIES, QUOTA, RETENTION, SEARCH_Q, datasetId,
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
import { rankTerms } from './lib/tags.mjs';
import { runRetention } from './lib/retention.mjs';

const BUDGET_FILE = join(STATE_DIR, '_budget.json');
const SHORTS_FILE = join(STATE_DIR, '_shorts_cache.json');
const LASTRUN_FILE = join(STATE_DIR, 'last-run.json');

const args = parseArgs();
const now = new Date();
const nowISO = now.toISOString();

/* ------------------------------------------------------------- 予算と状態 */

const plan = planSchedule({ dailyUnits: QUOTA.dailyUnits });
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
   カーソルが無いと毎回先頭からやり直して末尾に永久に到達しない（2026-08-25 レビュー指摘）。 */
const lastRun = lastRunFile.lastRun || lastRunFile;   // 旧形式（フラットな {jobId: ISO}）も読める
const cursor = lastRunFile.cursor || {};

const HARD_STOP = Math.floor(QUOTA.dailyUnits * 0.95);
const spentAtStart = budget.spent;
let currentJob = 'unknown';

const onSpend = (units, endpoint) => {
  budget.spent += units;
  budget.byJob[currentJob] = (budget.byJob[currentJob] || 0) + units;
  budget.byEndpoint[endpoint] = (budget.byEndpoint[endpoint] || 0) + units;
};
const canSpend = units => budget.spent + units <= HARD_STOP;

/** 消費した割当は取り返せない。落ちても巻き戻らないよう、こまめに書き出す。 */
async function persistState() {
  try {
    await writeJSON(BUDGET_FILE, budget, { pretty: true });
    await writeJSON(SHORTS_FILE, shortsCache);
    await writeJSON(LASTRUN_FILE, { lastRun, cursor }, { pretty: true });
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

/* 実行順は priority 固定ではなく「待たされた度合い」で決める（エイジング）。
   固定順だと、重いジョブ（カテゴリ×週月＝8,080 units）が毎日の残り予算を食い尽くし、
   その下にいる年間・全期間が永久に順番を得られない（60日シミュレーションで実測）。
   overdue = 経過時間 / 予定間隔。1.0 なら定刻、4.0 なら4周期ぶん待たされている。 */
const overdueOf = j => {
  const last = lastRun[j.id];
  if (!last) return Infinity;                       // 一度も取れていないものが最優先
  const elapsedH = (now.getTime() - new Date(last).getTime()) / 3600e3;
  return elapsedH / Math.max(1, j.everyHours);
};
dueJobs.sort((a, b) => (overdueOf(b) - overdueOf(a)) || (a.priority - b.priority));

log.step('jobs');
log.info(`spent today: ${budget.spent} / ${QUOTA.dailyUnits} units (hard stop ${HARD_STOP})`);
log.info(`due: ${dueJobs.map(j => j.id).join(', ') || '(none)'}`);

if (args['dry-run']) {
  log.step('dry run — no API calls were made');
  for (const j of dueJobs) {
    const lists = listsOfJob(j.id);
    log.info(`${j.id}: ${lists.length} list(s), ${j.costPerRun} units`);
    lists.slice(0, 4).forEach(l => log.info(`   ${datasetId(l.country, l.section, l.period, l.category)} (${l.size})`));
    if (lists.length > 4) log.info(`   … +${lists.length - 4} more`);
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

if (!dueJobs.length) {
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
  const order = [...lists.slice(start), ...lists.slice(0, start)];
  log.step(`${jobId} — ${lists.length} list(s)${start ? ` (resuming at #${start + 1})` : ''}`);
  let complete = true;      // 1周を最後まで歩き、かつ全部書けた
  let walkedAll = true;     // 1周を最後まで歩いた（0件で飛ばしたぶんは含む）
  let done = 0;
  const parkAt = i => { cursor[jobId] = (start + i) % lists.length; };
  try {
  for (const desc of order) {
    if (!canSpend(QUOTA.costSearch)) {
      // 次回はここから。予算を使い切っても必ず前へ進む。
      parkAt(done);
      log.warn(`hard stop reached — stopping this job (resume at #${cursor[jobId] + 1}/${lists.length})`);
      complete = false;
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
      // 前回より極端に痩せた結果で上書きしない（API の気まぐれで「3件の月間ランキング」を
      // 公開してしまうのを防ぐ）。半分未満に減った場合だけ見送る。
      const prevCount = (await readJSON(join(DATA_DIR, `${id}.json`), null))?.items?.length || 0;
      if (prevCount >= 20 && raw.length < prevCount / 2) {
        log.warn(`${id}: ${raw.length} items vs ${prevCount} before — keeping the previous file`);
        complete = false;
        continue;
      }
      const items = applyRanks(raw, ranks);
      const res = await writeList({
        ...desc,
        items,
        windowStart: desc.days == null ? null : new Date(now.getTime() - desc.days * 864e5).toISOString(),
        generatedAt: nowISO,
        prevGeneratedAt,
      });
      written.push(res);
      const bucket = pools.get(desc.country);
      items.forEach(i => { bucket?.set(i.videoId, i); allSeen.set(i.videoId, i); });
      log.done(`${id}: ${items.length} items`);
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn(`${id}: ${err.message}`);
      complete = false;
    }
  }
  } catch (err) {
    // 割当ガードが途中で止めた場合。そのリストは書けていないので、次回はそこから retry する。
    if (err instanceof QuotaExceededError) { parkAt(done - 1); walkedAll = false; }
    throw err;
  }
  // 1周ぶん歩けたらカーソルを畳む（0件で飛ばした行があっても、位置としては先頭に戻ってよい）
  if (walkedAll) delete cursor[jobId];
  return complete;
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
      const top = await yt.mostPopular({ regionCode: mc.code, maxResults: 5, costVideos: QUOTA.costVideos });
      const ranked = top.filter(v => v.viewCount != null);
      // それでも重なるときは、まだ使っていない上位の動画に譲る（同じ絵が並ぶのを避ける）。
      const best = ranked.find(v => !usedVideoIds.has(v.videoId)) || ranked[0];
      if (!best) continue;
      usedVideoIds.add(best.videoId);
      // normalizeVideo は isShort:false 固定。長さから補正したものを母集団にも入れる
      // （補正前を入れると「伸び」ランキングの部門分けが全部 video 側に寄る）。
      const item = { ...best, isShort: best.durationSec > 0 && best.durationSec <= SHORT_MAX_SEC };
      items.push({
        country: mc.code, lat: mc.lat, lon: mc.lon,
        videoId: item.videoId, title: item.title, channelTitle: item.channelTitle,
        viewCount: item.viewCount, isShort: item.isShort,
      });
      allSeen.set(item.videoId, item);
      pools.get(mc.code)?.set(item.videoId, item);
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
    else if (job.id === 'tags') continue;                 // 最後にまとめて走らせる
    else complete = await runListJob(job.id);
    // 途中で打ち切ったジョブは lastRun を進めない。次の実行で残りを取りにいく。
    if (complete) lastRun[job.id] = nowISO;
    else log.warn(`${job.id}: incomplete — will be retried on the next run`);
    await persistState();                                 // ジョブ単位で確実に残す
  }
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
await writeIndex({
  source: 'youtube-api',
  countries: COUNTRIES.map(c => c.code),
  datasets,
  features: { growth: feature, map: true, tags: true },
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

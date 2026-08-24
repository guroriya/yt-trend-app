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
  COUNTRIES, SECTIONS, PERIODS, MAP_COUNTRIES, QUOTA, RETENTION, datasetId,
} from '../public/js/config.js';
import {
  DATA_DIR, STATE_DIR, chunk, ensureDir, listDir, log, parseArgs, quotaDate, readJSON, writeJSON,
} from './lib/util.mjs';
import { formatPlan, isDue, listsOfJob, planSchedule } from './lib/plan.mjs';
import { QuotaExceededError, YouTube, publishedAfterFor } from './lib/youtube.mjs';
import { SHORT_MAX_SEC, confirmShorts, pruneShortsCache } from './lib/shorts.mjs';
import {
  appendSnapshot, applyRanks, computeGrowthItems, growthFeature, loadPrevRanks,
  pruneSnapshots, snapshotForDaysAgo, writeIndex, writeList, writeMap, writeTags,
} from './lib/store.mjs';
import { rankTerms } from './lib/tags.mjs';

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
const lastRun = (await readJSON(LASTRUN_FILE, {})) || {};

const HARD_STOP = Math.floor(QUOTA.dailyUnits * 0.95);
const spentAtStart = budget.spent;
let currentJob = 'unknown';

const onSpend = (units, endpoint) => {
  budget.spent += units;
  budget.byJob[currentJob] = (budget.byJob[currentJob] || 0) + units;
  budget.byEndpoint[endpoint] = (budget.byEndpoint[endpoint] || 0) + units;
};
const canSpend = units => budget.spent + units <= HARD_STOP;

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
    const res = await yt.search({
      regionCode: desc.country,
      publishedAfter,
      videoCategoryId: desc.ytCategoryId || undefined,
      videoDuration,
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
  if (checked) log.info(`   shorts check: ${checked} verified, ${failed} fell back to duration`);

  let items = details.filter(d => (desc.section === 'shorts' ? d.isShort : !d.isShort));

  // 動画部門はショートを除いたぶん目減りする。旗艦ジョブだけ、余裕があれば1ページ足す。
  if (adaptive && desc.section === 'video' && items.length < desc.size * 0.6 && pageToken && canSpend(QUOTA.costSearch + QUOTA.costVideos)) {
    log.info(`   thin list (${items.length}/${desc.size}) — fetching one extra page`);
    const extra = await yt.search({
      regionCode: desc.country, publishedAfter,
      videoCategoryId: desc.ytCategoryId || undefined,
      maxResults: QUOTA.pageSize, pageToken, costSearch: QUOTA.costSearch,
    });
    const more = await yt.videos(extra.ids.slice(0, 50), { costVideos: QUOTA.costVideos });
    const cand2 = more.filter(d => d.durationSec > 0 && d.durationSec <= SHORT_MAX_SEC);
    const r2 = await confirmShorts(cand2, shortsCache, { now: now.getTime() });
    items.push(...more.map(d => ({ ...d, isShort: r2.decided.get(d.videoId) ?? false })).filter(d => !d.isShort));
  }

  items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  items = items.slice(0, desc.size);
  return items;
}

/** 国ごとの母集団（tags と growth が使う）。videoId → item */
const pools = new Map(COUNTRIES.map(c => [c.code, new Map()]));
const allSeen = new Map();           // スナップショット用（国をまたいだ和集合）
const written = [];

async function runListJob(jobId) {
  currentJob = jobId;
  const lists = listsOfJob(jobId);
  log.step(`${jobId} — ${lists.length} list(s)`);
  for (const desc of lists) {
    if (!canSpend(QUOTA.costSearch)) { log.warn('hard stop reached — stopping this job'); break; }
    const id = datasetId(desc.country, desc.section, desc.period, desc.category);
    try {
      const raw = await collectList(desc, { adaptive: jobId === 'top24h' });
      const { ranks, generatedAt: prevGeneratedAt } = await loadPrevRanks(id);
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
    }
  }
}

async function runMapJob() {
  currentJob = 'map';
  log.step(`map — ${MAP_COUNTRIES.length} countries`);
  const items = [];
  for (const mc of MAP_COUNTRIES) {
    if (!canSpend(QUOTA.costVideos)) break;
    try {
      const top = await yt.mostPopular({ regionCode: mc.code, maxResults: 5, costVideos: QUOTA.costVideos });
      const best = top.filter(v => v.viewCount != null).sort((a, b) => b.viewCount - a.viewCount)[0];
      if (!best) continue;
      items.push({
        country: mc.code, lat: mc.lat, lon: mc.lon,
        videoId: best.videoId, title: best.title, channelTitle: best.channelTitle,
        viewCount: best.viewCount, isShort: best.durationSec > 0 && best.durationSec <= SHORT_MAX_SEC,
      });
      allSeen.set(best.videoId, best);
      pools.get(mc.code)?.set(best.videoId, best);
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn(`map ${mc.code}: ${err.message}`);
    }
  }
  if (items.length) {
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
    const items = [];
    for (const f of files) {
      const d = await readJSON(join(DATA_DIR, f), null);
      if (d?.items) items.push(...d.items);
    }
    if (!items.length) continue;
    const prev = await readJSON(join(DATA_DIR, `tags-${c.code}.json`), null);
    const prevRanks = new Map((prev?.items || []).map(x => [x.term, x.rank]));
    const ranked = rankTerms(items, { prevRanks });
    await writeTags({ country: c.code, period: '24h', items: ranked, generatedAt: nowISO });
    log.done(`tags-${c.code}: ${ranked.length} terms`);
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
        if (!items.length) continue;
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
try {
  for (const job of dueJobs) {
    if (job.id === 'map') await runMapJob();
    else if (job.id === 'tags') continue;                 // 最後にまとめて走らせる
    else await runListJob(job.id);
    lastRun[job.id] = nowISO;
  }

  if (allSeen.size) await appendSnapshot([...allSeen.values()], now);
  const feature = await growthFeature(PERIODS, now);
  await runGrowth(feature);

  if (dueJobs.some(j => j.id === 'tags') || written.length) {
    await runTagsJob();
    lastRun.tags = nowISO;
  }
} catch (err) {
  if (err instanceof QuotaExceededError) {
    quotaHalted = true;
    log.warn(`stopped early: ${err.message}`);
  } else {
    throw err;
  }
}

/* -------------------------------------------------------- 後始末と index */

const removedSnaps = await pruneSnapshots(now);
if (removedSnaps.length) log.info(`pruned ${removedSnaps.length} snapshot(s) older than ${RETENTION.snapshotDays} days`);
const removedShorts = pruneShortsCache(shortsCache, now.getTime());
if (removedShorts) log.info(`pruned ${removedShorts} stale shorts-cache entries`);

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

await writeJSON(BUDGET_FILE, budget, { pretty: true });
await writeJSON(SHORTS_FILE, shortsCache);
await writeJSON(LASTRUN_FILE, lastRun, { pretty: true });

log.step('summary');
log.info(`lists written: ${written.length}`);
log.info(`units spent this run: ${budget.spent - spentAtStart} (today total ${budget.spent}/${QUOTA.dailyUnits})`);
log.info(`growth: ${feature.enabled ? feature.periods.join(', ') : `off (${feature.daysCollected}/${feature.requiredDays} days)`}`);
log.done('done');

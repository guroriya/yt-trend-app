/* scripts/lib/store.mjs — 出力・順位変動・スナップショット・保持期間（ORDER §2-6, §2-14, §8, §9）
 *
 * 置き場所の約束:
 *   public/data/*.json   … 公開する集計結果。**git には入れない**（実 API データのため / ORDER §8）
 *   state/prev/*.json    … 前回の順位（↑↓NEW の比較元）。videoId と rank だけ
 *   state/snapshots/*.gz … 日次スナップショット。31日で自動削除（ORDER §8）
 *
 * スナップショットは「伸び」ランキング（ORDER §2-14）のためだけに存在する。
 * 蓄積日数が足りない間は index.json の features.growth.enabled=false になり、UI からタブが消える。
 */

import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DATA_DIR, PREV_DIR, SNAP_DIR, ensureDir, listDir, readJSON, removeFile, utcDate, writeJSON,
} from './util.mjs';
import { RETENTION, datasetId } from '../../public/js/config.js';

/* ---------------------------------------------------------- 順位変動 ↑↓NEW */

export async function loadPrevRanks(id) {
  const prev = await readJSON(join(PREV_DIR, `${id}.json`), null);
  if (!prev) return { ranks: new Map(), generatedAt: null };
  return {
    ranks: new Map((prev.items || []).map(x => [x.videoId, x.rank])),
    generatedAt: prev.generatedAt || null,
  };
}

export async function savePrevRanks(id, items, generatedAt) {
  await writeJSON(join(PREV_DIR, `${id}.json`), {
    id, generatedAt,
    items: items.map(i => ({ videoId: i.videoId, rank: i.rank })),
  });
}

/** rank / prevRank / delta を付ける。prev に居なければ NEW（prevRank=null）。 */
export function applyRanks(items, prevRanks) {
  return items.map((item, i) => {
    const rank = i + 1;
    const prevRank = prevRanks.get(item.videoId) ?? null;
    return { ...item, rank, prevRank, delta: prevRank == null ? null : prevRank - rank };
  });
}

/* ------------------------------------------------------------------ 出力 */

export async function writeList({ country, section, period, category, metric = 'published', items, windowStart, generatedAt, prevGeneratedAt }) {
  const id = datasetId(country, section, period, category, metric);
  const payload = {
    schemaVersion: 1, id, country, section, period, category, metric,
    generatedAt, prevGeneratedAt: prevGeneratedAt ?? null,
    windowStart: windowStart ?? null,
    items,
  };
  await writeJSON(join(DATA_DIR, `${id}.json`), payload);
  await savePrevRanks(id, items, generatedAt);
  return { id, count: items.length, generatedAt };
}

export async function writeIndex({ source, countries, datasets, features, quota, generatedAt }) {
  await writeJSON(join(DATA_DIR, 'index.json'), {
    schemaVersion: 1,
    generatedAt,
    source,
    countries,
    datasets,
    features,
    quota,
    attribution: 'This product uses the YouTube API Services.',
  });
}

export async function writeMap({ items, generatedAt }) {
  await writeJSON(join(DATA_DIR, 'map.json'), { schemaVersion: 1, generatedAt, items });
}

export async function writeTags({ country, period, items, generatedAt }) {
  await writeJSON(join(DATA_DIR, `tags-${country}.json`), {
    schemaVersion: 1, country, generatedAt, period, items,
  });
}

/* -------------------------------------------------------- スナップショット */

const snapPath = date => join(SNAP_DIR, `${date}.json.gz`);

export async function loadSnapshot(date) {
  try {
    const buf = await readFile(snapPath(date));
    return JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch { return null; }
}

async function saveSnapshot(date, data) {
  await ensureDir(SNAP_DIR);
  await writeFile(snapPath(date), gzipSync(Buffer.from(JSON.stringify(data), 'utf8')));
}

/** その日のスナップショットに、今回見た動画の再生数と最小限のメタを足し込む。 */
export async function appendSnapshot(items, now = new Date()) {
  const date = utcDate(now);
  const snap = (await loadSnapshot(date)) || { date, videos: {} };
  for (const it of items) {
    if (!it.videoId || it.viewCount == null) continue;
    snap.videos[it.videoId] = {
      v: it.viewCount,
      t: it.title, c: it.channelTitle, ci: it.channelId,
      p: it.publishedAt, d: it.durationSec, s: !!it.isShort,
      k: it.categoryId, g: (it.tags || []).slice(0, 6),
    };
  }
  await saveSnapshot(date, snap);
  return { date, size: Object.keys(snap.videos).length };
}

export async function snapshotDates() {
  const files = await listDir(SNAP_DIR);
  return files.filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', '')).sort();
}

/** 保持期間を超えたスナップショットを削除する（ORDER §8: 31日で自動削除）。 */
export async function pruneSnapshots(now = new Date(), maxDays = RETENTION.snapshotDays) {
  const cutoff = utcDate(new Date(now.getTime() - maxDays * 864e5));
  const dates = await snapshotDates();
  const gone = [];
  for (const d of dates) {
    if (d < cutoff) { await removeFile(snapPath(d)); gone.push(d); }
  }
  return gone;
}

/* ------------------------------------------------ 「伸び」ランキング（v2） */

/**
 * その期間の「伸び」を出せるか。days 日前以前のスナップショットが要る。
 * @returns {{enabled:boolean, daysCollected:number, requiredDays:number, periods:string[]}}
 */
export async function growthFeature(periodsMeta, now = new Date()) {
  const dates = await snapshotDates();
  const daysCollected = dates.length;
  if (daysCollected < RETENTION.growthMinDays) {
    return { enabled: false, daysCollected, requiredDays: RETENTION.growthMinDays, periods: [] };
  }
  const oldest = dates[0];
  const ageDays = Math.floor((Date.parse(`${utcDate(now)}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 864e5);
  const periods = RETENTION.growthPeriods.filter(pid => {
    const days = periodsMeta.find(p => p.id === pid)?.days;
    return days != null && ageDays >= days;
  });
  return { enabled: periods.length > 0, daysCollected, requiredDays: RETENTION.growthMinDays, periods };
}

/** days 日前に最も近い（それ以上古い）スナップショットを返す。 */
export async function snapshotForDaysAgo(days, now = new Date()) {
  const target = utcDate(new Date(now.getTime() - days * 864e5));
  const dates = (await snapshotDates()).filter(d => d <= target);
  if (!dates.length) return null;
  return loadSnapshot(dates[dates.length - 1]);
}

/**
 * 「その期間で再生数が伸びた動画」を作る（投稿日は問わない / ORDER §2-14）。
 * pool は今回の実行で見た最新データ（videoId → item）。
 */
export function computeGrowthItems({ pool, past, size = 100, section }) {
  if (!past) return [];
  const out = [];
  for (const [videoId, item] of pool) {
    const before = past.videos?.[videoId];
    if (!before || item.viewCount == null) continue;
    const gain = item.viewCount - before.v;
    if (gain <= 0) continue;
    if (section === 'shorts' && !item.isShort) continue;
    if (section === 'video' && item.isShort) continue;
    out.push({ ...item, gain });
  }
  out.sort((a, b) => b.gain - a.gain);
  return out.slice(0, size);
}

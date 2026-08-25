/* scripts/lib/backfill.mjs — 全期間ランキングの遡り収集（2026-08-25 発注者改訂 第3弾）
 *
 * 仕組み（docs/BUDGET.md §バックフィル / docs/SCHEMA.md §候補プール）:
 *   1. publishedAfter/publishedBefore で年単位の「窓」を切り、search(order=viewCount) を
 *      窓ごとに1ページだけ取る（1窓 = search 100 + videos 1 = 101 units）
 *   2. 取れた動画を国ごとの候補プール state/pool/{国}.json.gz に貯める
 *   3. year / all のランキングはプールから 0 units で再構成する（rebuildRanking）
 *   4. プールの中身は videos.list（50件=1unit）で古い順に再取得し、ORDER §8 の
 *      「30日以内にリフレッシュまたは削除」を満たす（poolStaleIds / poolPrune）
 *
 * 窓の一覧は config と「今」から毎回決定的に作り直す。state に持つのはカーソル（窓番号）と
 * 完了フラグだけなので、途中で国を足すと新しい国だけが自動で歩き直しになる。
 * 年をまたぐと窓の切りが1つ増えてカーソルが少しずれるが、取得は upsert（冪等）なので
 * 同じ窓をもう一度取っても壊れない（多少の取り直しを許容する）。
 *
 * 純粋関数（backfillWindows / pool* / rebuildRanking）はブラウザでも import して検証できるよう
 * 上半分にまとめ、Node 依存の I/O（loadPool / savePool）は下半分に置く。
 */

import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_DIR, ensureDir, listDir } from './util.mjs';

/* ------------------------------------------------------------- 純粋ロジック */

const utcStart = (year, month) => new Date(Date.UTC(year, month, 1));

/**
 * 遡り収集の窓一覧（1国ぶん・video と shorts の両部門）。
 * 直近 splitRecentYears 年は投稿が多いので半年窓に細分化する。
 * @returns {Array<{section:string, after:string, before:string}>}
 */
export function backfillWindows(cfg, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  const out = [];
  const push = (section, from, to) => {
    if (from >= now) return;                       // 未来の窓は作らない
    out.push({ section, after: from.toISOString(), before: to.toISOString() });
  };
  for (const [section, startYear] of [['video', cfg.videoStartYear], ['shorts', cfg.shortsStartYear]]) {
    for (let year = startYear; year <= thisYear; year++) {
      if (year > thisYear - cfg.splitRecentYears) {
        push(section, utcStart(year, 0), utcStart(year, 6));
        push(section, utcStart(year, 6), utcStart(year + 1, 0));
      } else {
        push(section, utcStart(year, 0), utcStart(year + 1, 0));
      }
    }
  }
  return out;
}

/** プールに残す正規化された1件。ランキング出力（writeList の items）と同じ語彙＋ fetchedAt。 */
export function poolEntryOf(item, fetchedAt) {
  return {
    videoId: item.videoId,
    title: item.title || '',
    channelId: item.channelId || '',
    channelTitle: item.channelTitle || '',
    publishedAt: item.publishedAt ?? null,
    viewCount: item.viewCount ?? null,
    likeCount: item.likeCount ?? null,
    commentCount: item.commentCount ?? null,
    durationSec: item.durationSec ?? 0,
    isShort: !!item.isShort,
    categoryId: item.categoryId ?? null,
    tags: (item.tags || []).slice(0, 8),
    fetchedAt,
  };
}

/** 動画をプールへ足し込む（冪等）。既存より新しい取得値で常に上書きする。 */
export function poolUpsert(pool, items, fetchedAt) {
  let added = 0;
  for (const it of items) {
    if (!it?.videoId || it.viewCount == null) continue;
    if (!pool[it.videoId]) added++;
    pool[it.videoId] = poolEntryOf(it, fetchedAt);
  }
  return added;
}

/** 上限を超えたら再生数の少ない順に間引く。戻り値は消した件数。 */
export function poolEvict(pool, max) {
  const ids = Object.keys(pool);
  if (ids.length <= max) return 0;
  ids.sort((a, b) => (pool[b].viewCount ?? 0) - (pool[a].viewCount ?? 0));
  let removed = 0;
  for (const id of ids.slice(max)) { delete pool[id]; removed++; }
  return removed;
}

/** 再取得すべき id を古い順に返す（ORDER §8 のリフレッシュ）。 */
export function poolStaleIds(pool, { limit = 100, now = Date.now() } = {}) {
  return Object.keys(pool)
    .sort((a, b) => Date.parse(pool[a].fetchedAt || 0) - Date.parse(pool[b].fetchedAt || 0))
    .slice(0, limit);
}

/**
 * ORDER §8 の最終防衛: 30日を超えて再取得できていない項目は削除する。
 * （毎日の poolrefresh が回っていれば実際にはここまで来ない。）
 */
export function poolPrune(pool, { maxAgeDays, now = Date.now() } = {}) {
  const cutoff = now - maxAgeDays * 864e5;
  let removed = 0;
  for (const [id, e] of Object.entries(pool)) {
    const t = Date.parse(e?.fetchedAt || 0);
    if (!Number.isFinite(t) || t < cutoff) { delete pool[id]; removed++; }
  }
  return removed;
}

/**
 * videos.list の再取得結果をプールへ反映する。返ってこなかった動画（削除・非公開化）は
 * miss を数え、2回連続で欠けたら諦めて消す（1回の欠けは API の気まぐれがあり得る）。
 */
export function poolApplyRefresh(pool, askedIds, freshItems, fetchedAt) {
  const got = new Map(freshItems.map(i => [i.videoId, i]));
  let removed = 0;
  for (const id of askedIds) {
    const entry = pool[id];
    if (!entry) continue;
    const fresh = got.get(id);
    if (fresh) {
      pool[id] = { ...poolEntryOf(fresh, fetchedAt), isShort: entry.isShort };  // ショート判定は再判定しない
    } else if (entry.miss) {
      delete pool[id]; removed++;
    } else {
      entry.miss = 1;
      entry.fetchedAt = fetchedAt;                 // 次の周回でもう一度だけ聞く
    }
  }
  return removed;
}

/**
 * プールから year / all のランキングを再構成する（0 units）。
 * @returns {Array} viewCount 降順・上位 size 件（rank などは呼び出し側で付ける）
 */
export function rebuildRanking(pool, { section, days = null, size = 100, now = new Date() } = {}) {
  const since = days == null ? null : now.getTime() - days * 864e5;
  const out = [];
  for (const e of Object.values(pool)) {
    if (e.viewCount == null) continue;
    if (section === 'shorts' ? !e.isShort : e.isShort) continue;
    if (since != null) {
      const t = e.publishedAt ? Date.parse(e.publishedAt) : NaN;
      if (!Number.isFinite(t) || t < since) continue;
    }
    const { fetchedAt, miss, ...item } = e;
    out.push(item);
  }
  out.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  return out.slice(0, size);
}

/* -------------------------------------------------------------- 状態 I/O */

export const POOL_DIR = join(STATE_DIR, 'pool');
export const BACKFILL_FILE = join(STATE_DIR, 'backfill.json');

const poolPath = country => join(POOL_DIR, `${country}.json.gz`);

export async function loadPool(country) {
  try {
    const buf = await readFile(poolPath(country));
    const parsed = JSON.parse(gunzipSync(buf).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export async function savePool(country, pool) {
  await ensureDir(POOL_DIR);
  await writeFile(poolPath(country), gzipSync(Buffer.from(JSON.stringify(pool), 'utf8')));
}

export async function poolCountries() {
  const files = await listDir(POOL_DIR);
  return files.filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', ''));
}

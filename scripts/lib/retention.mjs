/* scripts/lib/retention.mjs — 保持期間の掃除（ORDER §8）
 *
 *   「取得したAPIデータの保存は30日以内にリフレッシュまたは削除」
 *   「時系列スナップショットは31日で自動削除するジョブを入れる」
 *
 * 収集本体（collect.mjs）からも、APIキー無しで単独でも（scripts/retention.mjs）呼べるようにしてある。
 * キーが外された・失効したまま放置されても保持期間だけは守られる、という状態を保つのが目的。
 */

import { join } from 'node:path';
import { DATA_DIR, PREV_DIR, STATE_DIR, listDir, log, readJSON, removeFile, writeJSON } from './util.mjs';
import { pruneShortsCache } from './shorts.mjs';
import { pruneSnapshots } from './store.mjs';
import { loadPool, poolCountries, poolPrune, savePool } from './backfill.mjs';
import { RETENTION } from '../../public/js/config.js';

const SHORTS_FILE = join(STATE_DIR, '_shorts_cache.json');

/**
 * @param {object} [o]
 * @param {Date}   [o.now]
 * @param {object} [o.shortsCache] 呼び出し側が持っているキャッシュ（渡さなければファイルから読む）
 * @param {boolean}[o.saveShorts]  キャッシュをここで書き戻すか（collect.mjs は自分で書くので false）
 * @returns {Promise<{snapshots:string[], prev:string[], datasets:string[], shorts:number, pool:number}>}
 */
export async function runRetention({ now = new Date(), shortsCache = null, saveShorts = true } = {}) {
  const out = { snapshots: [], prev: [], datasets: [], shorts: 0, pool: 0 };
  const maxAgeMs = RETENTION.dataMaxAgeDays * 864e5;
  const tooOld = iso => {
    const ts = iso ? Date.parse(iso) : NaN;
    return !Number.isFinite(ts) || now.getTime() - ts > maxAgeMs;
  };

  // 1. 日次スナップショット（31日）
  out.snapshots = await pruneSnapshots(now);

  // 2. ショート判定キャッシュ（TTL 切れ）
  const cache = shortsCache || (await readJSON(SHORTS_FILE, {})) || {};
  out.shorts = pruneShortsCache(cache, now.getTime());
  if (saveShorts && out.shorts) await writeJSON(SHORTS_FILE, cache);

  // 3. 公開中のデータセット（30日）
  for (const f of await listDir(DATA_DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const d = await readJSON(join(DATA_DIR, f), null);
    if (!d) continue;
    if (tooOld(d.generatedAt)) {
      await removeFile(join(DATA_DIR, f));
      out.datasets.push(f);
    }
  }

  // 4. 前回順位（videoId を持つので同じく API 由来データ）
  for (const f of await listDir(PREV_DIR)) {
    if (!f.endsWith('.json')) continue;
    const d = await readJSON(join(PREV_DIR, f), null);
    if (!d || tooOld(d.generatedAt)) {
      await removeFile(join(PREV_DIR, f));
      out.prev.push(f);
    }
  }

  // 5. データセットを消したら index.json の目次も直す
  //    （消したまま index に残すと scripts/validate.mjs が落ちて公開できなくなる）
  if (out.datasets.length) await refreshIndexDatasets(now);

  // 6. 全期間バックフィルの候補プール（30日）。毎日の poolrefresh が回っていれば実際には
  //    ここまで来ない。キーの失効等でリフレッシュが止まっても保持期間だけは守る最終防衛。
  for (const code of await poolCountries()) {
    const pool = await loadPool(code);
    const removed = poolPrune(pool, { maxAgeDays: RETENTION.dataMaxAgeDays, now: now.getTime() });
    if (removed) { await savePool(code, pool); out.pool += removed; }
  }

  const total = out.snapshots.length + out.prev.length + out.datasets.length + out.shorts + out.pool;
  if (total) {
    log.info(`retention: snapshots ${out.snapshots.length}, prev ${out.prev.length}, datasets ${out.datasets.length}, shorts-cache ${out.shorts}, pool ${out.pool}`);
  }
  return out;
}

/** public/data の実物から index.json の datasets を作り直す。 */
export async function refreshIndexDatasets(now = new Date()) {
  const indexPath = join(DATA_DIR, 'index.json');
  const index = await readJSON(indexPath, null);
  if (!index) return null;
  const datasets = {};
  for (const f of await listDir(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    if (f === 'index.json' || f === 'map.json' || f.startsWith('tags-')) continue;
    const d = await readJSON(join(DATA_DIR, f), null);
    if (!d?.id) continue;
    datasets[d.id] = {
      generatedAt: d.generatedAt,
      count: d.items?.length ?? 0,
      stale: (now.getTime() - Date.parse(d.generatedAt)) / 864e5 > RETENTION.dataMaxAgeDays,
    };
  }
  index.datasets = datasets;
  await writeJSON(indexPath, index);
  return datasets;
}

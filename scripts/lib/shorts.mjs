/* scripts/lib/shorts.mjs — ショート判定（ORDER §2-2）
 *
 *   長さ ≤ 3分 を候補にし、https://www.youtube.com/shorts/{videoId} の到達性で確定する。
 *   この HTTP 確認は **API 割当を消費しない**。
 *   ショートでない動画に /shorts/{id} でアクセスすると /watch?v={id} へリダイレクトされる、
 *   という YouTube の挙動を使う（リダイレクトを追って最終 URL を見る）。
 *
 *   判定結果は state/_shorts_cache.json に 30日 TTL で保存する。
 *   ネットワークが不調なときは「長さ ≤ 3分ならショート」というヒューリスティックに落ちる
 *   （ORDER は数%の誤判定を許容している）。
 */

import { pMap } from './pure.mjs';

const SHORTS_URL = id => `https://www.youtube.com/shorts/${id}`;
const TTL_MS = 30 * 864e5;
// 判定できなかったとき（タイムアウト・同意画面など）の推測も短い TTL で覚えておく。
// 覚えないと同じ動画を毎回叩き直してしまい、失敗が続くほど実行時間だけが伸びる。
const GUESS_TTL_MS = 6 * 3600e3;
const MAX_SEC = 180;

/**
 * @param {Array<{videoId:string,durationSec:number}>} items
 * @param {object} cache  state/_shorts_cache.json の中身 { [videoId]: {v:boolean, t:number} }
 * @param {object} [opts]
 * @returns {Promise<{decided: Map<string, boolean>, checked: number, failed: number}>}
 */
export async function confirmShorts(items, cache, { concurrency = 6, now = Date.now() } = {}) {
  const decided = new Map();
  const toCheck = [];

  for (const it of items) {
    if (it.durationSec > MAX_SEC) { decided.set(it.videoId, false); continue; }  // 3分超は候補外
    const hit = cache[it.videoId];
    const ttl = hit && hit.guess ? GUESS_TTL_MS : TTL_MS;
    if (hit && now - hit.t < ttl) { decided.set(it.videoId, hit.v); continue; }
    toCheck.push(it.videoId);
  }

  let failed = 0;
  await pMap(toCheck, async id => {
    const verdict = await isShortByHttp(id);
    if (verdict === null) {
      failed++;
      decided.set(id, true);                       // フォールバック: 3分以内なのでショート扱い
      cache[id] = { v: true, t: now, guess: true }; // 短い TTL で覚え、同じ実行内で叩き直さない
      return;
    }
    decided.set(id, verdict);
    cache[id] = { v: verdict, t: now };
  }, concurrency);

  return { decided, checked: toCheck.length, failed };
}

/**
 * リダイレクト先の URL で判定する。
 *   /shorts/{id} のまま 200  → ショート
 *   /watch?v={id} に飛ばされた → ショートではない
 * `redirect:'manual'` でステータスだけ見るより確実（同意画面などで 200 を返されても、
 * 最終 URL を見れば取り違えない）。本文は読まずに捨てるので転送量も小さい。
 * @returns {Promise<boolean|null>} null は判定不能（ネットワーク不調）
 */
export async function isShortByHttp(videoId) {
  try {
    const res = await fetch(SHORTS_URL(videoId), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'accept': 'text/html',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (compatible; TrendZapBot/0.1; +https://github.com/)',
      },
      signal: AbortSignal.timeout(8000),
    });
    // 本文は使わないので即座に捨てる（ソケットを解放する）
    try { await res.body?.cancel?.(); } catch { /* noop */ }
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) return null;
    const finalUrl = res.url || '';
    if (finalUrl.includes('/shorts/')) return true;
    if (finalUrl.includes('/watch')) return false;
    return null;                     // 同意画面などに飛ばされた: 判定せずヒューリスティックに任せる
  } catch {
    return null;
  }
}

/** TTL 切れのキャッシュを捨てる（ORDER §8 の保存期間ガードも兼ねる）。 */
export function pruneShortsCache(cache, now = Date.now()) {
  let removed = 0;
  for (const [id, entry] of Object.entries(cache)) {
    const ttl = entry && entry.guess ? GUESS_TTL_MS : TTL_MS;
    if (!entry || now - entry.t >= ttl) { delete cache[id]; removed++; }
  }
  return removed;
}

export const SHORT_MAX_SEC = MAX_SEC;

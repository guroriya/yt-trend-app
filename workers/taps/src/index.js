// ============================================================================
// workers/taps/src/index.js — Cloudflare Workers 入口（ORDER §2-15 / P5 / v4 グループ）
//
//   POST /tap          {country:"JP", videoId:"..."}  → 204（当日の UTC カウンタを +1）
//   GET  /stats        ?date=YYYY-MM-DD（省略で当日） → {date, total, countries}
//   POST /g                                           → 201 {id}（グループ作成）
//   POST /g/{id}/add   {videoId:"..."}                → 204（グループに動画を追加）
//   GET  /g/{id}                                      → {createdAt, updatedAt, items}
//   GET  /oembed       ?v={videoId}                   → {title, author}（YouTube oEmbed の中継）
//
// 方針:
//   - 保存は KV（binding: TAPS）のみ。タップは day:{date}（TTL 31日）、グループは g:{id}
//     （TTL 90日・追加のたびに貼り直し＝90日追加が無ければ自動消滅）
//   - IP・User-Agent・Cookie はどこにも書かない。console.log も出さない（ORDER §2-15）。
//     連打対策の IP スロットルだけは isolate のメモリ内で一瞬持つが、永続化は一切しない
//   - ロジックはすべて lib.mjs（純粋関数）。この層は I/O の薄い皮に徹する
//   - /oembed を中継するのは youtube.com/oembed が CORS ヘッダを返さないため。
//     API 割当は消費しない（oEmbed はキー不要の公開エンドポイント）
// デプロイ手順は NEEDS_HUMAN.md ゲートB。1回のデプロイでタップ集計とグループの両方が有効になる。
// ============================================================================

import {
  DAY_TTL_SECONDS, utcDateOf, isValidDate, validateTap,
  emptyDay, reviveDay, applyTap, publicStats, corsHeaders,
  GROUP_TTL_SECONDS, GROUP_CREATES_PER_DAY, groupIdFrom, isValidGroupId,
  validateGroupAdd, emptyGroup, reviveGroup, applyGroupAdd, publicGroup, canAddToday,
} from './lib.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/* isolate 単位のメモリ内スロットル。KV の書込み枠（無料 1,000回/日）を守るための簡易ガードで、
   isolate が入れ替わればリセットされる（厳密さより「何も保存しない」ことを優先）。 */
const ipHits = new Map();
function throttled(ip, limit) {
  if (!ip) return false;
  const minute = Math.floor(Date.now() / 60_000);
  const e = ipHits.get(ip);
  if (!e || e.minute !== minute) {
    if (ipHits.size > 10_000) ipHits.clear();
    ipHits.set(ip, { minute, n: 1 });
    return false;
  }
  e.n += 1;
  return e.n > limit;
}

/** POST 本文を 256 バイト上限つきで読む（SCHEMA §7 と同じ契約）。壊れていたら null。 */
async function readSmallJson(request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 256) return { tooLarge: true, body: null };
    return { tooLarge: false, body: JSON.parse(text) };
  } catch {
    return { tooLarge: false, body: null };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin'), env.ALLOWED_ORIGINS ?? '*');
    const ip = request.headers.get('cf-connecting-ip');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* ---------------------------------------------- v4 グループランキング */

    if (request.method === 'POST' && url.pathname === '/g') {
      if (throttled(ip, 5)) return new Response(null, { status: 429, headers: cors });
      const date = utcDateOf(Date.now());
      const counterKey = `gcreate:${date}`;
      const made = Number(await env.TAPS.get(counterKey)) || 0;
      if (made >= GROUP_CREATES_PER_DAY) return new Response(null, { status: 429, headers: cors });
      // 36^10 ≒ 3.6×10^15 通り。衝突は事実上起きない（起きても既存グループを上書きするだけで
      // 個人情報は無いが、その確率のために read を1回増やす価値は無いと判断）。
      const id = groupIdFrom(crypto.getRandomValues(new Uint8Array(10)));
      try {
        await env.TAPS.put(`g:${id}`, JSON.stringify(emptyGroup(Date.now())), { expirationTtl: GROUP_TTL_SECONDS });
        await env.TAPS.put(counterKey, String(made + 1), { expirationTtl: 2 * 86400 });
      } catch {
        // KV の書込み枠に当たった。グループ作成は黙って落とせない（リンクが配れない）ので 503。
        return new Response(null, { status: 503, headers: cors });
      }
      return new Response(JSON.stringify({ id }), { status: 201, headers: { ...JSON_HEADERS, ...cors } });
    }

    const addMatch = request.method === 'POST' && url.pathname.match(/^\/g\/([a-z0-9]{10})\/add$/);
    if (addMatch) {
      if (throttled(ip, 30)) return new Response(null, { status: 429, headers: cors });
      const { tooLarge, body } = await readSmallJson(request);
      if (tooLarge) return new Response(null, { status: 413, headers: cors });
      const add = validateGroupAdd(body);
      if (!add) return new Response(null, { status: 400, headers: cors });
      const key = `g:${addMatch[1]}`;
      const group = reviveGroup(await env.TAPS.get(key, 'json'));
      if (!group) return new Response(null, { status: 404, headers: cors });
      if (!canAddToday(group, Date.now())) return new Response(null, { status: 429, headers: cors });
      try {
        await env.TAPS.put(key, JSON.stringify(applyGroupAdd(group, add.videoId, Date.now())),
          { expirationTtl: GROUP_TTL_SECONDS });
      } catch {
        /* KV の同一キー書込みは 1回/秒。グループに同時に追加すると負けた側が消えることがある
           （近似を許容・タップと同じ扱い）。失敗しても 5xx にはしない。 */
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/g/')) {
      const id = url.pathname.slice(3);
      if (!isValidGroupId(id)) return new Response(null, { status: 400, headers: cors });
      const group = reviveGroup(await env.TAPS.get(`g:${id}`, 'json'));
      if (!group) return new Response(null, { status: 404, headers: cors });
      return new Response(JSON.stringify(publicGroup(group, Date.now())), {
        status: 200,
        // クライアントは 30 秒ポーリングする。共有キャッシュに乗せない（cors がオリジン依存のため）。
        headers: { ...JSON_HEADERS, ...cors, 'cache-control': 'no-store' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/oembed') {
      const v = url.searchParams.get('v') || '';
      if (!VIDEO_ID_RE.test(v)) return new Response(null, { status: 400, headers: cors });
      const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v}`)}&format=json`;
      const cache = caches.default;
      const cacheKey = new Request(target);
      let cached = await cache.match(cacheKey);
      if (!cached) {
        const upstream = await fetch(target);
        if (!upstream.ok) return new Response(null, { status: 404, headers: cors });
        let meta = null;
        try { meta = await upstream.json(); } catch { /* fall through */ }
        if (!meta) return new Response(null, { status: 404, headers: cors });
        // 出すのは題名と投稿者名だけ（表示に使う最小限）。CORS はオリジン依存なのでキャッシュには入れない。
        cached = new Response(JSON.stringify({ title: meta.title || '', author: meta.author_name || '' }), {
          headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=86400' },
        });
        await cache.put(cacheKey, cached.clone());
      }
      const body = await cached.text();
      return new Response(body, {
        status: 200,
        headers: { ...JSON_HEADERS, ...cors, 'cache-control': 'public, max-age=86400', vary: 'origin' },
      });
    }

    /* --------------------------------------------------- v3 タップ集計 */

    if (request.method === 'POST' && url.pathname === '/tap') {
      let body = null;
      try {
        const text = await request.text();
        // SCHEMA §7 の契約は「256 バイト」。文字数（UTF-16 単位）ではなくバイト長で測る
        if (new TextEncoder().encode(text).length > 256) return new Response(null, { status: 413, headers: cors });
        body = JSON.parse(text);
      } catch { /* fall through to 400 */ }
      const tap = validateTap(body);
      if (!tap) return new Response(null, { status: 400, headers: cors });

      const date = utcDateOf(Date.now());
      const key = `day:${date}`;
      try {
        const day = reviveDay(await env.TAPS.get(key, 'json'), date);
        await env.TAPS.put(key, JSON.stringify(applyTap(day, tap)), { expirationTtl: DAY_TTL_SECONDS });
      } catch {
        /* KV は同一キーへの書き込みが 1回/秒・無料枠 1,000回/日。day:{date} は単一の
           ホットキーなので、瞬間的に集中すると put が投げる。近似カウンタの取りこぼしは
           設計上許容（SCHEMA §7）なので、失敗しても 5xx にせず黙って 204 を返す。 */
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/stats') {
      const q = url.searchParams.get('date');
      if (q !== null && !isValidDate(q)) return new Response(null, { status: 400, headers: cors });
      const date = q ?? utcDateOf(Date.now());
      const day = reviveDay(await env.TAPS.get(`day:${date}`, 'json'), date);
      return new Response(JSON.stringify(publicStats(day)), {
        status: 200,
        headers: { ...JSON_HEADERS, ...cors, 'cache-control': 'public, max-age=60' },
      });
    }

    return new Response(null, { status: 404, headers: cors });
  },
};

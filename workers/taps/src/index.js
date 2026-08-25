// ============================================================================
// workers/taps/src/index.js — Cloudflare Workers 入口（ORDER §2-15 / P5）
//
//   POST /tap    {country:"JP", videoId:"..."}  → 204（当日の UTC カウンタを +1）
//   GET  /stats  ?date=YYYY-MM-DD（省略で当日） → {date, total, countries}
//
// 方針:
//   - 保存は KV（binding: TAPS）の日次キー day:{date} 1本だけ。TTL 31日（ORDER §8 準拠）
//   - IP・User-Agent・Cookie はどこにも書かない。console.log も出さない（ORDER §2-15）
//   - ロジックはすべて lib.mjs（純粋関数）。この層は I/O の薄い皮に徹する
// デプロイ手順は NEEDS_HUMAN.md ゲートB。ローカル Node 無しでもデプロイは
// `npx wrangler deploy`（Node 導入後）で完結する。
// ============================================================================

import {
  DAY_TTL_SECONDS, utcDateOf, isValidDate, validateTap,
  emptyDay, reviveDay, applyTap, publicStats, corsHeaders,
} from './lib.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin'), env.ALLOWED_ORIGINS ?? '*');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method === 'POST' && url.pathname === '/tap') {
      let body = null;
      try {
        const text = await request.text();
        if (text.length > 256) return new Response(null, { status: 413, headers: cors });
        body = JSON.parse(text);
      } catch { /* fall through to 400 */ }
      const tap = validateTap(body);
      if (!tap) return new Response(null, { status: 400, headers: cors });

      const date = utcDateOf(Date.now());
      const key = `day:${date}`;
      const day = reviveDay(await env.TAPS.get(key, 'json'), date);
      await env.TAPS.put(key, JSON.stringify(applyTap(day, tap)), { expirationTtl: DAY_TTL_SECONDS });
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

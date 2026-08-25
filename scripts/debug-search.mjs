// scripts/debug-search.mjs — search.list が 0 件を返す原因のパラメータ特定（一時診断用）
// 出力は「組み合わせ名: 件数 or エラー」だけ。キーや完全 URL はログに出さない。
const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error('YT_API_KEY missing'); process.exit(1); }
const BASE = 'https://www.googleapis.com/youtube/v3';
const iso = h => new Date(Date.now() - h * 3600e3).toISOString();
const day = iso(24);

const base = { part: 'id', type: 'video', order: 'viewCount', regionCode: 'JP', publishedAfter: day, maxResults: '50', safeSearch: 'none' };
const combos = [
  ['A: 現行そのまま',            { ...base }],
  ['B: safeSearch なし',         { ...base, safeSearch: undefined }],
  ['C: order なし(relevance)',   { ...base, order: undefined }],
  ['D: publishedAfter なし',     { ...base, publishedAfter: undefined }],
  ['E: q="a" を追加',            { ...base, q: 'a' }],
  ['F: part=snippet',            { ...base, part: 'snippet' }],
  ['G: order=date',              { ...base, order: 'date' }],
  ['H: ミリ秒なし publishedAfter', { ...base, publishedAfter: day.replace(/\.\d{3}Z$/, 'Z') }],
];

for (const [name, params] of combos) {
  const url = new URL(`${BASE}/search`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set('key', KEY);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`${name}: HTTP ${res.status} ${body?.error?.errors?.[0]?.reason || ''} ${body?.error?.message || ''}`);
    } else {
      console.log(`${name}: ${body?.items?.length ?? 'no-items-field'} 件  totalResults=${body?.pageInfo?.totalResults}`);
    }
  } catch (e) { console.log(`${name}: fetch error ${e.message}`); }
}

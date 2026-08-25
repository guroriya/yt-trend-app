// scripts/debug-search.mjs — q 候補の品質確認（一時診断用）
// 各候補で: 件数 / totalResults / 上位3件の再生数とタイトル先頭（言語・並び順の妥当性を見る）
const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error('YT_API_KEY missing'); process.exit(1); }
const BASE = 'https://www.googleapis.com/youtube/v3';
const day = new Date(Date.now() - 24 * 3600e3).toISOString();

const cases = [
  ['JP q=a',      { regionCode: 'JP', q: 'a' }],
  ['JP q=の',     { regionCode: 'JP', q: 'の' }],
  ['JP q=a|の',   { regionCode: 'JP', q: 'a|の' }],
  ['US q=a',      { regionCode: 'US', q: 'a' }],
  ['JP q=*',      { regionCode: 'JP', q: '*' }],
];

for (const [name, extra] of cases) {
  const url = new URL(`${BASE}/search`);
  const params = { part: 'id', type: 'video', order: 'viewCount', publishedAfter: day,
                   maxResults: '50', safeSearch: 'none', ...extra };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', KEY);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) { console.log(`${name}: HTTP ${res.status} ${body?.error?.message || ''}`); continue; }
    const ids = (body.items || []).map(i => i.id?.videoId).filter(Boolean);
    let detail = '';
    if (ids.length) {
      const vu = new URL(`${BASE}/videos`);
      vu.searchParams.set('part', 'snippet,statistics');
      vu.searchParams.set('id', ids.slice(0, 3).join(','));
      vu.searchParams.set('key', KEY);
      const v = await (await fetch(vu)).json();
      detail = (v.items || []).map(x => `${Number(x.statistics?.viewCount).toLocaleString()}回 "${(x.snippet?.title || '').slice(0, 16)}"`).join(' / ');
    }
    console.log(`${name}: ${ids.length} 件 total=${body.pageInfo?.totalResults}  ${detail}`);
  } catch (e) { console.log(`${name}: fetch error ${e.message}`); }
}

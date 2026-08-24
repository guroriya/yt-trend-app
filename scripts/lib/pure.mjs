/* scripts/lib/pure.mjs — Node の組み込みモジュールに依存しない小道具だけを集めた場所
 *
 * なぜ分けるか: ローカルに Node が無い開発機（NEEDS_HUMAN.md ゲート0）でも、
 * ここに置いた関数はブラウザから import して実際に走らせて検証できる。
 * fs / zlib を触るものは util.mjs 側に置く。
 */

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** YouTube の割当は太平洋時間の 0:00 にリセットされる。その日付を YYYY-MM-DD で返す。 */
export function quotaDate(now = new Date(), timeZone = 'America/Los_Angeles') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC 日付（スナップショットのファイル名用）。 */
export const utcDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** 並列度を絞って map する。 */
export async function pMap(items, fn, concurrency = 6) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** ISO8601 duration (PT1H2M3S / P1DT2H / PT30S) を秒に。壊れた入力は 0。 */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + Math.round(+s || 0);
}

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** `--key=value` / `--flag` を解釈する。 */
export function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv || []) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      out[k] = rest.length ? rest.join('=') : true;
    } else out._.push(a);
  }
  return out;
}

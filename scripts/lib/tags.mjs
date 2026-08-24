/* scripts/lib/tags.mjs — タグ／頻出ワードの勢いランキング（ORDER §2-12）
 *
 *   いま公開しているランキングのタイトルとタグから自前で集計する。API 割当は 0 units。
 *   言語別ストップワードを除去し、「その語を含む動画の再生数合計」を対数圧縮してスコアにする。
 *   （再生数をそのまま足すと1本の巨大動画だけで順位が決まってしまうため）
 */

const STOP_EN = new Set(`
a an the and or but if then than that this these those there here
i you he she it we they me him her them my your his its our their
is am are was were be been being do does did done have has had
of in on at to for with from by as into over under about after before
not no nor so too very can will just should now new get got make made
video vs feat ft official music mv full hd 4k live shorts short trailer
part ep episode day days year years time best top how why what when who
`.trim().split(/\s+/));

const STOP_JA = new Set(`
これ それ あれ この その あの ここ そこ あそこ こと もの ため など よう
です ます した して いる ある する なる から まで より ない だけ という
それでは そして しかし また さらに とても すごい やばい 動画 公式 最新
本編 前編 後編 第一話 実況 放送 配信 生放送 期間 限定 今日 明日 今回
`.trim().split(/\s+/));

/** タイトル＋タグから語を取り出す。日本語は形態素解析が使えないので保守的に切る。 */
export function extractTerms(item) {
  const out = new Set();
  for (const raw of (item.tags || []).slice(0, 8)) {
    const v = String(raw).trim().toLowerCase();
    if (v.length >= 2 && v.length <= 24 && !STOP_EN.has(v) && !STOP_JA.has(v)) out.add(v);
  }
  const title = String(item.title || '');
  for (const w of title.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []) {
    if (!STOP_EN.has(w)) out.add(w);
  }
  for (const w of title.match(/[ァ-ヴー]{3,}/g) || []) {          // カタカナ語
    if (!STOP_JA.has(w)) out.add(w);
  }
  for (const w of title.match(/[一-龥]{2,4}/g) || []) {           // 漢字の連なり
    if (!STOP_JA.has(w)) out.add(w);
  }
  return [...out];
}

/**
 * @param {Array} items      集計対象の動画（複数リストの和集合）
 * @param {object} [opts]
 * @param {Map<string,number>} [opts.prevRanks] 前回の順位（delta 用）
 * @returns {Array<{rank:number,term:string,score:number,count:number,delta:number|null,videoIds:string[]}>}
 */
export function rankTerms(items, { prevRanks = new Map(), size = 24, minCount = 2 } = {}) {
  const acc = new Map();                    // term → { score, count, ids:Set }
  for (const item of items) {
    const weight = Math.log10(Math.max(10, item.viewCount || 0));   // 1本の巨大動画に支配されないよう対数
    for (const term of extractTerms(item)) {
      let e = acc.get(term);
      if (!e) acc.set(term, (e = { score: 0, count: 0, ids: new Set() }));
      e.score += weight;
      e.count += 1;
      if (e.ids.size < 3) e.ids.add(item.videoId);
    }
  }
  const rows = [...acc.entries()]
    .filter(([, e]) => e.count >= minCount)
    .map(([term, e]) => ({ term, score: Math.round(e.score * 10) / 10, count: e.count, videoIds: [...e.ids] }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, size);

  return rows.map((r, i) => {
    const prev = prevRanks.get(r.term);
    return { rank: i + 1, ...r, delta: prev == null ? null : prev - (i + 1) };
  });
}

export const STOPWORDS = { en: STOP_EN, ja: STOP_JA };

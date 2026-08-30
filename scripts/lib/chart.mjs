/* scripts/lib/chart.mjs — ランキングの合流規則（2026-08-30 改訂・同日レビューで拡張）
 *
 * なぜあるか:
 *   本体ランキングは search.list（投稿期間×再生数順）で作るが、search の索引は網羅的でなく、
 *   急上昇1位級の動画を取りこぼす（2026-08-30 実測: 急上昇の 363万回再生が 24h ランキングに不在）。
 *   さらに top24h は毎日1回（発注者改訂 第3弾）なので、日中に伸びた動画は翌日まで見えない。
 *   chart=mostPopular は 1 unit/国 と search の 1/100 なので、毎時回してもほぼ無料の側路になる。
 *
 * **書き手が2つあるリストは、両方がこの関数を通す**（24h/週間/月間 × カテゴリ総合）。
 *   - `chart` ジョブ … 既存リストへ急上昇を合流させる（fresh = 急上昇）
 *   - `top24h`/`weekmonth` … search の結果を既存リストへ合流させる（fresh = search）
 *   search 側が素の上書きだと、chart だけが知る動画（＝search の索引が返さないもの）が
 *   次の完走で必ず消える。急上昇の寿命（数日）は週間・月間の窓（7日/30日）より短いので、
 *   一度消えた大物は窓の残り期間ずっと戻らない（2026-08-30 レビューの確定指摘）。
 *
 * 合流の約束（schema.mjs validateRanking を破らない）:
 *   - fresh は「追加」と「統計の更新」だけ。既存の行を数の都合で消さない
 *   - **窓の外に出た行は落とす**（「その期間に投稿された動画の順位表」という定義に従う）。
 *     入れるときは厳しく（日付が読めない fresh は入れない）、残すときは寛容に
 *     （日付が読めない既存行は落とさない＝取りこぼしで痩せさせない）
 *   - 同じ動画は fresh 側の数値で上書きする（fresh は「いま」＝必ず新しい）
 *   - 再生数の降順に並べ直し、上限 size で切る
 */

/**
 * @param {Array} existing 公開中のランキングの items（rank 付きでよい・そのまま持ち回る）
 * @param {Array} fresh    normalizeVideo 形の新しい動画（isShort は確定済み・部門で絞ってから渡す）
 * @param {object} o
 * @param {string|null} o.windowStart この時刻より古い投稿は入れない／残さない（null=全期間）
 * @param {number} o.size 上限件数（config の Math.min(cat.size, per.size) と揃える）
 * @returns {{items: Array, added: number, touched: number, dropped: number}}
 *   added=新規に入った数 / touched=数値を更新した数 / dropped=窓の外に出て落とした既存行の数
 */
export function mergeIntoList(existing, fresh, { windowStart = null, size = 100 } = {}) {
  const windowMs = windowStart == null ? null : Date.parse(windowStart);

  // 既存行: 日付が読めて、かつ窓より古いと分かったものだけ落とす
  const byId = new Map();
  let dropped = 0;
  for (const it of existing || []) {
    if (!it || !it.videoId) continue;
    if (windowMs != null) {
      const pub = it.publishedAt == null ? NaN : Date.parse(it.publishedAt);
      if (!Number.isNaN(pub) && pub < windowMs) { dropped++; continue; }
    }
    byId.set(it.videoId, { ...it });
  }

  let added = 0;
  let touched = 0;
  for (const f of fresh || []) {
    if (!f || !f.videoId || f.viewCount == null) continue;
    if (windowMs != null) {
      const pub = f.publishedAt == null ? NaN : Date.parse(f.publishedAt);
      if (!(pub >= windowMs)) continue;      // 窓の外（と読めない日付）は入れない
    }
    const prev = byId.get(f.videoId);
    if (prev) {
      if ((f.viewCount ?? null) !== (prev.viewCount ?? null)) touched++;
      byId.set(f.videoId, { ...prev, ...f }); // 統計・タイトルを新しい方へ（rank 系は後段 applyRanks が振り直す）
    } else {
      byId.set(f.videoId, { ...f });
      added++;
    }
  }

  const items = [...byId.values()]
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    .slice(0, size);
  return { items, added, touched, dropped };
}

/** そのリストに書き手が2つあるか（chart ジョブが合流させる範囲と同義）。 */
export function isMultiWriterList({ period, category }) {
  return category === 'all' && ['24h', 'week', 'month'].includes(period);
}

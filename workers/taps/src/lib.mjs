// ============================================================================
// workers/taps/src/lib.mjs — v3 匿名タップ集計の「純粋なロジック」（ORDER §2-15）
//
// ここには Workers API（KV / fetch / env）を一切書かない。理由:
//   - ローカルに Node が無くても、ブラウザで import して検証できる（CLAUDE.md §5）
//   - tests/unit-worker.spec.js が CI（Node）で直接テストできる
//
// 保存するのは 国コード＋動画ID＋日付 のカウンタのみ（ORDER §2-15）。
// 個人識別情報・IP・User-Agent は「保存しない」ではなく「この層に存在しない」。
// ============================================================================

/** KV に置く日次キーの TTL。ORDER §8 の保存30日制約に合わせ、31日で自動消滅させる。 */
export const DAY_TTL_SECONDS = 31 * 86400;

/** 1日のカウンタに残す動画IDの上限。超えたら数の少ない順に間引く（値の肥大防止）。 */
export const MAX_VIDEO_KEYS = 2000;
export const PRUNE_TO = 1000;

/** UTC の日付文字列。集計日はサーバー時刻（UTC）で切る。クライアントの時計は信用しない。 */
export function utcDateOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && utcDateOf(t) === s;
}

/**
 * POST /tap の本文を検証して {country, videoId} を返す。通らなければ null。
 * ここが唯一の入口検証なので、緩めない:
 *   - country: ISO 3166-1 alpha-2 の形（大文字2桁）。実在チェックはしない（新しい国コードで壊れない）
 *   - videoId: YouTube の 11 文字 ID の形
 */
export function validateTap(body) {
  if (!body || typeof body !== 'object') return null;
  const { country, videoId } = body;
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return null;
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return { country, videoId };
}

/** その日の空のカウンタ。 */
export function emptyDay(date) {
  return { date, total: 0, countries: {}, videos: {} };
}

/** 保存済み JSON を安全に読み戻す（壊れていたら作り直す。1件の破損で集計を止めない）。 */
export function reviveDay(raw, date) {
  if (!raw || typeof raw !== 'object') return emptyDay(date);
  const ok = raw.date === date
    && typeof raw.total === 'number'
    && raw.countries && typeof raw.countries === 'object'
    && raw.videos && typeof raw.videos === 'object';
  return ok ? raw : emptyDay(date);
}

/**
 * 1タップぶんカウンタを進める。KV の read-modify-write は同時実行で負けた側の
 * 加算が消えることがある（=多少の取りこぼし）。独自指標の近似値としては許容し、
 * その事実を docs/SCHEMA.md に明記する（正確な合算が要るなら Durable Objects へ）。
 */
export function applyTap(day, tap) {
  const d = { date: day.date, total: day.total + 1,
    countries: { ...day.countries }, videos: { ...day.videos } };
  d.countries[tap.country] = (d.countries[tap.country] || 0) + 1;
  d.videos[tap.videoId] = (d.videos[tap.videoId] || 0) + 1;
  const ids = Object.keys(d.videos);
  if (ids.length > MAX_VIDEO_KEYS) {
    ids.sort((a, b) => d.videos[b] - d.videos[a]);
    const keep = {};
    for (const id of ids.slice(0, PRUNE_TO)) keep[id] = d.videos[id];
    d.videos = keep;
  }
  return d;
}

/** GET /stats で外に出す形。動画別の内訳は出さない（表示に使うのは合計と国別だけ）。 */
export function publicStats(day) {
  return { date: day.date, total: day.total, countries: day.countries };
}

/**
 * CORS ヘッダ。allowed は '*' か、カンマ区切りの許可オリジン列。
 * カウンタは公開データで認証情報も無いので既定 '*' で実害はないが、
 * Pages のオリジンに絞れるよう wrangler.toml の ALLOWED_ORIGINS で差し替え可能にする。
 */
export function corsHeaders(origin, allowed = '*') {
  const list = String(allowed).split(',').map(s => s.trim()).filter(Boolean);
  const ok = list.includes('*') || (origin && list.includes(origin));
  return {
    'access-control-allow-origin': ok ? (list.includes('*') ? '*' : origin) : 'null',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

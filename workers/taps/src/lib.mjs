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

/* ==========================================================================
 * v4 グループランキング（2026-08-25 発注者改訂 第3弾）
 *
 * 「リンクを知っている人だけが参加できる匿名の共有リスト」。友達やグループで
 * いまザッピングしている動画を追加し合い、追加数×新しさのランキングになる。
 *   - 認証なし。URL に含まれる推測困難な ID（59bit 乱数）そのものが鍵
 *   - 保存は 動画ID・追加回数・時刻 のみ。名前・IP・UA など「誰が」は仕組み上存在しない
 *   - 90日間 追加が無いグループは KV の TTL で自動消滅する
 * ========================================================================== */

/** グループの TTL。追加のたびに貼り直す ＝「90日追加が無ければ消える」。 */
export const GROUP_TTL_SECONDS = 90 * 86400;
/** 1グループに残す動画数。超えたらスコアの低い順に間引く。 */
export const GROUP_MAX_ITEMS = 200;
/** 1グループ・1日あたりの追加回数上限（悪用対策）。 */
export const GROUP_MAX_ADDS_PER_DAY = 300;
/** 全体で1日に作れるグループ数（悪用対策）。 */
export const GROUP_CREATES_PER_DAY = 100;
/** ホットスコアの半減期（時間）。追加から3日で重みが半分になる。 */
export const GROUP_HALF_LIFE_HOURS = 72;

const GROUP_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 乱数バイト列 → グループID（10文字 ≒ 51bit。URL に載せやすい小文字英数のみ）。 */
export function groupIdFrom(bytes) {
  let out = '';
  for (let i = 0; i < 10; i++) out += GROUP_ID_ALPHABET[bytes[i] % GROUP_ID_ALPHABET.length];
  return out;
}

export function isValidGroupId(s) {
  return typeof s === 'string' && /^[a-z0-9]{10}$/.test(s);
}

/** POST /g/{id}/add の本文検証。受け付けるのは動画IDだけ（自由文は一切保存しない）。 */
export function validateGroupAdd(body) {
  if (!body || typeof body !== 'object') return null;
  const { videoId } = body;
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return { videoId };
}

export function emptyGroup(nowMs) {
  return { v: 1, createdAt: nowMs, updatedAt: nowMs, adds: {}, videos: {} };
}

/** 保存済み JSON を安全に読み戻す（壊れていたら null ＝ 404 に落とす。作り直しはしない）。 */
export function reviveGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ok = raw.v === 1
    && typeof raw.createdAt === 'number'
    && typeof raw.updatedAt === 'number'
    && raw.adds && typeof raw.adds === 'object'
    && raw.videos && typeof raw.videos === 'object';
  return ok ? raw : null;
}

/** 追加数 × 新しさ。n 回追加された動画が、最後の追加から半減期ごとに重みを半分にしていく。 */
export function hotScore(n, atMs, nowMs) {
  const ageH = Math.max(0, (nowMs - atMs) / 3600e3);
  return n * Math.pow(2, -ageH / GROUP_HALF_LIFE_HOURS);
}

/** その日の追加回数が上限に達していないか。 */
export function canAddToday(group, nowMs) {
  return (group.adds[utcDateOf(nowMs)] || 0) < GROUP_MAX_ADDS_PER_DAY;
}

/**
 * 1件追加する。同じ動画をもう一度（別の人が）追加すると n が増えてスコアが上がる。
 * 上限を超えたらスコアの低い順に間引く。日別カウンタは当日ぶんだけ残す（肥大防止）。
 */
export function applyGroupAdd(group, videoId, nowMs) {
  const date = utcDateOf(nowMs);
  const g = {
    v: 1, createdAt: group.createdAt, updatedAt: nowMs,
    adds: { [date]: (group.adds[date] || 0) + 1 },
    videos: { ...group.videos },
  };
  const prev = g.videos[videoId];
  g.videos[videoId] = { n: (prev?.n || 0) + 1, at: nowMs };
  const ids = Object.keys(g.videos);
  if (ids.length > GROUP_MAX_ITEMS) {
    ids.sort((a, b) => hotScore(g.videos[b].n, g.videos[b].at, nowMs) - hotScore(g.videos[a].n, g.videos[a].at, nowMs));
    const keep = {};
    for (const id of ids.slice(0, GROUP_MAX_ITEMS)) keep[id] = g.videos[id];
    g.videos = keep;
  }
  return g;
}

/** GET /g/{id} で外に出す形。スコア降順のランキング。 */
export function publicGroup(group, nowMs) {
  const items = Object.entries(group.videos)
    .map(([videoId, e]) => ({
      videoId, count: e.n, addedAt: e.at,
      score: Math.round(hotScore(e.n, e.at, nowMs) * 1000) / 1000,
    }))
    .sort((a, b) => b.score - a.score || b.addedAt - a.addedAt);
  return { createdAt: group.createdAt, updatedAt: group.updatedAt, items };
}

/**
 * CORS ヘッダ。allowed は '*' か、カンマ区切りの許可オリジン列。
 * カウンタは公開データで認証情報も無いので既定 '*' で実害はないが、
 * Pages のオリジンに絞れるよう wrangler.toml の ALLOWED_ORIGINS で差し替え可能にする。
 * 注意（レビュー 2026-08-25 で修正）:
 *   - 不許可時に ACAO:'null' を返すと、sandbox iframe / file:// の Origin はまさに
 *     文字列 "null" なので照合が成立してしまう（fail-open）。不許可時はヘッダ自体を出さない。
 *   - 許可リスト運用ではレスポンスがオリジンごとに変わるため Vary: Origin を必ず付ける
 *     （/stats は max-age=60 で共有キャッシュに乗るので、無いと誤配される）。
 */
export function corsHeaders(origin, allowed = '*') {
  const list = String(allowed).split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
  if (list.includes('*')) { h['access-control-allow-origin'] = '*'; return h; }
  h['vary'] = 'origin';
  if (origin && origin !== 'null' && list.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

/* scripts/lib/youtube.mjs — YouTube Data API v3 クライアント（依存ゼロ / Node 20 の fetch を使う）
 *
 * 使う API は2つだけ:
 *   search.list        100 units  … 期間内投稿を再生数順に並べた id を得る
 *   videos.list          1 unit   … statistics / contentDetails / snippet をまとめて得る
 *                                   chart=mostPopular でも 1 unit（世界地図用）
 *
 * 消費した units は必ず onSpend で外に通知する。ここが割当会計の唯一の入口。
 * APIキーはログにも例外メッセージにも絶対に出さない（ORDER §1-7）。
 */

import { parseDuration, sleep } from './pure.mjs';

const BASE = 'https://www.googleapis.com/youtube/v3';

export class QuotaExceededError extends Error {
  constructor(message) { super(message); this.name = 'QuotaExceededError'; }
}
export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}

export class YouTube {
  /**
   * @param {object} o
   * @param {string} o.apiKey
   * @param {(units:number, endpoint:string)=>void} o.onSpend
   * @param {()=>boolean} [o.canSpend] false を返したら以降の呼び出しを止める
   */
  constructor({ apiKey, onSpend = () => {}, canSpend = () => true }) {
    if (!apiKey) throw new Error('YT_API_KEY is missing');
    this.apiKey = apiKey;
    this.onSpend = onSpend;
    this.canSpend = canSpend;
  }

  async #call(endpoint, params, cost) {
    if (!this.canSpend(cost)) throw new QuotaExceededError('local quota guard stopped the run');
    const url = new URL(`${BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    url.searchParams.set('key', this.apiKey);
    // 表示用（キーを外した URL）。例外メッセージにはこちらだけを使う。
    const safeUrl = `${endpoint}?${[...url.searchParams].filter(([k]) => k !== 'key').map(([k, v]) => `${k}=${v}`).join('&')}`;

    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) {
        // リトライも同じだけ割当を食う。1回ぶんの認可で4回投げてしまわないよう毎回ガードを見る。
        if (!this.canSpend(cost)) throw new QuotaExceededError(`local quota guard stopped the retry of ${safeUrl}`);
        await sleep(500 * 2 ** attempt);
      }
      // units は「リクエストを投げた時点」で消費される。タイムアウトや切断で応答を
      // 読めなくても、サーバー側では消費済み。だから fetch の前に必ず計上する。
      this.onSpend(cost, endpoint);
      let res;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      } catch (err) {
        lastErr = new ApiError(`network error on ${safeUrl}: ${err.message}`, 0);
        continue;
      }
      if (res.ok) return res.json();

      let body = null;
      try { body = await res.json(); } catch { /* ignore */ }
      const reason = body?.error?.errors?.[0]?.reason || '';
      const message = body?.error?.message || res.statusText;

      if (res.status === 403 && /quota/i.test(reason + message)) {
        throw new QuotaExceededError(`quota exceeded (${reason}) on ${safeUrl}`);
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiError(`${res.status} ${reason || message} on ${safeUrl}`, res.status);
        continue;                       // リトライ対象
      }
      // reason だけだと「badRequest」しか残らず原因が特定できない（実例: 発行直後の
      // API キーが有効化前で全呼び出しが 400 になった）。message も必ず併記する。
      // Google のエラーメッセージにキーの値そのものは含まれない。
      throw new ApiError(`${res.status} ${reason}${message && message !== reason ? `: ${message}` : ''} on ${safeUrl}`, res.status);
    }
    throw lastErr ?? new ApiError(`failed after retries on ${safeUrl}`, 0);
  }

  /**
   * 期間内に投稿された動画の id を再生数順に。part=id にして転送量を減らす（費用は同じ100）。
   * @returns {Promise<{ids: string[], nextPageToken: string|undefined}>}
   */
  async search({ regionCode, publishedAfter, publishedBefore, videoCategoryId, videoDuration, q, maxResults = 50, pageToken, costSearch = 100 }) {
    const data = await this.#call('search', {
      part: 'id',
      type: 'video',
      order: 'viewCount',
      q, // q なしは常に 0 件（config.js SEARCH_Q 参照）
      regionCode,
      publishedAfter,
      publishedBefore,     // バックフィル（年窓）用。通常収集では渡さない
      videoCategoryId,
      videoDuration,
      maxResults,
      pageToken,
      safeSearch: 'none',
    }, costSearch);
    return {
      ids: (data.items || []).map(i => i.id?.videoId).filter(Boolean),
      nextPageToken: data.nextPageToken,
    };
  }

  /** id 指定で詳細を取る（50件/回・1 unit）。 */
  async videos(ids, { costVideos = 1 } = {}) {
    if (!ids.length) return [];
    // maxResults は id 指定の videos.list では使えない（併用すると 400 になる）。
    // id は最大50件までで、それ以上は呼び出し側で chunk 済み。
    const data = await this.#call('videos', {
      part: 'snippet,statistics,contentDetails',
      id: ids.slice(0, 50).join(','),
    }, costVideos);
    return (data.items || []).map(normalizeVideo);
  }

  /** その国で「いま人気」の動画（世界地図用・1 unit）。 */
  async mostPopular({ regionCode, videoCategoryId, maxResults = 5, costVideos = 1 } = {}) {
    const data = await this.#call('videos', {
      part: 'snippet,statistics,contentDetails',
      chart: 'mostPopular',
      regionCode,
      videoCategoryId,
      maxResults,
    }, costVideos);
    return (data.items || []).map(normalizeVideo);
  }
}

/** API レスポンス → docs/SCHEMA.md の item 形（rank / prevRank / delta は後段で付ける）。 */
export function normalizeVideo(v) {
  const sn = v.snippet || {};
  const st = v.statistics || {};
  const cd = v.contentDetails || {};
  const durationSec = parseDuration(cd.duration);
  return {
    videoId: v.id,
    title: sn.title || '',
    channelId: sn.channelId || '',
    channelTitle: sn.channelTitle || '',
    publishedAt: sn.publishedAt || null,
    viewCount: st.viewCount == null ? null : Number(st.viewCount),
    likeCount: st.likeCount == null ? null : Number(st.likeCount),
    commentCount: st.commentCount == null ? null : Number(st.commentCount),
    durationSec,
    isShort: false,                       // 確定は shorts.mjs
    categoryId: sn.categoryId || null,
    tags: (sn.tags || []).slice(0, 8),
  };
}

/** period の days から publishedAfter（RFC3339）を作る。days=null（全期間）は undefined。 */
export function publishedAfterFor(days, now = new Date()) {
  if (days == null) return undefined;
  return new Date(now.getTime() - days * 864e5).toISOString();
}

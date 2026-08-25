// ============================================================================
// yt-trend-app — 設定はこの1ファイルだけ（ORDER §2-4「設定ファイル1箇所で増減」）
// フロント (public/app.js) と 収集スクリプト (scripts/*.mjs) の両方がこれを import する。
// ここを編集したら docs/BUDGET.md の予算表を必ず更新すること（ORDER §4）。
// ============================================================================

/** ランキングを出す国。ここに足すだけで n 国対応になる。 */
export const COUNTRIES = [
  { code: 'JP', flag: '🇯🇵', lat: 36.2, lon: 138.3, hl: 'ja', primary: true },
  { code: 'US', flag: '🇺🇸', lat: 39.8, lon: -98.6, hl: 'en', primary: true },
];

/** 部門（ORDER §2-2）。 */
export const SECTIONS = [
  { id: 'video',  maxDurationSec: null, urlKind: 'watch'  },
  { id: 'shorts', maxDurationSec: 180,  urlKind: 'shorts' },
];

/** 期間（ORDER §2-1）。days=null は全期間。 */
export const PERIODS = [
  { id: '24h',   days: 1,    refresh: 'hourly',  size: 100 },
  { id: 'week',  days: 7,    refresh: 'daily',   size: 100 },
  { id: 'month', days: 30,   refresh: 'daily',   size: 100 },
  { id: 'year',  days: 365,  refresh: 'weekly',  size: 100 },
  { id: 'all',   days: null, refresh: 'weekly',  size: 100 },
];

/**
 * カテゴリ（ORDER §2-3, YouTube 公式 videoCategory 準拠）。
 * `periods` は「そのカテゴリを取る期間」。割当の都合で総合以外は 24h のみ（ORDER §2-3）。
 */
export const CATEGORIES = [
  { id: 'all',           ytId: null, periods: ['24h', 'week', 'month', 'year', 'all'], size: 100 },
  { id: 'music',         ytId: '10', periods: ['24h'], size: 50 },
  { id: 'gaming',        ytId: '20', periods: ['24h'], size: 50 },
  { id: 'entertainment', ytId: '24', periods: ['24h'], size: 50 },
  { id: 'sports',        ytId: '17', periods: ['24h'], size: 50 },
  { id: 'news',          ytId: '25', periods: ['24h'], size: 50 },
];

/** UI 言語（ORDER §2-5）。既定は英語。 */
export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];
export const DEFAULT_LANG = 'en';

/** 世界地図タブ用（ORDER §2-13）。videos.list(chart=mostPopular) は 1 unit なので安い。 */
export const MAP_COUNTRIES = [
  { code: 'JP', lat: 36.2,  lon: 138.3  }, { code: 'US', lat: 39.8,  lon: -98.6  },
  { code: 'GB', lat: 54.0,  lon: -2.0   }, { code: 'DE', lat: 51.2,  lon: 10.4   },
  { code: 'FR', lat: 46.6,  lon: 2.4    }, { code: 'ES', lat: 40.2,  lon: -3.7   },
  { code: 'IT', lat: 42.8,  lon: 12.6   }, { code: 'RU', lat: 61.5,  lon: 90.0   },
  { code: 'KR', lat: 36.5,  lon: 127.9  }, { code: 'IN', lat: 22.4,  lon: 78.9   },
  { code: 'ID', lat: -2.5,  lon: 118.0  }, { code: 'TH', lat: 15.1,  lon: 101.0  },
  { code: 'VN', lat: 16.0,  lon: 106.0  }, { code: 'PH', lat: 12.9,  lon: 122.0  },
  { code: 'AU', lat: -25.3, lon: 133.8  }, { code: 'NZ', lat: -41.5, lon: 172.8  },
  { code: 'BR', lat: -10.8, lon: -52.9  }, { code: 'MX', lat: 23.6,  lon: -102.6 },
  { code: 'AR', lat: -35.4, lon: -65.2  }, { code: 'CA', lat: 56.1,  lon: -106.3 },
  { code: 'ZA', lat: -28.5, lon: 24.7   }, { code: 'NG', lat: 9.1,   lon: 8.7    },
  { code: 'EG', lat: 26.8,  lon: 30.8   }, { code: 'TR', lat: 39.0,  lon: 35.2   },
  { code: 'SA', lat: 24.0,  lon: 45.1   }, { code: 'PL', lat: 51.9,  lon: 19.1   },
];

/**
 * search.list は q（検索語）なしだと常に 0 件を返す（2026-08-25 に実測で確認。
 * 診断の経緯は DECISIONS.md）。しかも q は事実上コンテンツ言語を決める。
 * そこで「その言語のほぼすべての動画のタイトル/説明に含まれる語」の OR を言語別に渡す。
 * キーは COUNTRIES[].hl。国を増やすときは対応する言語をここに足す（無ければ default）。
 * ごく一部（これらの語を一切含まない動画）の取りこぼしは許容する（ショート判定の数%誤差と同格）。
 */
export const SEARCH_Q = {
  ja: 'の|に|を|が|は',
  en: 'a|the|i|to',
  default: 'a|the',
};

/** 広告カードの挿入間隔。ORDER §2-9 の原文は8件ごとだが、2026-08-25 の発注者指示で
    「使いやすさ優先・煩わしくなく、それでも表示する」= 10件ごとに変更（DECISIONS.md）。 */
export const AD_EVERY = 10;

/** API 割当のセーフガード（ORDER §4）。 */
export const QUOTA = {
  dailyUnits: 10000,
  softLimitRatio: 0.8,      // 8,000 units を超える構成なら自動で頻度を落とす
  costSearch: 100,
  costVideos: 1,
  pageSize: 50,
  resetTimeZone: 'America/Los_Angeles', // YouTube の割当リセットは PT 0時
};

/**
 * 収集ジョブと既定の実効間隔（時間）。ORDER §4 のセーフガードはここを起点に働く:
 * 予算超過なら priority の大きい順に間隔を倍にして落とし、
 * 割当（QUOTA.dailyUnits）を増やせば top24h から順に間隔を詰める。
 * 詳細と算出根拠は docs/BUDGET.md。
 */
export const SCHEDULE = {
  cronHours: 1, // GitHub Actions の cron は毎時。実行するかどうかは planner が決める
  jobs: [
    { id: 'top24h',     everyHours: 6,   floorHours: 24,  priority: 1, desiredHours: 1 },
    { id: 'weekmonth',  everyHours: 24,  floorHours: 168, priority: 2, desiredHours: 24 },
    { id: 'categories', everyHours: 24,  floorHours: 168, priority: 3, desiredHours: 24 },
    { id: 'yearall',    everyHours: 168, floorHours: 720, priority: 4, desiredHours: 168 },
    { id: 'map',        everyHours: 24,  floorHours: 168, priority: 5, desiredHours: 24 },
    // タグ集計は公開中の JSON を数え直すだけで API を使わない（0 units）。
    // planner の対象に入れておくと「いつ回すか」も1箇所で管理できる。
    { id: 'tags',       everyHours: 6,   floorHours: 24,  priority: 6, desiredHours: 6 },
  ],
};

/** スナップショット保持（ORDER §8: 30日以内にリフレッシュまたは削除）。 */
export const RETENTION = {
  snapshotDays: 31,          // 31日で自動削除
  dataMaxAgeDays: 30,        // 表示データはこれを超えたら stale 扱い
  growthMinDays: 3,          // 「伸び」ランキング解禁に必要な蓄積日数（ORDER §2-14）
  growthPeriods: ['24h', 'week', 'month'], // 年間・全期間は投稿日ベースのまま
};

/**
 * v3 匿名タップ集計（ORDER §2-15）。endpoint が空の間は完全に無効（送信も取得もしない）。
 * ゲートB（NEEDS_HUMAN.md）で workers/taps をデプロイしたら、その URL をここに入れるだけ。
 * 送るのは 国コード＋動画ID のみ。個人識別情報は仕組み上存在しない（docs/SCHEMA.md §タップ集計）。
 */
export const TAPS = {
  endpoint: '',        // 例: 'https://trendzap-taps.<account>.workers.dev'
  statsTtlMs: 60_000,  // 表示用統計のメモリキャッシュ
};

/** v2 端末内学習（ORDER §2-11）。外部送信は一切しない。 */
export const LEARNING = {
  storageKey: 'ytta.my.v1',
  weights: { impression: 1, open: 12, dwellBonus: 3 },
  halfLifeDays: 14,          // 興味スコアの半減期
  maxTerms: 400,
  maxChannels: 300,
};

export const CONFIG = {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, LANGUAGES, DEFAULT_LANG,
  MAP_COUNTRIES, AD_EVERY, QUOTA, SCHEDULE, RETENTION, LEARNING, TAPS, SEARCH_Q,
};
export default CONFIG;

/** データファイル名の唯一の決め方。フロントと収集で共有する。 */
export function datasetId(country, section, period, category = 'all', metric = 'published') {
  const m = metric === 'growth' ? '-growth' : '';
  return `${country}-${section}-${period}-${category}${m}`;
}
export function datasetPath(country, section, period, category = 'all', metric = 'published') {
  return `data/${datasetId(country, section, period, category, metric)}.json`;
}

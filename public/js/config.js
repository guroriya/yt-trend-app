// ============================================================================
// yt-trend-app — 設定はこの1ファイルだけ（ORDER §2-4「設定ファイル1箇所で増減」）
// フロント (public/app.js) と 収集スクリプト (scripts/*.mjs) の両方がこれを import する。
// ここを編集したら docs/BUDGET.md の予算表を必ず更新すること（ORDER §4）。
// ============================================================================

/** ランキングを出す国。ここに足すだけで n 国対応になる。 */
export const COUNTRIES = [
  { code: 'JP', flag: '🇯🇵', lat: 36.2, lon: 138.3, hl: 'ja', primary: true },
  { code: 'US', flag: '🇺🇸', lat: 39.8, lon: -98.6, hl: 'en', primary: true },
  // 2026-08-25 発注者改訂（第2弾）: 期間別ランキングの対象国を追加。ここに足すだけで
  // 収集・UI・テストが追随する。追加前に docs/BUDGET.md を更新すること（ORDER §4）。
  { code: 'KR', flag: '🇰🇷', lat: 36.5, lon: 127.9, hl: 'ko', primary: true },
  { code: 'GB', flag: '🇬🇧', lat: 54.0, lon: -2.0,  hl: 'en', primary: true },
  // 2026-08-25 発注者改訂（第3弾）: 24hランキングを毎日更新に緩めた予算で国別を強化。
  // まず IN/BR の2カ国（無料枠内）。増枠（ゲートF: 20,000）が通ったら FR/DE を足して8カ国にする。
  { code: 'IN', flag: '🇮🇳', lat: 22.4,  lon: 78.9,  hl: 'hi', primary: true },
  { code: 'BR', flag: '🇧🇷', lat: -10.8, lon: -52.9, hl: 'pt', primary: true },
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
 * `periods` は「そのカテゴリを取る期間」。2026-08-25 の発注者改訂で全カテゴリが全期間に対応（ORDER §2-3 改訂注記）。
 */
// 2026-08-25 発注者改訂（第2弾）: カテゴリ別タブを全期間に拡張（従来は割当の都合で24hのみ）。
// 収集は期間帯ごとに別ジョブ（categories / catweekmonth / catyearall）で、planner が予算内に収める。
export const CATEGORIES = [
  { id: 'all',           ytId: null, periods: ['24h', 'week', 'month', 'year', 'all'], size: 100 },
  { id: 'music',         ytId: '10', periods: ['24h', 'week', 'month', 'year', 'all'], size: 50 },
  { id: 'gaming',        ytId: '20', periods: ['24h', 'week', 'month', 'year', 'all'], size: 50 },
  { id: 'entertainment', ytId: '24', periods: ['24h', 'week', 'month', 'year', 'all'], size: 50 },
  { id: 'sports',        ytId: '17', periods: ['24h', 'week', 'month', 'year', 'all'], size: 50 },
  { id: 'news',          ytId: '25', periods: ['24h', 'week', 'month', 'year', 'all'], size: 50 },
];

/** UI 言語（ORDER §2-5）。既定は英語。 */
export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];
export const DEFAULT_LANG = 'en';

/** 世界地図タブ用（ORDER §2-13）。videos.list(chart=mostPopular) は 1 unit なので安い。
    2026-08-25 発注者改訂（第3弾）「国別を強くする」で 26→60カ国に拡充。
    mostPopular 非対応の国が混ざっていても収集は落ちない（国単位で握って前回値を残す実装）。
    実走ログで恒常的に失敗する国が見つかったらここから外す。 */
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
  { code: 'NL', lat: 52.2,  lon: 5.3    }, { code: 'BE', lat: 50.6,  lon: 4.7    },
  { code: 'CH', lat: 46.8,  lon: 8.2    }, { code: 'AT', lat: 47.6,  lon: 14.1   },
  { code: 'SE', lat: 62.0,  lon: 15.0   }, { code: 'NO', lat: 64.5,  lon: 11.0   },
  { code: 'DK', lat: 56.0,  lon: 9.5    }, { code: 'FI', lat: 64.0,  lon: 26.0   },
  { code: 'PT', lat: 39.6,  lon: -8.0   }, { code: 'GR', lat: 39.0,  lon: 22.0   },
  { code: 'CZ', lat: 49.8,  lon: 15.5   }, { code: 'HU', lat: 47.2,  lon: 19.4   },
  { code: 'RO', lat: 45.9,  lon: 25.0   }, { code: 'UA', lat: 48.4,  lon: 31.2   },
  { code: 'IE', lat: 53.4,  lon: -8.0   }, { code: 'IL', lat: 31.4,  lon: 35.0   },
  { code: 'AE', lat: 24.0,  lon: 54.0   }, { code: 'PK', lat: 30.0,  lon: 69.3   },
  { code: 'BD', lat: 23.7,  lon: 90.4   }, { code: 'LK', lat: 7.9,   lon: 80.7   },
  { code: 'NP', lat: 28.4,  lon: 84.1   }, { code: 'MY', lat: 4.2,   lon: 102.0  },
  { code: 'SG', lat: 1.35,  lon: 103.8  }, { code: 'TW', lat: 23.7,  lon: 121.0  },
  { code: 'HK', lat: 22.3,  lon: 114.2  }, { code: 'CL', lat: -35.7, lon: -71.5  },
  { code: 'CO', lat: 4.6,   lon: -74.1  }, { code: 'PE', lat: -9.2,  lon: -75.0  },
  { code: 'KE', lat: 0.0,   lon: 37.9   }, { code: 'MA', lat: 31.8,  lon: -7.1   },
  { code: 'TN', lat: 34.0,  lon: 9.6    }, { code: 'GH', lat: 7.9,   lon: -1.0   },
  { code: 'TZ', lat: -6.4,  lon: 34.9   }, { code: 'SN', lat: 14.5,  lon: -14.5  },
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
  ko: '이|의|는|을|하',
  // 2026-08-25 発注者改訂（第3弾）の国追加ぶん。hi はヒングリッシュ（ローマ字表記）の動画を
  // 取りこぼす可能性がある。IN の実データが貯まったら件数を見て `|the|a` 混合への切替を判断する。
  hi: 'के|में|है|की|का',
  pt: 'de|que|em|para|com',
  fr: 'de|le|la|les|des',   // ゲートF（増枠）後に FR を足すとき用
  de: 'der|die|und|das|mit', // 同上（DE 用）
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
    // 2026-08-25 発注者改訂（第3弾）: 「24時間ランキングは当面毎日1回でよい。浮いた予算で国別を強く」。
    // top24h は desiredHours=24 のキャップで毎日に固定し、増枠後の余りは weekmonth → categories へ
    // 流れる（priority 順の昇格）。再び高頻度にしたくなったら top24h の desiredHours を小さくするだけ。
    // floorHours=168: 割当が極端に減った緊急時は「毎日」を諦めて遅くする（スキップで消えるよりまし）
    //
    // 不変条件（6カ国化で顕在化・60日シミュレーションが守る）: どのジョブも「1回の費用 < 1日の
    // ハード停止(95%)」であること。2026-08-26 から周回（lap）は実行をまたいで閉じるので、超えても
    // 飢餓はしなくなったが、1周が複数日にまたがって取得時刻がまだらになり鮮度の約束が守れない。
    // だからカテゴリ×週間・月間とカテゴリ×年間・全期間は期間ごとの4ジョブに分割してある
    // （費用は同じ・1周が半分になる）。実行順は everyHours≤24 のデイリー枠（top24h/map）が最優先で、
    // その費用は完走まで取り置かれる（collect.mjs の dailyReserve。2026-08-26 の飢餓事故の再発防止）。
    // 2026-08-30 改訂: 公式急上昇（videos.list chart=mostPopular・1 unit/国）を毎時取り、
    // 24h/週間/月間へ「追加と再生数の更新」だけ合流させる（scripts/lib/chart.mjs）。
    // search が取りこぼす大物（実測: 急上昇1位級 363万回の動画が 24h に不在）と、
    // top24h が毎日1回になったことによる古さを、6 units/回（144 u/日）の側路で補う。
    { id: 'chart',        everyHours: 1,   floorHours: 24,  priority: 0, desiredHours: 1 },
    { id: 'top24h',       everyHours: 24,  floorHours: 168, priority: 1, desiredHours: 24 },
    { id: 'weekmonth',    everyHours: 72,  floorHours: 336, priority: 2, desiredHours: 24 },
    { id: 'categories',   everyHours: 168, floorHours: 720, priority: 3, desiredHours: 24 },   // カテゴリ×24h
    { id: 'map',          everyHours: 24,  floorHours: 24,  priority: 4, desiredHours: 24 },   // 1国1unit と激安なので毎日より遅くしない（floor=24h）
    { id: 'catweek',      everyHours: 336, floorHours: 720, priority: 5, desiredHours: 24 },   // カテゴリ×週間
    { id: 'catmonth',     everyHours: 336, floorHours: 720, priority: 6, desiredHours: 24 },   // カテゴリ×月間
    // 年間・全期間はバックフィル（BACKFILL）の候補プール再構成が 0 units で毎回更新するので、
    // search での取り直しは月1回まで落とせる（プールへの餌やりとしては残す）。
    { id: 'yearall',      everyHours: 720, floorHours: 720, priority: 7, desiredHours: 168 },
    { id: 'catyear',      everyHours: 720, floorHours: 720, priority: 8, desiredHours: 168 },  // カテゴリ×年間
    { id: 'catall',       everyHours: 720, floorHours: 720, priority: 9, desiredHours: 168 },  // カテゴリ×全期間
    // タグ集計は公開中の JSON を数え直すだけで API を使わない（0 units）。
    { id: 'tags',         everyHours: 6,   floorHours: 24,  priority: 10, desiredHours: 6 },
  ],
};

/**
 * 全期間ランキングの遡り収集（2026-08-25 発注者改訂 第3弾）。
 * publishedAfter/publishedBefore で年単位の窓を切って search し、各年代の上位動画を
 * 候補プール（state/pool/）に貯め、year/all のランキングをプールから 0 units で再構成する。
 * enabled=false の間は planner の予約も収集も一切動かない（従来どおり）。
 * 全窓を歩き終えた国は自動で完了し、全国完了で予約枠も自動で 0 になる。
 */
export const BACKFILL = {
  enabled: true,             // 2026-08-30 有効化（IN/BR の初回取得は 08-26 に完了・本番 index.json で確認）
  dailyUnits: 1400,          // planner がソフト上限から差し引く1日あたりの予約枠
  videoStartYear: 2005,      // 動画部門の窓の開始年（YouTube 創設）
  shortsStartYear: 2020,     // ショート部門の窓の開始年（Shorts の開始）
  splitRecentYears: 2,       // 直近 n 年は半年窓に細分化（投稿が多い年代ほど細かく取る）
  poolMaxPerCountry: 5000,   // 候補プールの上限。超えたら再生数の少ない順に間引く
  refreshDailyUnits: 40,     // プールの再取得（videos.list・50件=1unit）の1日あたり上限
};

/**
 * v4 グループランキング（2026-08-25 発注者改訂 第3弾）。リンクを知っている人だけが参加できる
 * 匿名の共有リスト。保存は 動画ID・追加回数・時刻 のみで、「誰が」の概念は仕組み上存在しない。
 * endpoint が空の間は完全に無効（タブも出さない・送信も取得もしない）。
 * ゲートB（NEEDS_HUMAN.md）で workers/taps をデプロイしたら、その URL をここにも入れるだけ。
 */
export const GROUPS = {
  endpoint: '',              // 例: 'https://trendzap-taps.<account>.workers.dev'（TAPS と同じ URL）
  maxItems: 200,             // 1グループに残す動画数の上限（サーバー側と揃える）
  pollMs: 30_000,            // 表示中のグループを再取得する間隔
  storageKey: 'ytta.groups.v1', // 端末内に覚える「自分が入っているグループ」（名前は端末内のみ）
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
  BACKFILL, GROUPS,
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

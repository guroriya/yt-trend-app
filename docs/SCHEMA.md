# docs/SCHEMA.md — データ契約

`public/data/*.json` は **収集スクリプト（`scripts/`）とフロント（`public/app.js`）の唯一の接点**。
ここを変えるときは両方を同時に直し、`scripts/validate.mjs` のスキーマも更新する。

すべての JSON は UTF-8 / 改行なし（minify）／`schemaVersion` 必須。

**`public/data/` は git に入れない**（ORDER §8: 取得した API データを履歴に残さないため）。
配信前に必ず生成する — APIキーがあれば `npm run collect`、無ければ `python tools/mock.py`。
`state/` も git に入れない（GitHub Actions の `actions/cache` で引き継ぐ）。

---

## 1. ファイル名

```
public/data/index.json                      … 目次・機能フラグ
public/data/{country}-{section}-{period}-{category}[-growth].json  … ランキング本体
public/data/map.json                        … 世界地図タブ（各国1位）
public/data/tags-{country}.json             … タグ／頻出ワードの勢い
state/_budget.json                          … API 消費カウンタ（内部用・公開しない）
state/_shorts_cache.json                    … ショート判定キャッシュ（内部用・30日TTL）
state/last-run.json                         … ジョブごとの最終実行時刻（planner が使う）
state/prev/{datasetId}.json                 … 前回の順位（↑↓NEW の比較元。videoId と rank のみ）
state/snapshots/{YYYY-MM-DD}.json.gz        … 日次スナップショット（31日で自動削除）
```

- `country` … `JP` / `US`（`COUNTRIES[].code`）
- `section` … `video` / `shorts`（`SECTIONS[].id`）
- `period` … `24h` / `week` / `month` / `year` / `all`（`PERIODS[].id`）
- `category` … `all` / `music` / `gaming` / `entertainment` / `sports` / `news`（`CATEGORIES[].id`）
- `-growth` … v2「伸び」ランキング（ORDER §2-14）。存在しない期間もある。

ファイル名は必ず `config.js` の `datasetId()` / `datasetPath()` で生成する。手書きしない。

---

## 2. `index.json`

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-25T03:00:00.000Z",  // ISO8601 UTC
  "source": "mock" | "youtube-api",
  "countries": ["JP", "US"],
  "datasets": {                                // 存在するデータセット → メタ情報
    "JP-video-24h-all": { "generatedAt": "...", "count": 100, "stale": false }
  },
  "features": {
    "growth": {                                // ORDER §2-14 自動有効化
      "enabled": false,
      "daysCollected": 0,
      "requiredDays": 3,
      "periods": []                            // 有効化された期間のみ並ぶ
    },
    "map": true,
    "tags": true
  },
  "quota": { "spentToday": 0, "dailyUnits": 10000, "degraded": false },
  "attribution": "This product uses the YouTube API Services."
}
```

- フロントは**起動時に必ず `index.json` を読む**。`features.growth.enabled` が false の間、
  「伸び」タブは DOM に出さない（ORDER §2-14「足りたら自動有効化」）。
- `quota.degraded` が true のとき、UI のフッタに「更新頻度を一時的に下げています」を出す。

---

## 3. ランキング本体

```jsonc
{
  "schemaVersion": 1,
  "id": "JP-video-24h-all",
  "country": "JP",
  "section": "video",
  "period": "24h",
  "category": "all",
  "metric": "published",           // "published"（期間内投稿の再生数順）| "growth"（期間内の伸び）
  "generatedAt": "2026-08-25T03:00:00.000Z",
  "prevGeneratedAt": "2026-08-25T02:00:00.000Z",   // 順位変動の比較元。初回は null
  "windowStart": "2026-08-24T03:00:00.000Z",       // period=all は null
  "items": [
    {
      "rank": 1,
      "prevRank": 3,               // 前回集計の順位。前回に居なければ null（= NEW）
      "videoId": "dQw4w9WgXcQ",
      "title": "…",
      "channelId": "UC…",
      "channelTitle": "…",
      "publishedAt": "2026-08-24T12:00:00.000Z",
      "viewCount": 1234567,
      "likeCount": 12345,          // 取得できない場合 null
      "commentCount": 234,         // 取得できない場合 null
      "durationSec": 212,
      "isShort": false,
      "categoryId": "10",          // YouTube videoCategoryId
      "tags": ["…"],               // 最大8件。tags ランキングと My 学習が使う
      "delta": 2                   // prevRank - rank（＋が上昇）。prevRank が null なら null
    }
  ]
}
```

### 派生規則（JSON に持たないもの）

| 表示 | 導出 |
|---|---|
| サムネイル | `https://i.ytimg.com/vi/{videoId}/mqdefault.jpg`（2x は `hqdefault.jpg`） |
| 転送 URL | `video` → `https://www.youtube.com/watch?v={videoId}` / `shorts` → `https://www.youtube.com/shorts/{videoId}` |
| チャンネル URL | `https://www.youtube.com/channel/{channelId}` |
| 経過時間 | `publishedAt` と現在時刻から都度計算（キャッシュを跨いでも正しく出るため） |
| 順位変動マーク | `delta > 0` → ↑ / `delta < 0` → ↓ / `prevRank === null` → NEW / `delta === 0` → − |

**JSON にサムネ URL を持たない**のは、サイズを約20%削れることと、i.ytimg.com の
URL 規約が安定しているため（DECISIONS.md 2026-08-25）。

---

## 4. `map.json`（v2）

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "…",
  "items": [
    { "country": "JP", "lat": 36.2, "lon": 138.3,
      "videoId": "…", "title": "…", "channelTitle": "…", "viewCount": 123, "isShort": false }
  ]
}
```

## 5. `tags-{country}.json`（v2）

```jsonc
{
  "schemaVersion": 1,
  "country": "JP",
  "generatedAt": "…",
  "period": "24h",
  "items": [
    { "term": "…", "score": 87.2, "count": 12, "delta": 5, "videoIds": ["…", "…"] }
  ]
}
```

`score` は「その語を含む動画の再生数合計を対数圧縮した値」。`delta` は前回集計の順位差。
言語別ストップワードは `scripts/lib/tags.mjs` の `STOPWORDS`。

---

## 6. 端末内ストレージ（v2・外部送信しない / ORDER §2-11, §8）

`localStorage['ytta.my.v1']`:

```jsonc
{
  "v": 1,
  "updatedAt": 0,
  "terms":    { "<term>":    { "w": 12.3, "t": 1756... } },   // w=重み, t=最終更新(ms)
  "channels": { "<channelId>": { "w": 30.1, "t": 1756..., "name": "…" } },
  "categories": { "10": { "w": 8.0, "t": 1756... } },
  "opened": { "<videoId>": 1756... },
  "muted":  ["<term|channelId>"],
  "enabled": true
}
```

- 半減期 14 日（`LEARNING.halfLifeDays`）で読み出し時に減衰させる。
- **一覧で見える・個別に消せる・重みをいじれる**（ORDER §2-11）ことが仕様の核。
- `enabled:false` で学習停止。`clear()` で全消去。**送信先は存在しない**。

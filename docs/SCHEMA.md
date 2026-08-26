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
state/last-run.json                         … {lastRun: ジョブごとの最終完走時刻, cursor: 予算切れジョブの再開位置, lap: 周回の残数/署名/書き損ね回数}。lap が無い旧形式は新しい周回として読む
state/prev/{datasetId}.json                 … 前回の順位（↑↓NEW の比較元。videoId と rank のみ）
state/snapshots/{YYYY-MM-DD}.json.gz        … 日次スナップショット（31日で自動削除）
state/backfill.json                         … 遡り収集の進み具合（国ごとの窓カーソルと完了フラグ）
state/pool/{country}.json.gz                … 全期間ランキングの候補プール（videoId → item + fetchedAt。
                                              毎日の poolrefresh で30日以内に再取得 = ORDER §8 準拠）
```

- `country` … `JP` / `US` / `KR` / `GB`（`COUNTRIES[].code`。増減は `public/js/config.js` のみで完結する）
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
  "countries": ["JP", "US", "KR", "GB"],
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
    "tags": true,
    "backfill": {                              // 2026-08-25 第3弾: 全期間の遡り収集の進み具合（任意フィールド）
      "active": false,                         // 走っている間だけ true
      "done": 0,                               // 歩き終えた窓の数（全国合計）
      "total": 198                             // 窓の総数（33窓 × 国数）
    }
  },
  "quota": { "spentToday": 0, "dailyUnits": 10000, "degraded": false },
  "attribution": "This product uses the YouTube API Services."
}
```

- フロントは**起動時に必ず `index.json` を読む**。`features.growth.enabled` が false の間、
  「伸び」タブは DOM に出さない（ORDER §2-14「足りたら自動有効化」）。
- `quota.degraded` が true のとき、UI のステータスバー（`#statusbar`）に「更新頻度を一時的に下げています」を出す。
- `features.backfill.active` が true のとき、year/all の表示中だけステータスバーに
  「全期間ランキングを拡充中（done/total）」を出す（`state.backfill`）。旧データには
  このフィールドが無いことがあるので、無くてもスキーマ違反にしない。

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

## 4. `map.json`（v2 / 2026-08-25 第3弾で60カ国＋トップ10に拡充）

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "…",
  "items": [
    { "country": "JP", "lat": 36.2, "lon": 138.3,
      "videoId": "…", "title": "…", "channelTitle": "…", "viewCount": 123, "isShort": false,
      "top": [                        // その国の mostPopular 上位10本（任意フィールド。UI のミニリスト用）
        { "videoId": "…", "title": "…", "channelTitle": "…", "viewCount": 123, "isShort": false }
      ] }
  ]
}
```

`top` は同じ 1 unit の `mostPopular` 呼び出しの maxResults を 10 にして得る（追加費用なし）。
旧データには無いことがあるので、無くてもスキーマ違反にしない。

## 5. `tags-{country}.json`（v2）

```jsonc
{
  "schemaVersion": 1,
  "country": "JP",
  "generatedAt": "…",
  "period": "24h",
  "items": [
    { "rank": 1, "term": "…", "score": 87.2, "count": 12, "delta": 5, "videoIds": ["…", "…"] }
  ]
}
```

`rank` は 1 始まりの連番（フロントがそのまま表示する）。
`score` は「その語を含む動画の再生数合計を対数圧縮した値」。`delta` は前回集計の順位差（前回に無ければ null）。
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

`localStorage['ytta.freq.v1']`（よく見るランキング / 2026-08-25 発注者改訂 7-c）:

```jsonc
{
  "v": 1,
  "counts": { "JP/video/24h/all": 12 },   // 軸の組み合わせ → 訪問回数（上限 60 件）
  "pins":   ["JP/shorts/week/music"]      // ☆で手動ピン留めした組み合わせ（上限 8 件）
}
```

- キーは `国/部門/期間/カテゴリ`。読み出し時に `config.js` と照合し、消えた軸の行は無視する。
- 訪問は **2.5 秒とどまって初めて 1 回**（スワイプで通過しただけの軸を数えない）。
- こちらも**端末内のみ**。外部送信は無い（ORDER §2-11 と同じ約束）。

---

## 7. タップ集計 API（v3 / ORDER §2-15・匿名カウンタ）

実体は `workers/taps/`（Cloudflare Workers + KV）。フロントの接点は `public/js/config.js` の
`TAPS.endpoint` だけで、**空文字の間は送信もフェッチも一切起きない**。

### POST `{endpoint}/tap`

```jsonc
{ "country": "JP", "videoId": "dQw4w9WgXcQ" }   // 送るのはこの2値のみ
```

- `country` は大文字2桁（形のみ検証）。`videoId` は 11 文字の YouTube ID の形。
- 成功は `204`。検証落ちは `400`。本文 256 バイト超は `413`。
- `content-type` は見ない（フロントは text/plain で送る = CORS 単純リクエスト。本文の JSON だけが契約）。
- サーバーは **UTC の当日** のカウンタに +1 する（クライアントの時計は使わない）。
- IP・User-Agent・Cookie・識別子は保存しない（ログにも出さない）。

### GET `{endpoint}/stats?date=YYYY-MM-DD`（date 省略で UTC 当日）

```jsonc
{ "date": "2026-08-25", "total": 1234, "countries": { "JP": 800, "US": 434 } }
```

- 動画別の内訳は外に出さない（表示に使うのは合計と国別だけ）。
- `cache-control: max-age=60`。フロント側も `TAPS.statsTtlMs` でメモキャッシュする。

### 保存形（KV・キー `day:{UTC日付}`・TTL 31日 = ORDER §8 準拠）

```jsonc
{ "date": "2026-08-25", "total": 1234,
  "countries": { "JP": 800 }, "videos": { "dQw4w9WgXcQ": 3 } }
```

- KV の read-modify-write の競合、および KV の書き込み制限（同一キー 1回/秒・無料枠 1,000回/日。
  `day:{date}` は単一ホットキー）で加算を取りこぼすことがある。**近似値として許容**
  （独自指標であり課金・保証の根拠に使わない）。正確さが要る段階になったら Durable Objects へ。
- `videos` は 2000 件を超えたら上位 1000 件に間引く（値の肥大防止）。
- 集計単位は「人」ではなく「回」。匿名制約（ORDER §2-15）の下では人数の一意化は不可能で、
  UI の文言も「◯回」で統一している（`taps.today` / `taps.count`）。

---

## 8. グループランキング API（v4 / ORDER §2-18・2026-08-25 第3弾）

実体は同じ `workers/taps/`（タップ集計と同一デプロイ・同一 KV）。フロントの接点は
`public/js/config.js` の `GROUPS.endpoint` だけで、**空文字の間はタブも出ず通信も起きない**。
`?groups=mock` はネットワークに出ない表示専用サンプル（E2E 用）。

### POST `{endpoint}/g` → `201 { "id": "ab12cd34ef" }`

- グループを作る。id は 10 文字の小文字英数（crypto 乱数 ≒ 51bit）。**URL に含まれる id
  そのものが鍵**（capability URL）。認証・アカウントは存在しない。
- 全体で 1 日 100 個まで（`gcreate:{date}` カウンタ）。超えたら `429`。KV 書込み失敗は `503`。

### POST `{endpoint}/g/{id}/add`

```jsonc
{ "videoId": "dQw4w9WgXcQ" }     // 受け付けるのはこの1値のみ。自由文は仕組み上保存できない
```

- 成功 `204`／検証落ち `400`／グループ無し `404`／1グループ1日 300 回超 `429`／256 バイト超 `413`。
- 同じ動画を（別の人が）もう一度追加すると回数 n が増える。

### GET `{endpoint}/g/{id}` → `200`

```jsonc
{ "createdAt": 1756100000000, "updatedAt": 1756100000000,
  "items": [ { "videoId": "…", "count": 3, "addedAt": 1756100000000, "score": 2.5 } ] }
```

- 並びはホットスコア降順: `score = count × 2^(−経過時間h / 72)`（追加数 × 半減期3日）。
  「いまグループがザッピングしているもの」が上に来る。
- 題名・サムネはサーバーに無い。フロントが 公開ランキング JSON → `GET {endpoint}/oembed?v={videoId}`
  （YouTube oEmbed の中継・0 units・24h キャッシュ）の順で解決する。

### 保存形（KV・キー `g:{id}`・**TTL 90日を追加のたびに貼り直し**）

```jsonc
{ "v": 1, "createdAt": 0, "updatedAt": 0,
  "adds": { "2026-08-25": 12 },                     // 当日の追加回数（上限判定用・当日ぶんだけ）
  "videos": { "dQw4w9WgXcQ": { "n": 3, "at": 0 } } }
```

- 90 日間追加が無いグループは KV の TTL で自動消滅（利用規約・privacy.html にも明記）。
- 保存されるのは 動画ID・回数・時刻 のみ。名前・IP・UA・「誰が」は**この層に存在しない**
  （タップ集計と同じ原則）。連打対策の IP スロットルは isolate のメモリ内のみで永続化しない。
- 動画は 1 グループ 200 本まで（超えたらスコアの低い順に間引く）。
- KV 書込み枠（1,000回/日）はタップ集計と共用。伸びてきたら Durable Objects へ（BACKLOG）。

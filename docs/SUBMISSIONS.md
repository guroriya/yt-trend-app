# docs/SUBMISSIONS.md — 提出用文面集（P6 / ORDER §7 ゲートC）

ゲートCで発注者がやるのは**提出操作のみ**（ORDER §7）。文面はすべてここからコピペする。
`<PAGES_URL>` は公開後の GitHub Pages の URL（例 `https://<user>.github.io/yt-trend-app`）に置き換える。

---

## 1. Google Play ストア掲載文

### アプリ名（30字以内）
- JA: `TrendZap — 急上昇ザッピング`
- EN: `TrendZap — Trending Zapper`

### 短い説明（80字以内）
- JA: `YouTubeの「今の勢い」を一覧で。みんなのランキングと自分のランキングを行き来するザッピング体験。`
- EN: `Zap between everyone's YouTube trending ranking and your own. By country.`

### 詳しい説明（JA）

```
TrendZap は、YouTube の「今の勢い」をランキングで一覧できる導入口アプリです。
動画をタップすると YouTube 本体で再生されます（アプリ内での再生・埋め込みはしません）。

■ みんな ⇄ 自分 のザッピング
・「みんな」: 全員が同じものを見る公式データ準拠のランキング。24時間/週間/月間/年間/全期間
・「自分」: 端末内だけで学習するあなた専用ランキング。学習内容は一覧できて、個別に消せて、重みも変えられます
・学習データが端末の外に送られることは一切ありません

■ 一覧性とスピード
・動画/ショート部門、カテゴリ、国（日本/アメリカ）をスワイプで瞬時に切替
・順位変動（↑↓NEW）が色でひと目で分かる
・ライト/ダーク対応、英語/日本語対応

■ ワードと世界
・タイトルから集計した「いま伸びているワード」ランキング
・世界地図で各国の1位を俯瞰して、その国のランキングへ潜れます

TrendZap はサードパーティ製の非公式アプリです。YouTube および Google LLC とは関係ありません。
This product uses the YouTube API Services.
```

### 詳しい説明（EN）

```
TrendZap is a gateway app that shows what's gaining momentum on YouTube right now,
as rankings you can scan at a glance. Tapping a video opens it on YouTube itself
(no in-app playback, no embedding).

■ Zap between "Everyone" and "You"
- Everyone: the same official-data ranking for all users. 24h / week / month / year / all time
- You: a personal ranking learned entirely on your device. You can inspect the model,
  delete entries one by one, and adjust weights
- Your learning data never leaves your device

■ Built for scanning
- Swipe instantly between Videos/Shorts, categories, and countries (JP/US)
- Rank changes (up / down / NEW) readable at a glance by color
- Light/dark themes, English/Japanese

■ Words & World
- A ranking of words rising across video titles
- A world map of each country's #1 — dive into any country's ranking

TrendZap is an independent third-party app, not affiliated with YouTube or Google LLC.
This product uses the YouTube API Services.
```

### 分類・その他
- カテゴリ: `ツール`（または `ニュース&雑誌`）／ 課金: なし ／ 広告: **あり**（申告必須）
- 連絡先メール: 発注者のメールアドレス
- プライバシーポリシー URL: `<PAGES_URL>/privacy.html`

### データセーフティ（Play Console の質問への回答）
| 質問 | 回答 |
|---|---|
| データを収集しますか | **いいえ**（端末内学習は収集に当たらない。外部送信ゼロ） |
| データを共有しますか | いいえ |
| 暗号化して送信しますか | 送信データなし（v3 匿名カウンタ有効時も「国コード＋動画ID」のみ・HTTPS） |
| 削除リクエスト手段 | 収集していないため該当なし（端末内データはアプリ内で全消去可能） |

> v3 の匿名タップカウンタを有効化した後に提出する場合は「収集: あり →
> アプリのインタラクション（匿名・任意機能）」へ変え、個人と関連付けないと申告する。

### コンテンツレーティング（IARC 質問票）
- 暴力・性的内容・不適切な言葉の**制作・掲載はしない**（表示するのは YouTube の公開メタデータのみ）→ 該当なし
- ユーザー生成コンテンツ: **なし**（コメント・投稿機能なし）
- ウェブ/検索アクセス: サードパーティのウェブコンテンツ（YouTube）への導線 **あり** と申告

---

## 2. AdSense 申請（Web / インフィード広告）

- 申請サイト: `<PAGES_URL>`
- サイトの説明（申請フォーム/審査向け）:

```
TrendZap is a free web app that shows YouTube trending rankings (24h to all-time,
by country and category) using the official YouTube Data API. All content shown is
public video metadata; videos are watched on YouTube itself. The site has original
functionality (ranking navigation, on-device personalization, word trends, world map),
a privacy policy, and no user-generated content. Ads will appear as clearly labeled
in-feed cards, one per ten list items, never overlapping video playback (the app has
no playback).
```

- 実装: 審査通過後、`public/app.js` の `fillAdSlot()` に AdSense インフィードのタグを入れるだけ
  （構造は実装済み。"AD" 表記とカードのリズムは変えない）。

---

## 3. AdMob（Android / ネイティブ広告）

- アプリ追加: ストア掲載後に Play ストアのリンクで登録（掲載前なら「未公開アプリ」として登録）
- 広告ユニット: **ネイティブ アドバンス** を1つ（リスト内カード用）
- app-ads.txt: AdMob の案内どおり `<PAGES_URL>/app-ads.txt` に設置（中身は AdMob が発行する1行）
- 実装: `window.__trendzapAds` フック（`public/app.js` の `fillAdSlot` コメント参照）に
  Capacitor 側から差し込む。プレイヤー周辺への重畳・インタースティシャルは行わない（ORDER §8）

---

## 4. 審査で聞かれたときの想定問答（YouTube API 準拠）

- **データの出所**: YouTube Data API v3。取得データは30日以内に更新/削除（ORDER §8 準拠を実装済み）
- **帰属表示**: アプリ内フッターに "This product uses the YouTube API Services." を常時表示
- **再生**: アプリ内再生・埋め込みなし。すべて YouTube 本体へ転送
- **収益**: 広告のみ。API データへのアクセスに課金しない
- **商標**: 名称・ロゴは YouTube を模倣していない。非公式であることをアプリ内とストア説明に明記

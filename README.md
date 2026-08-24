# TrendZap — `yt-trend-app`

**TrendZap** is a small, build-free web app that shows YouTube's *current momentum* as rankings you can
zap through — by period, video/Shorts, category and country — and lets you flip between **everyone's**
ranking (identical for every visitor) and **your own**, which is learned on your device and is fully
visible, adjustable and erasable. It never plays or embeds video: every card is a link out to YouTube.
Plain HTML/CSS/JS, no framework and no build step; data is refreshed by a scheduled collector.
The rest of this README is in Japanese (the client's language). The spec of record is
[`docs/ORDER.md`](docs/ORDER.md).

---

## 1. これは何か（3行）

- YouTube の「今の勢い」を、**期間（24時間／週間／月間／年間／全期間）× 部門（動画／ショート）× カテゴリ × 国（JP／US）**で一覧するランキングアプリ。
- 核となる体験は **「みんな⇄自分」の往復ザッピング**。全員が同じものを見る公式ランキング（みんな）と、端末内だけで学習し**中身が見えて・消せて・重みをいじれる** My ランキング（自分）をタブで行き来する。
- **導線のみで再生はしない。** カードをタップすると本家 YouTube（`watch?v=` / `shorts/`）へ転送する。埋め込み再生も動画の再配信もしない（[ORDER §0 / §8](docs/ORDER.md)）。

---

## 2. スクリーンショット

> **TODO（未撮影）** — スクリーンショットはまだ 1 枚もありません。
> ローカルに Node が入り Playwright が動くようになった時点（[`NEEDS_HUMAN.md`](NEEDS_HUMAN.md) ゲート0）で、
> `design-reviewer`（[ORDER §5](docs/ORDER.md)）が撮る 360×800 / 412×915 の画像を
> `docs/screenshots/` に置き、この節を差し替えること。撮る状態は ORDER §5 の一覧に従う
> （各タブ・スケルトン・データ空・エラー・長いタイトル・広告枠・英日 UI・ライト／ダーク）。

| 予定 | ファイル（未作成） |
|---|---|
| みんなタブ（24時間・動画・JP・ダーク） | `docs/screenshots/everyone-dark.png` |
| 自分タブ（学習インスペクタを開いた状態） | `docs/screenshots/my-inspector.png` |
| 世界地図タブ | `docs/screenshots/map.png` |

---

## 3. クイックスタート

### 3-1. ツール不要（Python だけ。いま使える経路）

このリポジトリはビルド工程がありません。`public/` をそのまま静的配信すれば動きます。
同梱のデータは**モック（サンプル）** なので、API キーが無くても全画面が動きます。

```bash
python -m http.server 4173 --directory public
# → http://localhost:4173/ を開く
```

モックデータを作り直したいとき（Python 3.10 で動作確認済み）:

```bash
python tools/mock.py     # public/data/*.json を再生成
python tools/icons.py    # public/icons/* を再生成
```

### 3-2. Node が入ったら

Node 20 以上と GitHub CLI の導入手順は [`NEEDS_HUMAN.md`](NEEDS_HUMAN.md) ゲート0 にあります。
入ったあとは:

```bash
npm install          # devDependency は @playwright/test のみ
npx playwright install --with-deps chromium   # 初回のみ（E2E 用ブラウザ）

npm run serve        # public/ を http://localhost:4173 で配信
npm run mock         # モックデータ再生成（= python tools/mock.py）
npm run test:e2e     # Playwright E2E
```

収集（実 API）は **API キーが必要**です（[`NEEDS_HUMAN.md`](NEEDS_HUMAN.md) ゲートA）。
キーは環境変数 `YT_API_KEY` から読み、**ファイルにもコミットにも平文で残しません**。

```bash
npm run collect -- --dry-run          # 実行計画と予算見積りだけ表示（API を叩かない）
npm run collect -- --jobs=top24h      # ジョブを絞って実行
npm run collect                       # planner が決めた実行すべきジョブを実行
npm run validate                      # public/data/*.json を docs/SCHEMA.md に照らして検証
```

`--jobs` に指定できるのは `top24h,weekmonth,categories,yearall,map,tags`。
`--force` は間隔判定を無視して強制実行します（予算を食うので通常は使わない）。

---

## 4. リポジトリ構成

| パス | 中身 |
|---|---|
| [`docs/`](docs/) | **正本の文書**。`ORDER.md`（発注書＝仕様と運用のすべて）／`SCHEMA.md`（`public/data/*.json` のデータ契約）／`BUDGET.md`（API 割当予算の算出根拠） |
| [`public/`](public/) | 配信されるもの全部。`index.html` / `app.css` / `app.js` の**3枚に UI を集約**、`js/config.js`（**設定はこの1ファイルだけ**）、`i18n/{en,ja}.json`（全文言）、`data/*.json`（ランキング本体）、`icons/`、`manifest.webmanifest`、`sw.js`、`privacy.html` |
| `scripts/` | 収集・検証・配信の Node 20 スクリプト。`collect.mjs` / `validate.mjs` / `serve.mjs` と `lib/`（`plan.mjs` = 予算プランナ等） |
| `tests/` | Playwright の E2E 仕様。CI で実行する（ローカル実行はゲート0 待ち） |
| [`tools/`](tools/) | Node 非依存のユーティリティ。`mock.py`（モックデータ生成）／`icons.py`（アイコン生成）／`audit.js`（デザイン憲章チェッカ：初見4件以上・タップ44px・WCAG AA・横はみ出し・カード高さ） |
| `state/` | 収集スクリプトの内部状態（消費カウンタ・ショート判定キャッシュ・前回結果・日次スナップショット）。**コミットしない。** CI では `actions/cache` で実行間を持ち越す |
| ルート | `CLAUDE.md`（作業ルール）／`HANDOFF.md`（引き継ぎ）／`DECISIONS.md`（判断ログ）／`BACKLOG.md`（積み残し）／`NEEDS_HUMAN.md`（人間ゲート） |

URL は**ハッシュルーティング**です。例:
`#/everyone/JP/video/24h/all/published` ／ `#/my` ／ `#/tags/JP` ／ `#/map`。

---

## 5. API 割当予算表（ORDER §4）

**結論: 既定構成の消費は 1日あたり 7,125 units（既定割当 10,000 の 71.2%）**で、
ソフト上限 8,000 units（80%）の下に収まっています。
算出根拠と全ケースは [`docs/BUDGET.md`](docs/BUDGET.md) を参照。
構成（国・カテゴリ）を増減するときは、**先に `docs/BUDGET.md` を更新してから**
[`public/js/config.js`](public/js/config.js) を触ってください。

### 5-1. 単価

| 呼び出し | 単価 | 1回あたり取得数 |
|---|---:|---:|
| `search.list` | 100 units | 50 件 |
| `videos.list`（id 指定・statistics） | 1 unit | 50 件 |
| `videos.list`（`chart=mostPopular`） | 1 unit | 50 件 |
| `https://www.youtube.com/shorts/{id}` の到達性チェック | **0 units** | 1 件 |

1本のランキング（上位 N 件）の費用 = `ceil(N/50) × (100 + 1)`
→ 50件 = **101 units** ／ 100件 = **202 units**

### 5-2. ジョブ別の1回あたり費用（既定構成: 2カ国 × 2部門）

| ジョブ | 内訳 | 本数 | 1本 | 1回の費用 |
|---|---|---:|---:|---:|
| `top24h` 24時間・総合 | 2国 × 2部門 × 1期間 × 100件 | 4 | 202 | **808** |
| `weekmonth` 週間・月間・総合 | 2国 × 2部門 × 2期間 × 100件 | 8 | 202 | **1,616** |
| `categories` 24時間・カテゴリ別 | 2国 × 2部門 × 5カテゴリ × 50件 | 20 | 101 | **2,020** |
| `yearall` 年間・全期間・総合 | 2国 × 2部門 × 2期間 × 100件 | 8 | 202 | **1,616** |
| `map` 世界地図（各国1位） | 26国 × `chart=mostPopular` | 26 | 1 | **26** |
| `tags` タグ集計 | 既存 JSON の再集計のみ | – | 0 | **0** |

### 5-3. 既定スケジュールと日次消費

| ジョブ | 既定間隔 | 1日の実行回数 | 日次 units |
|---|---|---:|---:|
| `top24h` | 6時間ごと | 4 | 3,232 |
| `weekmonth` | 日次 | 1 | 1,616 |
| `categories` | 日次 | 1 | 2,020 |
| `yearall` | 週次 | 1/7 | 231 |
| `map` | 日次 | 1 | 26 |
| | | **合計** | **7,125 / 10,000（71.2%）** |

残り 2,875 units はリトライ・手動実行・ショート判定の再確認の余裕です。

### 5-4. 既定は6時間ごと、割当を増やせば自動で毎時に近づく

ORDER §4 の理想は「24h ランキングは毎時更新」ですが、毎時にすると `top24h` だけで
**808 × 24 = 19,392 units/日**となり、既定割当 10,000 を単独で倍近く超えます。
物理的に不可能なので **既定は 6時間ごと**としました（[`DECISIONS.md`](DECISIONS.md) 参照）。

**割当を増やせば自動で毎時に近づきます。** `public/js/config.js` の `QUOTA.dailyUnits` を
上げるだけで、planner（`scripts/lib/plan.mjs`）が `top24h` の間隔を
6h → 4h → 3h → 2h → 1h と詰めます。**コードの変更は不要です。**

| `QUOTA.dailyUnits` | 到達する `top24h` 間隔 | 日次消費 |
|---:|---|---:|
| 10,000（既定） | 6時間 | 7,125 |
| 15,000 | 3時間 | 10,357 |
| 20,000 | 2時間 | 13,589 |
| 30,000 | 1時間（ORDER の理想） | 23,285 |

割当の増枠は Google の
[YouTube API Services Audit form](https://support.google.com/youtube/contact/yt_api_form)
から申請します（無料・審査あり）。急ぎでなければ 6時間間隔のままで v1 公開に支障はありません。

### 5-5. セーフガード（ORDER §4）

- 実行前に日次消費見込みを算出し、`dailyUnits × 0.8`（既定 8,000）を超える構成なら
  **priority の大きいジョブから間隔を倍にして**収まるまで自動で落とす。
- 落としたことは `public/data/index.json` の `quota.degraded = true` に出て、UI のフッタにも表示される。
- 当日の実消費が `dailyUnits × 0.95` に達したら、その日は残ジョブを実行しない（ハード停止）。
- 消費カウンタは **PT 0:00（`America/Los_Angeles`）でリセット**する。
- 目安として、**既定割当のままなら 2カ国が上限**。3カ国以上は増枠申請とセットで行うこと（[`docs/BUDGET.md`](docs/BUDGET.md) §4）。

---

## 6. 現状（ORDER §6 のフェーズ）

> **いま同梱されているデータは実データではありません。**
> `public/data/*.json` は [`tools/mock.py`](tools/mock.py) が生成した**モック（サンプル）データ**で、
> `index.json` の `source` は `"mock"` です。実 API データは（ORDER §8 の保存30日制約のため）
> **git にコミットされません**。CI が毎回生成し、成果物として Pages にデプロイします。

| | フェーズ | 内容 | 状態 |
|---|---|---|---|
| ✅ | **P0 足場** | repo・`docs/ORDER.md`・`CLAUDE.md`・`design-reviewer` 配置、モック JSON で UI 骨格 | **完了**。モックデータでの表示・タブ切替はローカル（`python -m http.server`）で確認済み。ただし **Playwright スモークは未実行**（ローカルに Node が無いため CI に寄せた → [`BACKLOG.md`](BACKLOG.md)） |
| ⬜ | **P1 収集** | 実 API で 全期間 × 2カ国 × 2部門 の JSON 生成 | **ゲートA 待ち**（`YT_API_KEY` 未発行）。収集スクリプト本体は実装中で、`--dry-run` の予算計算までは API 無しで検証できる |
| ⬜ | **P2 自動化** | GitHub Actions 定時実行＋Pages 公開 | **ゲートE 待ち**（リモートリポジトリ未作成・Pages 未有効化）。ゲート0（`gh` CLI）も未了のため `gh run watch` による検収は目視確認に代替予定 |
| ⬜ | **P3 v1完成** | ORDER §2 の 1〜10 全部＋design-reviewer 合格 → v1 公開 | 未着手。UI 骨格は先行しているが、E2E 全通過（全タブ網羅／転送 URL 検証／i18n 切替／PWA インストール可能）は P2 の CI が前提 |
| ⬜ | **P4 v2** | ORDER §2 の 11〜14（My ランキング／タグ／世界地図／伸びランキング） | 未着手。「伸び」ランキングはスナップショットが 3日分貯まるまで自動的に非表示（`RETENTION.growthMinDays`） |
| ⬜ | **P5 v3 サーバー** | Cloudflare Workers＋KV の匿名タップ集計 | 未着手（**ゲートB**） |
| ⬜ | **P6 Android・広告** | Capacitor ビルド、AdMob／AdSense 差し込み | 未着手（**ゲートC**） |

現在地・次の一手・未解決は [`HANDOFF.md`](HANDOFF.md) が常に最新です。

---

## 7. 人間ゲート（発注者の手が要るところ）

手順は重複させません。**[`NEEDS_HUMAN.md`](NEEDS_HUMAN.md) を見てください。**
そこにコピペできる粒度で書いてあります。

| ゲート | 内容 | いつ必要か |
|---|---|---|
| **0** | Node.js LTS ＋ GitHub CLI の導入（`winget`）と `gh auth login` | 最優先。ローカル検証と自動化の前提 |
| **A** | Google Cloud で YouTube Data API v3 のキー発行 → `YT_API_KEY` を GitHub Secrets に登録 | P1 |
| **E** | GitHub リポジトリ作成と Pages の有効化 | P2 |
| **B** | Cloudflare アカウント＋wrangler 認可 | P5 |
| **C** | Google Play Console 登録（$25）／AdMob・AdSense 申請 | P6 |
| **D** | 見た目のスクショ指摘（随時・任意）。デザイン憲章より優先して反映 | いつでも |

ゲート待ちの間も、依存しない作業（モックでの UI、E2E 整備、i18n、地図、学習ロジック）は進めます。

---

## 8. 規約・法務（ORDER §8 の要約）

このアプリは **YouTube API Services 利用規約**に準拠して作ります。実装上の禁止・必須は次のとおり。

- **帰属表示。** アプリ内に「This product uses the YouTube API Services.」を常時表示する
  （フッタ。`index.json` の `attribution` と `public/i18n/{en,ja}.json` の `app.attribution`）。
  あわせてフッタに [YouTube 利用規約](https://www.youtube.com/t/terms) と
  [Google プライバシーポリシー](https://policies.google.com/privacy) へのリンクを置く。
- **保存は 30日以内にリフレッシュまたは削除。** 取得した API データを溜め込まない。
  日次スナップショットは **31日で自動削除**（`RETENTION.snapshotDays`）、表示は常に最新集計から生成する。
  そのため実 API データは git にコミットせず、`state/` は CI のキャッシュで持ち越す。
- **サードパーティ製である旨を明記。** 名称・ロゴで「YouTube」を模倣・僭称しない。
  TrendZap は YouTube／Google とは無関係の第三者アプリで、YouTube Data API v3 を利用しているだけ。
- **API データへのアクセスの販売・課金は不可**（収益は広告のみ）。
  プレイヤーは埋め込まない設計。仮に将来入れても、プレイヤー上・周辺への広告重畳や
  再生前インタースティシャルは行わない。各動画から YouTube 本体への導線は必ず維持する。
- **プライバシー。** プライバシーポリシーを同梱: [`public/privacy.html`](public/privacy.html)（英日併記）。
  v2 の学習データ（`localStorage: ytta.my.v1`）は**端末外に一切送信しない**。
  v3 の集計は匿名カウンタ（国コード＋動画ID＋日付）のみで、IP・個人識別子は保存しない。
  EU 向け同意表示（Google UMP）は P6 で実装する。
- **秘密情報。** API キーは GitHub Secrets（`YT_API_KEY`）だけに置く。
  コード・コミット履歴・ログ・JSON 出力に平文で残さない。

---

## 9. 開発ルール・貢献

作業前に読む順番は次のとおりです。

| ファイル | 役割 |
|---|---|
| [`docs/ORDER.md`](docs/ORDER.md) | **正本**。仕様・運用・法務ガードのすべて。ここに反することはしない |
| [`CLAUDE.md`](CLAUDE.md) | 作業ルール。自走ルール、デザイン監査の起動条件、技術的な約束（ビルド工程なし・UI は3枚・文言は辞書）|
| [`HANDOFF.md`](HANDOFF.md) | 引き継ぎ。現在地／次の一手／未解決を各3行以内。ORDER＋HANDOFF だけで再開できる状態を保つ |
| [`DECISIONS.md`](DECISIONS.md) | 判断ログ。自己解決した判断を1行ずつ**追記のみ**（削除しない） |
| [`BACKLOG.md`](BACKLOG.md) | 積み残し。リトライで通らなかった項目、デザイン監査の Nice 指摘 |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | データ契約。`public/data/*.json` を変えるときは収集とフロントを同時に直す |

補足:

- コミットは **Conventional Commits**、フェーズ完了ごとに git タグ。
- UI（HTML/CSS/表示に関わる JS）を変えたら、必ず `design-reviewer`
  （[`.claude/agents/design-reviewer.md`](.claude/agents/design-reviewer.md)）を起動し、Critical 指摘を 0 にする。
- 国・カテゴリ・期間の増減は [`public/js/config.js`](public/js/config.js) で完結させる。
- コード内のコメント・文書は日本語（発注者が日本語話者のため）。UI 文言は英語ベース＋日本語切替。
- 改行コードは [`.gitattributes`](.gitattributes) で LF に統一している（Windows で編集し Linux で動かすため）。

---

## 10. ライセンス

**まだライセンスファイルはありません。これは未決事項で、意図的に空けてあります。**

リポジトリは Pages 利用のため public にする想定ですが、
「public である」ことと「再利用を許諾する」ことは別です。ライセンスが無い状態では
既定で著作権法上の全権利が留保され、第三者に再利用の許諾は与えられません。

どうするかは**リポジトリの所有者（発注者）が決める事項**です。決まったら
`LICENSE` を追加し、この節を差し替えてください。エージェント側で勝手にライセンスを選ぶことはしません。

なお TrendZap は YouTube / Google と無関係の第三者製アプリです。
YouTube の商標・ロゴ・API から取得したコンテンツの権利は、それぞれの権利者に帰属します。

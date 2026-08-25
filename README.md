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

- YouTube の「今の勢い」を、**期間（24時間／週間／月間／年間／全期間）× 部門（動画／ショート）× カテゴリ（総合＋5種・全期間対応）× 国（JP／US／KR／GB）**で一覧するランキングアプリ。
- 核となる体験は **「ランキング⇄自分」の往復ザッピング**。全員が同じものを見る公式ランキング（ランキング）と、端末内だけで学習し**中身が見えて・消せて・重みをいじれる** My ランキング（自分）をタブで行き来する。
- タブは **ランキング／自分／検索／世界** の4枚。検索タブでは集めた全ランキングを横断して探し、そのまま同じ期間で YouTube 本体の検索にも飛べる。
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
| ランキングタブ（24時間・動画・JP・ダーク） | `docs/screenshots/everyone-dark.png` |
| 自分タブ（学習インスペクタを開いた状態） | `docs/screenshots/my-inspector.png` |
| 世界地図タブ | `docs/screenshots/map.png` |

---

## 3. クイックスタート

### 3-1. ツール不要（Python だけ。いま使える経路）

**いちばん簡単な開き方: リポジトリ直下の `start-app.cmd` をダブルクリック。**
サンプルデータの生成・サーバー起動・ブラウザを開くところまで全部やります（Python だけあれば動きます）。
閉じるときは開いた黒い画面を閉じてください。

> `public/index.html` を直接ダブルクリックしても**動きません**。このアプリは JSON を fetch し、
> JS をモジュールとして読み込むので、`file://` ではブラウザがどちらもブロックします。
> 必ずローカルサーバー越しに開いてください。

以下は中で何が起きているかの説明です。このリポジトリはビルド工程がありません。`public/` をそのまま静的配信すれば動きます。

ただし **`public/data/` は git に入っていません**。取得した YouTube API データを履歴に残さない
ためです（[ORDER §8](docs/ORDER.md)「保存は30日以内にリフレッシュまたは削除」）。
最初に一度だけモック（サンプル）データを生成してください。API キーが無くても全画面が動きます。

```bash
python tools/mock.py
```

```bash
python -m http.server 4173 --directory public
# → http://localhost:4173/ を開く
```

アイコンを作り直したいとき（Python 3.10 で動作確認済み。Pillow 不要）:

```bash
python tools/icons.py    # public/icons/* を再生成
```

### 3-2. Node が入ったら

Node 20 以上と GitHub CLI の導入手順は [`NEEDS_HUMAN.md`](NEEDS_HUMAN.md) ゲート0 にあります。
入ったあとは:

```bash
npm install          # devDependency は @playwright/test のみ
npx playwright install chromium   # 初回のみ（E2E 用ブラウザ。--with-deps は Linux CI 用なので Windows では不要）

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

`--jobs` に指定できるのは `top24h,weekmonth,categories,catweek,catmonth,yearall,catyear,catall,map,tags`
（および遡り収集の `backfill,poolrefresh`）。
`--force` は間隔判定を無視して強制実行します（予算を食うので通常は使わない）。

---

## 4. リポジトリ構成

| パス | 中身 |
|---|---|
| [`docs/`](docs/) | **正本の文書**。`ORDER.md`（発注書＝仕様と運用のすべて）／`SCHEMA.md`（`public/data/*.json` のデータ契約）／`BUDGET.md`（API 割当予算の算出根拠） |
| [`public/`](public/) | 配信されるもの全部。`index.html` / `app.css` / `app.js` の**3枚に UI を集約**、`js/config.js`（**設定はこの1ファイルだけ**）、`i18n/{en,ja}.json`（全文言）、`data/*.json`（ランキング本体。**git に入れない生成物** — `python tools/mock.py` か `npm run collect` で作る）、`icons/`、`manifest.webmanifest`、`sw.js`、`privacy.html` |
| `scripts/` | 収集・検証・配信の Node 20 スクリプト。`collect.mjs` / `validate.mjs` / `serve.mjs` と `lib/`（`plan.mjs` = 予算プランナ等） |
| `tests/` | Playwright の E2E 仕様。CI で実行する（ローカル実行はゲート0 待ち） |
| [`tools/`](tools/) | Node 非依存のユーティリティ。`mock.py`（モックデータ生成）／`icons.py`（アイコン生成）／`audit.js`（デザイン憲章チェッカ：初見4件以上・タップ44px・WCAG AA・横はみ出し・カード高さ）／`devserve.py`（`.mjs` を正しい MIME・CORS で配る開発用サーバー。`scripts/*.mjs` をブラウザで検証するのに使う） |
| `state/` | 収集スクリプトの内部状態（消費カウンタ・ショート判定キャッシュ・前回結果・日次スナップショット）。**コミットしない。** CI では `actions/cache` で実行間を持ち越す |
| ルート | `CLAUDE.md`（作業ルール）／`HANDOFF.md`（引き継ぎ）／`DECISIONS.md`（判断ログ）／`BACKLOG.md`（積み残し）／`NEEDS_HUMAN.md`（人間ゲート） |

URL は**ハッシュルーティング**です。例:
`#/everyone/JP/video/24h/all/published` ／ `#/my` ／ `#/tags/JP` ／ `#/map`。

---

## 5. API 割当予算表（ORDER §4）

**結論: 現行構成（6カ国・カテゴリ全期間・24h＝毎日）の定常消費は 1日あたり 7,823 units
（既定割当 10,000 の 78.2%）**で、ソフト上限 8,000 units（80%）の下に収まっています。
ジョブ別の内訳・遡り収集（バックフィル）・増枠後の姿を含む**予算の正本は
[`docs/BUDGET.md`](docs/BUDGET.md)** です。最新値は `node scripts/collect.mjs --dry-run` で
いつでも確認できます。

> **2026-08-25 発注者改訂（第3弾）**: 「24時間ランキングは当面毎日1回でよい。浮いた予算で国別を強く」。
> top24h は毎日に固定（`desiredHours: 24` のキャップ）し、IN/BR を足して6カ国・地図60カ国・
> 全期間の遡り収集（2005年〜）を追加しました。

要点だけ:

- 単価: `search.list`=100 / `videos.list`=1（50件）/ ショート判定 HTTP・oEmbed=**0 units**。
  1本のランキング = `ceil(N/50) × 101`。
- **不変条件: どのジョブも1回の費用 < 1日のハード停止（9,500）**。破ると1周を完走できず
  他ジョブを飢餓させるため、カテゴリ×週間/月間/年間/全期間は期間単位の
  `catweek / catmonth / catyear / catall` に分割してある（60日シミュレーションのテストで固定）。
- 割当を増やすと planner が自動で間隔を詰めます（`QUOTA.dailyUnits` を書き換えるだけ）。
  **ゲートFの申請額 20,000 で「8カ国・週間/月間＝毎日・カテゴリ×24h＝毎日」**が収まります。
  増枠は [YouTube API Services Audit form](https://support.google.com/youtube/contact/yt_api_form)
  から申請（**無料・審査あり。有料での追加割当メニューは存在しません**。文面は
  [`docs/SUBMISSIONS.md`](docs/SUBMISSIONS.md) §5）。
- セーフガード: ソフト上限 80% 超で priority の低いジョブから自動降格（`quota.degraded` に表示）、
  実消費 95% でその日はハード停止、カウンタは PT 0:00 リセット。バックフィルは予約枠
  （1,440 units/日）内で自己制限し、完走すると自動で解除されます。

---

## 6. 現状（ORDER §6 のフェーズ）

> **ローカルや CI で生成されるデータは、いまはまだ実データではありません。**
> `public/data/*.json` は git に入っておらず、[`tools/mock.py`](tools/mock.py) が生成する**モック（サンプル）データ**で、
> `index.json` の `source` は `"mock"` です。実 API データは（ORDER §8 の保存30日制約のため）
> **git にコミットされません**。CI が毎回生成し、成果物として Pages にデプロイします。

| | フェーズ | 内容 | 状態 |
|---|---|---|---|
| ✅ | **P0 足場** | repo・`docs/ORDER.md`・`CLAUDE.md`・`design-reviewer` 配置、モック JSON で UI 骨格 | **検収完了（2026-08-25）**。Playwright スモーク含む E2E 182/182 緑（ローカル・CI とも） |
| ✅ | **P1 収集** | 実 API で 全期間 × 各国 × 2部門 の JSON 生成 | **実データ収集に成功（2026-08-25）**。24 リストを実 API から取得して公開済み。`search.list` は `q` 必須（[`DECISIONS.md`](DECISIONS.md)）。KR/GB と全期間カテゴリは次回以降の収集で順次埋まる |
| 🟨 | **P2 自動化** | GitHub Actions 定時実行＋Pages 公開 | **Pages 公開済み**: https://guroriya.github.io/yt-trend-app/ （deploy 成功・e2e CI 緑）。毎時の収集はゲートA（APIキー）待ち |
| ✅ | **P3 v1完成** | ORDER §2 の 1〜10 全部＋design-reviewer 合格 → v1 公開 | **公開済み**: https://guroriya.github.io/yt-trend-app/ 。4軸・スワイプ・順位変動・10件ごと広告枠・転送URL・i18n・PWA。E2E 200件緑、憲章の機械チェックは全タブ×英日×ライトダークで指摘ゼロ |
| ✅ | **P4 v2** | ORDER §2 の 11〜14（My ランキング／ワード／世界地図／伸びランキング） | **実装完了・E2E 緑**。学習の「見える・消せる・いじれる」、検索タブ（旧ワードタブ／話題のワードは検索の入口として存続）、世界地図（地形つき）、伸びランキングの自動有効化。伸びは実データ3日ぶんの蓄積待ち |
| 🟨 | **P5 v3/v4 サーバー** | Cloudflare Workers＋KV の匿名タップ集計＋**グループランキング（2026-08-25 第3弾）** | **コードは完成（`workers/taps/`＋フロント＋E2E/単体テスト）、デプロイはゲートB 待ち（1回で両方有効化）**。`TAPS.endpoint`／`GROUPS.endpoint` が空の間は送信もフェッチも起きない |
| ⬜ | **P6 Android・広告** | Capacitor ビルド、AdMob／AdSense 差し込み | ビルドは未着手（**ゲートC**）。**申請文・ストア掲載文・データセーフティ回答は [`docs/SUBMISSIONS.md`](docs/SUBMISSIONS.md) に用意済み** |

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
| **F** | API 割当の増枠申請（**発注者指示 2026-08-25・20,000 で申請**） | 8カ国化＋週間/月間の毎日更新のため。文面は `docs/SUBMISSIONS.md` §5 |
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

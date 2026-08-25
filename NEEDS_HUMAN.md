# NEEDS_HUMAN.md — 発注者にやってほしい操作

ORDER §7 の人間ゲート。**ここに書かれた時だけ**手を動かせばよい。
片付いたら見出しを「済」に書き換えてください（Claude 側は次回セッションでここを見ます）。

> **おすすめの順番: ゲート0 → ゲートE → ゲートA**（合計45分・すべて無料・カード登録不要）。
> ゲートA の最終手順（Secrets 登録）には ゲートE で作るリポジトリが必要です。
> お金がかかるのはずっと先のゲートC（Google Play 登録料 $25）だけ。Web 公開だけなら維持費もゼロです。

---

## ゲート0（済 2026-08-25）— ローカル開発ツールの導入（Node v24.19.0 / gh 2.98.0 / アカウント guroriya）

このPCに Node.js と GitHub CLI が入っていないため、ローカルでの収集スクリプト実行・
Playwright テスト・リポジトリ作成が自動化できません。以下をそのまま PowerShell に貼ってください。

```
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
winget install -e --id GitHub.cli --accept-package-agreements --accept-source-agreements
```

インストール後、**PowerShell を開き直して**次で確認:

```
node -v ; npm -v ; gh --version
```

`node -v` が `v20` 以上（v22 でも可）と出れば OK です。
続けて GitHub CLI にログイン（ブラウザが開きます）:

```
gh auth login
```

→ `GitHub.com` / `HTTPS` / `Login with a web browser` を選択。

**これが済むまでのあいだも作業は止まりません**（モックデータで UI を完成させています）。

### 補足: いますぐローカルで画面を見るには（Node 不要）

**リポジトリ直下の `start-app.cmd` をダブルクリックしてください。** それだけで開きます。
（サンプルデータの生成 → サーバー起動 → ブラウザを開く、まで自動。閉じるときは黒い画面を閉じる）

`public/index.html` を直接ダブルクリックしても**動きません**。このアプリは JSON を読み込む作りなので、
`file://` ではブラウザがブロックします。必ず `start-app.cmd` から開いてください。

`public/data/` を git に入れていないのは、取得した API データを履歴に残さないためです（ORDER §8）。
手で回したいときは次のとおり:

```
cd C:\Users\Owner\yt-trend-app ; python tools/mock.py ; python -m http.server 4173 --directory public
```

→ http://localhost:4173/ を開く（Ctrl+C で停止）

---

## ゲートA（済 2026-08-25）— YouTube Data API v3 のキー発行（`YT_API_KEY` を Secrets に登録済み・キーは API 制限つき）

> 手順1〜6（キーの発行）はいつでもできますが、**手順7の貼り付け先はゲートE で作る
> GitHub リポジトリ**なので、先にゲートE を済ませておくとスムーズです。無料・カード不要です。

1. https://console.cloud.google.com/ を開く（Googleアカウントでログイン）
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `yt-trend-app` →「作成」
3. 作成したプロジェクトを選択した状態で
   https://console.cloud.google.com/apis/library/youtube.googleapis.com を開く →「有効にする」
4. 左メニュー「APIとサービス」→「認証情報」→ 上部「＋認証情報を作成」→「APIキー」
5. 出てきたキー（`AIza...` で始まる文字列）を**コピー**しておく
6. そのキーの「編集」→ **キーの制限**:
   - アプリケーションの制限: 「なし」（GitHub Actions から呼ぶため IP 固定不可）
   - **API の制限**: 「キーを制限」→ `YouTube Data API v3` **だけ**にチェック →「保存」
7. GitHub リポジトリの Settings → Secrets and variables → Actions →
   「New repository secret」→ Name: `YT_API_KEY` / Secret: コピーしたキー →「Add secret」

> 注意: キーは**絶対にチャットやファイルに貼らないでください**。GitHub Secrets にだけ入れます。

---

## ゲートE（済 2026-08-25）— GitHub リポジトリの作成と Pages 有効化（https://github.com/guroriya/yt-trend-app / Pages は Actions ビルドで有効化済み）

ゲート0（`gh auth login` まで）が済んでいれば、次の1行で作成〜公開まで自動で進みます:

```
cd C:\Users\Owner\yt-trend-app ; gh repo create yt-trend-app --public --source=. --remote=origin --push
```

作成後、GitHub のリポジトリ画面で:
Settings →  Pages → **Build and deployment / Source** を `GitHub Actions` に変更 →保存。

---

## ゲートF（発注者指示 2026-08-25・所要 20分＋審査数週間）— API 割当の増枠申請（**20,000 で申請**）

> 2026-08-25 の発注者改訂（第3弾）で方針が変わりました:
> 24時間ランキングは**毎日1回でよい**代わりに、**国別を強化**（国を増やす・週間/月間やカテゴリの
> 更新を速く）します。浮いた予算と増枠をそこに充てます（詳細は `docs/BUDGET.md`）。
> **増枠は無料**です（YouTube Data API に有料の追加割当は存在しません）。審査に数週間かかるので、
> 早めに出しておくのがおすすめです。

1. https://support.google.com/youtube/contact/yt_api_form を開く（Google アカウントでログイン）
2. フォームに記入して送信。**貼り付ける英語の文面は `docs/SUBMISSIONS.md` §5 にすべて用意してあります**。
   フォームが求める公開ページも準備済みです:
   - プライバシーポリシー: `https://guroriya.github.io/yt-trend-app/privacy.html`
   - 利用規約: `https://guroriya.github.io/yt-trend-app/terms.html`
   - 申請する1日あたりの割当（Total daily quota）: **20,000**
3. 通ったら `public/js/config.js` の `QUOTA.dailyUnits` を `20000` に書き換えるだけです。
   **コードの変更は不要**。planner が自動で更新間隔を詰めます
   （8カ国化は Claude 側で `COUNTRIES` に FR/DE を足します。次のセッションで「増枠が通った」と
   伝えてください）。

| `dailyUnits` | できること（4カ国→の姿） |
|---:|---|
| 10,000（既定） | **6カ国**（JP/US/KR/GB/IN/BR）・24hは毎日・週間/月間は2〜3日ごと |
| **20,000（申請額）** | **8カ国**（+FR/DE）・週間/月間も**毎日**・カテゴリ別は2日ごと |
| 50,000 | さらに国を増やす／24hランキングの1日複数回更新を再開する余地 |

※ 24時間ランキングを再び高頻度（6時間ごと等）にしたくなったら、`config.js` の
`SCHEDULE.jobs` で `top24h` の `desiredHours` を小さくするだけです（発注者の指示があれば Claude がやります）。

---

## ゲートB（コードは準備済み / **グループ機能の解禁に必要** / 所要 15分）— Cloudflare

v3「匿名タップ集計」と **v4「グループランキング」（2026-08-25 発注者指示の新機能:
リンクを友達に送る→誰でも動画を追加→グループのランキングになる）** のサーバーは、
どちらも `workers/taps/` に**実装済み**です。**1回のデプロイで両方が有効になります。**
ゲート0（Node 導入）が済んでいる前提で:

1. https://dash.cloudflare.com/sign-up で無料アカウントを作る（メール認証まで）
2. PowerShell で（パスはスラッシュ区切りでそのまま通ります）:

```
cd C:/Users/Owner/yt-trend-app/workers/taps ; npx wrangler login
```

→ ブラウザが開くので「Allow」。続けて KV を作成:

```
npx wrangler kv namespace create TAPS
```

3. 出力に `id = "xxxxxxxx..."` が出るので、`workers/taps/wrangler.toml` の
   `REPLACE_WITH_KV_NAMESPACE_ID` をその id に書き換えて保存
4. デプロイ:

```
npx wrangler deploy
```

5. 出力される URL（`https://trendzap-taps.〜.workers.dev`）をコピーして、
   `public/js/config.js` の **2箇所**に貼る → commit & push:
   - `TAPS.endpoint: ''`（タップ集計）
   - `GROUPS.endpoint: ''`（グループランキング。貼ると「グループ」タブが自動で現れます）
6. 動作確認（P5 検収 = カウント → 表示に反映）。PowerShell にそのまま貼ってください
   （`あなたのURL` の部分だけ手順5の URL に置き換え）:

```
Invoke-RestMethod -Method Post -Uri https://あなたのURL.workers.dev/tap -Body '{"country":"JP","videoId":"dQw4w9WgXcQ"}' ; Invoke-RestMethod https://あなたのURL.workers.dev/stats
```

→ `date=… total=1 countries=@{JP=1}` のように返り、アプリの「世界」タブに
「今日、このアプリからYouTubeへ1回飛びました」が出れば完了です。

7. グループの検収（v4）。続けてそのまま:

```
$g = Invoke-RestMethod -Method Post -Uri https://あなたのURL.workers.dev/g ; Invoke-RestMethod -Method Post -Uri "https://あなたのURL.workers.dev/g/$($g.id)/add" -Body '{"videoId":"dQw4w9WgXcQ"}' ; Invoke-RestMethod "https://あなたのURL.workers.dev/g/$($g.id)"
```

→ `items` に1件返り、アプリの「グループ」タブでグループを作って動画を追加 →
友達に招待リンクを送って相手の追加が反映されれば完了です。

> 無料枠の注意: KV の書き込みは 1日 1,000 回まで・同じキーへは 1秒に 1回まで（タップとグループで共用）。
> 上限に当たった分は**数え落とすだけ**で（Worker は正常応答を返す実装）、アプリ本体には影響しません。
> グループの利用が伸びてきたら Durable Objects への移行を検討します（BACKLOG.md）。

## ゲートC（P6 で必要 / まだ着手不要）— Google Play Console（$25）／AdMob・AdSense 申請
　→ 申請に使う文面はすべて `docs/SUBMISSIONS.md` に用意してあります（提出操作のみお願いします）
## ゲートD（随時・任意）— 見た目のスクショ指摘。気になった画面を撮って渡してください。憲章より優先して直します

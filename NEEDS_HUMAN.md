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

## ゲートF（任意・急がない / 所要 20分＋審査）— API 割当の増枠申請

ORDER §4 の理想は「24時間ランキングは毎時更新」ですが、既定割当 10,000 units/日では
物理的に不可能なため、**既定は6時間ごと**にしています（詳細は `docs/BUDGET.md`）。
毎時に近づけたい場合のみ、Google に増枠を申請してください。

1. https://support.google.com/youtube/contact/yt_api_form を開く
2. フォームに記入して送信（無料・審査あり・数週間かかることがあります）
3. 通ったら `public/js/config.js` の `QUOTA.dailyUnits` を新しい値に書き換えるだけです。
   **コードの変更は不要**。planner が自動で 6h → 4h → 3h → 2h → 1h と間隔を詰めます。

| `dailyUnits` | 24時間ランキングの更新間隔 |
|---:|---|
| 10,000（既定） | 6時間 |
| 15,000 | 3時間 |
| 20,000 | 2時間 |
| 30,000 | 1時間（ORDER の理想） |

---

## ゲートB（コードは準備済み / 急がない・v1 公開後でOK / 所要 15分）— Cloudflare

v3「匿名タップ集計」（今日このアプリから何回飛んだか）のサーバーは `workers/taps/` に
**実装済み**です。あとはデプロイだけ。ゲート0（Node 導入）が済んでいる前提で:

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
   `public/js/config.js` の `TAPS.endpoint: ''` に貼る（例: `endpoint: 'https://trendzap-taps.xxx.workers.dev'`）→ commit & push
6. 動作確認（P5 検収 = カウント → 表示に反映）。PowerShell にそのまま貼ってください
   （`あなたのURL` の部分だけ手順5の URL に置き換え）:

```
Invoke-RestMethod -Method Post -Uri https://あなたのURL.workers.dev/tap -Body '{"country":"JP","videoId":"dQw4w9WgXcQ"}' ; Invoke-RestMethod https://あなたのURL.workers.dev/stats
```

→ `date=… total=1 countries=@{JP=1}` のように返り、アプリの「世界」タブに
「今日、このアプリからYouTubeへ1回飛びました」が出れば完了です。

> 無料枠の注意: KV の書き込みは 1日 1,000 回まで・同じキーへは 1秒に 1回まで。
> 上限に当たった分は**数え落とすだけ**で（Worker は正常応答を返す実装）、アプリ本体には影響しません。

## ゲートC（P6 で必要 / まだ着手不要）— Google Play Console（$25）／AdMob・AdSense 申請
　→ 申請に使う文面はすべて `docs/SUBMISSIONS.md` に用意してあります（提出操作のみお願いします）
## ゲートD（随時・任意）— 見た目のスクショ指摘。気になった画面を撮って渡してください。憲章より優先して直します

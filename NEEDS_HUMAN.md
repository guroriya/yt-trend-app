# NEEDS_HUMAN.md — 発注者にやってほしい操作

ORDER §7 の人間ゲート。**ここに書かれた時だけ**手を動かせばよい。
上から順に、片付いたら「済」に書き換えてください（Claude 側は次回セッションでここを見ます）。

---

## ゲート0（未着手 / 所要 10分）— ローカル開発ツールの導入 ★最優先

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

---

## ゲートA（未着手 / 所要 30分）— YouTube Data API v3 のキー発行  ★P1 で必要

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

## ゲートE（未着手 / 所要 5分）— GitHub リポジトリの作成と Pages 有効化  ★P2 で必要

ゲート0（`gh auth login` まで）が済んでいれば、次の1行で作成〜公開まで自動で進みます:

```
cd C:\Users\Owner\yt-trend-app ; gh repo create yt-trend-app --public --source=. --remote=origin --push
```

作成後、GitHub のリポジトリ画面で:
Settings →  Pages → **Build and deployment / Source** を `GitHub Actions` に変更 →保存。

---

## ゲートB（P5 で必要 / まだ着手不要）— Cloudflare
## ゲートC（P6 で必要 / まだ着手不要）— Google Play Console（$25）／AdMob・AdSense 申請
## ゲートD（随時・任意）— 見た目のスクショ指摘。気になった画面を撮って渡してください。憲章より優先して直します

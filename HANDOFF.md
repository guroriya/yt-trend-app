# HANDOFF.md — 引き継ぎ

最終更新: 2026-08-25（3回目） / 公開URL: **https://guroriya.github.io/yt-trend-app/** / タグ: `p0`

## 0. 再開のしかた（新しいセッションはここから）

**発注者からの指示はこの1文だけ。以後もこれが有効。**

> このORDER.mdに従い、§1の自走ルールでP0から完成まで進めて。人間ゲート以外は確認不要。

読む順番は `docs/ORDER.md`（正本）→ このファイル → 迷ったら `DECISIONS.md` を検索。
作業ルールは `CLAUDE.md`。**人間ゲート（ORDER §7）以外では発注者に質問しない。**

画面を見る（Node 不要）: **`start-app.cmd` をダブルクリック**。
データ生成 → サーバー起動 → ブラウザを開くまで自動（`tools/open_app.py`）。
`public/index.html` の直接ダブルクリックでは動かない（`file://` では fetch とモジュール読込がブロックされる）。
手で回すなら:

```
cd C:\Users\Owner\yt-trend-app ; python tools/mock.py ; python -m http.server 4173 --directory public
```

## 1. 現在地

- **ゲート0・E 完了。E2E は 182/182 緑（ローカル・CI とも）。Pages 公開済み＝
  https://guroriya.github.io/yt-trend-app/ （データはまだモック）。**
- P1 収集・P3 v1・P4 v2・P5 v3 はコード完成。**実データ化はゲートA（APIキー）だけ**が残り。
  P6 の申請文一式も `docs/SUBMISSIONS.md` に準備済み。
- コミット作者は全履歴 `guroriya`＋匿名メールに書き換え済み（発注者のプライバシー指摘）。
- 発注者指示（2026-08-25）で**広告枠は10件ごと**（`AD_EVERY=10`、ORDER §2-9 に改訂注記）。
- 今回の変更も独立レビュー＋反証の二段に掛け、確認された 13 件を修正済み（`5c8b41c`、累計33件）。
  憲章の機械チェックは英日 × ライトダーク × 対象ビューで指摘ゼロを維持（Critical ゼロ）。

## 2. 次の一手

1. **残る人間ゲートは A（YouTube APIキー・30分）だけ**。済んだ瞬間に毎時の収集が実データを公開し始める。
2. ゲートA 後: collect.yml の実走を `gh run watch` で2回確認して P1/P2 検収を締め、タグを打つ。
3. 実データが 3 日ぶん貯まると「伸び」ランキングが自動で有効化される。ゲートB（Workers）は任意のタイミングで。

## 3. 未解決

- ローカルに Node/npm/gh が無く、**収集スクリプトと Playwright は一度も実走していない**
  （純粋ロジックの `plan.mjs` / `pure.mjs` / `tags.mjs` / `schema.mjs` / `workers/taps/src/lib.mjs` は
  ブラウザで実行して検証済み）。
- この環境のブラウザは **Service Worker 登録・IntersectionObserver の発火・スクリーンショットができない**。
  PWA オフラインと表示ログ学習の実動確認、および見た目の目視は CI の E2E と発注者（ゲートD）に委ねている。
- 世界地図の地形は簡易グリッド。カード設計のやり直しが要るデザイン指摘とともに `BACKLOG.md` へ。

## 4. この環境で覚えておくこと

| 事実 | 意味 |
|---|---|
| Node / npm / npx / gh は**未導入**。Python 3.10 のみ | 収集も E2E もローカルで走らない。`NEEDS_HUMAN.md` ゲート0 |
| `public/data/` と `state/` は **git に入れない**（ORDER §8） | 配信・テストの前に必ず生成する。空のまま開くと全部落ちる |
| 純粋ロジックはブラウザで検証できる | `python tools/devserve.py 4175 .` → `import('http://localhost:4175/scripts/lib/plan.mjs')` |
| 憲章チェックは `tools/audit.js` | `public/_dev-audit.js`（gitignore 済み）に写して `window.__audit()` で回す |
| ブランチは `master`（`main` ではない） | ワークフローは両方を対象にしてある |
| 設定は `public/js/config.js` の1箇所だけ | 国・カテゴリを増やす前に `docs/BUDGET.md` を更新（ORDER §4） |

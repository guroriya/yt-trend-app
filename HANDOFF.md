# HANDOFF.md — 引き継ぎ

最終更新: 2026-08-25 / 直近コミット: `de68d3e` / タグ: `p0`

## 0. 再開のしかた（新しいセッションはここから）

**発注者からの指示はこの1文だけ。以後もこれが有効。**

> このORDER.mdに従い、§1の自走ルールでP0から完成まで進めて。人間ゲート以外は確認不要。

読む順番は `docs/ORDER.md`（正本）→ このファイル → 迷ったら `DECISIONS.md` を検索。
作業ルールは `CLAUDE.md`。**人間ゲート（ORDER §7）以外では発注者に質問しない。**

画面を見る（Node 不要・`public/data` は生成物なので先に作る）:

```
cd C:\Users\Owner\yt-trend-app ; python tools/mock.py ; python -m http.server 4173 --directory public
```

## 1. 現在地

- **P0 完了（タグ `p0`）。P1 収集・P3 v1 UI・P4 v2 UI はコード完成で、実走だけが人間ゲート待ち。**
  4タブ／4軸／スワイプザッピング／順位変動／広告枠／i18n／ライトダーク／PWA／学習インスペクタまで、モック上で実測確認済み。
- 未実行コードは独立レビュー＋反証の二段に掛け、確認された不具合 20 件を修正済み（`DECISIONS.md` 参照）。
- **ORDER §5 のデザイン監査を1巡完了、Critical ゼロ。** 憲章の機械チェック（`tools/audit.js`）は
  英日 × ライトダーク × 全8ビュー × 2画面幅で指摘ゼロ、スキーマ検証も生成データ 43 ファイルでエラーゼロ。

## 2. 次の一手

1. **発注者に `NEEDS_HUMAN.md` のゲート0（Node/gh 導入）→ A（APIキー）→ E（repo と Pages）を実行してもらう。**
2. ゲート0 が解けたら `npm ci && npx playwright install chromium && npm run test:e2e` で E2E を実走し、
   P0/P3/P4 の検収を締める（`npm run collect -- --dry-run` で予算計画だけ先に見られる）。
3. 実データが 3 日ぶん貯まると「伸び」ランキングが自動で有効化される（`python tools/mock.py --growth` で見た目だけ先に確認可）。

## 3. 未解決

- ローカルに Node/npm/gh が無く、**収集スクリプトと Playwright は一度も実走していない**
  （純粋ロジックの `plan.mjs` / `pure.mjs` / `tags.mjs` / `schema.mjs` はブラウザで実行して検証済み）。
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

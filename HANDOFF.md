# HANDOFF.md — 引き継ぎ

最終更新: 2026-08-25（6回目・発注者改訂 第3弾） / 公開URL: **https://guroriya.github.io/yt-trend-app/**

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

- **発注者改訂 第3弾（2026-08-25）を実装済み・E2E 250件緑**:
  ①24hランキングは**毎日1回**に固定（desiredHours キャップ） ②**6カ国**（IN/BR追加。増枠後に FR/DE で8カ国）
  ③**世界地図60カ国＋各国トップ10**ミニリスト ④**全期間バックフィル**（2005年〜の年窓→候補プール→0units再構成。
  `BACKFILL.enabled` は**まだ false**） ⑤**グループランキング**（workers/taps 拡張・`GROUPS.endpoint` 空の間は無効）
  ⑥増枠申請の準備一式（`terms.html` 新設・SUBMISSIONS §5・NEEDS_HUMAN ゲートF改訂）。
- **重要な発見**: 6カ国化で旧 catweekmonth/catyearall が「1回12,120units > ハード停止9,500」となり
  1周を完走できず飢餓する構造だった → 期間単位の catweek/catmonth/catyear/catall に分割し、
  「どのジョブも1回の費用 < ハード停止」を不変条件としてテストで固定（DECISIONS 参照）。
- 現行予算: 定常 7,823/日（78%）。バックフィル有効化後は 6,397＋予約1,440＝7,837/日、完走（約15日）で自動復帰。
- ゲート0・A・E 完了。P5（Workers）はタップ＋グループともコード完成・デプロイはゲートB。

## 2. 次の一手

1. **人間ゲート: ゲートF（増枠申請・20,000）を早めに**（審査数週間。文面は SUBMISSIONS §5 コピペ）。
   任意でゲートB（デプロイ1回でタップ集計と**グループタブ**が両方有効化）。
2. IN/BR の初回データが埋まる（2〜4日）のを待って、`config.js` の **`BACKFILL.enabled: true`** に変えて push
   （予約1,400/日で遡り収集が始まり、約15日で完走。進捗は index.json の `features.backfill` と UI の
   「全期間ランキングを拡充中」で見える）。
3. 増枠が通ったら: `QUOTA.dailyUnits: 20000` ＋ `COUNTRIES` に FR/DE 追記（SEARCH_Q は準備済み）→
   BUDGET.md とテストの数値更新。FR/DE の窓はバックフィルが自動で歩き直す。
4. 実データが貯まったら `python tools/overlap.py` で GB/US の重複率を測って BACKLOG を裁定。

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

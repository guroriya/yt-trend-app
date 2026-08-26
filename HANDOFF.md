# HANDOFF.md — 引き継ぎ

最終更新: 2026-08-26（7回目・収集の飢餓対策） / 公開URL: **https://guroriya.github.io/yt-trend-app/**

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
- **2026-08-26 の実測事故と対策（E2E 260件緑）**: 第3弾公開翌日、未実行のカテゴリ系ジョブ
  （overdue=∞・計約37,000units）がエイジング順で top24h を追い越し、**24hランキングが丸1日
  更新されなかった**（Actions run 32947630184: `top24h: incomplete`）。対策4本を実装し、
  17エージェントの多角レビュー（反証つき）で確認済みの指摘3件も同時に取り込んだ:
  ①実行順を「**デイリー枠**（everyHours≤24＝top24h/map）優先 → 残りはエイジング」の2段構え
  ②**周回（ラップ）を実行またぎで数える**（予算切れ再開時は残りのリストだけ歩いて完走を閉じる。
  state の last-run.json に `lap`＝残数・リング署名・書き損ね回数を追加。署名不一致＝国の追加等は
  新しい周回）③**canSpend にデイリー枠の取り置き**（未完走のデイリー枠の費用は他に使わせない。
  期限が日の途中に来る日の再発防止）④**書き損ね周回の取り直しは1回まで**（2周連続なら次の間隔
  まで諦める。慢性0件リストによる毎時の取り直し地獄の防止）。再発防止テスト4件を追加し、
  シミュレーションは collect.mjs と同じ並び順・周回・取り置き・諦め上限を再現する（DECISIONS 参照）。
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

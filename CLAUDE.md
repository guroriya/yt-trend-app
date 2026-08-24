# CLAUDE.md — yt-trend-app

このリポジトリで作業する Claude Code への常時指示。**セッション開始時にまず読む。**

## 0. 最初にやること（再開手順）

1. `docs/ORDER.md` を読む（**正本**。仕様と運用のすべて）
2. `HANDOFF.md` を読む（現在地／次の一手／未解決）
3. 迷ったら `DECISIONS.md`（過去の判断ログ）を検索する

`docs/ORDER.md` と `HANDOFF.md` の2枚だけで即再開できる状態を常に維持すること。

## 1. 自走ルール（ORDER §1 の要約・常時遵守）

- **止まらない。** 人間ゲート（ORDER §7）以外では発注者に質問しない。
  判断順序は (a) ORDER → (b) DECISIONS.md → (c) 最も安く後戻りできる選択肢。
  判断したら `DECISIONS.md` に1行追記する。
- **引き継ぎメモ常備。** `HANDOFF.md` は常に最新。「現在地／次の一手／未解決」各3行以内。
- **小さく進む。** 機能単位の小さなコミット、Conventional Commits、フェーズ完了ごとに git タグ。
- **自己検収。** ORDER §6 の検収基準を自分で実行し全通過してから次へ。
  失敗は最大5回リトライ。5回で通らない項目は理由付きで `BACKLOG.md` に積み、**全体は止めない**。
- **人間ゲート。** 当たったら `NEEDS_HUMAN.md` にコピペ可能な手順で書き、依存しない作業を続ける。
  依存しない作業が尽きた時のみ停止してよい（停止時は HANDOFF.md に明記）。
- **UI変更後は必ずデザイン監査。** ORDER §1-6／§5 参照。下記 2. を厳守。
- **秘密情報。** APIキー等は GitHub Secrets（`YT_API_KEY` ほか）のみ。
  コード・コミット履歴・ログ・JSON 出力に平文で残さない。

## 2. デザイン監査の起動条件（必須）

HTML / CSS / 表示に関わる JS を変更したコミットの後は、**必ず** `design-reviewer`
サブエージェント（`.claude/agents/design-reviewer.md`）を起動する。

- Critical 指摘が 0 になるまで次の機能へ進まない。
- 1機能あたり監査は最大3巡。3巡で残った非 Critical 指摘は `BACKLOG.md` へ。
- 発注者本人のスクショ指摘（人間ゲート D）は デザイン憲章（ORDER §5）より常に優先。

## 3. ファイルの役割

| ファイル | 役割 |
|---|---|
| `docs/ORDER.md` | **正本**。発注書。仕様・運用・法務ガードのすべて |
| `HANDOFF.md` | 引き継ぎ。現在地／次の一手／未解決（各3行以内） |
| `DECISIONS.md` | 判断ログ。自己解決した判断を1行ずつ追記（追記のみ・削除しない） |
| `BACKLOG.md` | 積み残し。5回リトライで通らなかった項目・Nice 指摘 |
| `NEEDS_HUMAN.md` | 人間ゲート。発注者にやってほしい操作をコピペ粒度で |
| `README.md` | セットアップ＋API割当予算表＋現状 |
| `docs/SCHEMA.md` | データ契約（JSON スキーマ）。フロントと収集スクリプトの唯一の接点 |
| `docs/BUDGET.md` | API 割当予算表の算出根拠 |

## 4. このリポジトリの技術的な約束

- **ビルド工程なし。** 素の HTML / CSS / JS。`public/` をそのまま配信すれば動く。
- **発注者が手を入れるファイルは少なく大きく。** UI は `public/index.html` /
  `public/app.css` / `public/app.js` の3枚に集約する。細かく割らない。
- 文言は必ず `public/i18n/{en,ja}.json` に置く。JS/HTML にベタ書きしない。
- 国・カテゴリ・期間の増減は `public/js/config.js` の **1箇所だけ**で完結する（ORDER §2-4）。
  フロントも収集スクリプトも同じファイルを import している。増やす前に `docs/BUDGET.md` を更新すること。
- 収集スクリプトは Node 20（GitHub Actions 上で実行）。ローカル Node は必須ではない。
- **`public/data/` と `state/` は git に入れない**（ORDER §8）。配信前に必ず生成する:
  `python tools/mock.py`（サンプル）または `npm run collect`（実データ・要 `YT_API_KEY`）。
- YouTube API データの保存は **30日以内にリフレッシュまたは削除**（ORDER §8）。
  スナップショットは 31 日で自動削除。

## 5. ローカル検証（この環境の実情）

ローカルに Node / npm / gh CLI は**入っていない**（`NEEDS_HUMAN.md` ゲート0参照）。
入るまでのローカル確認は次で行う:

```
python -m http.server 4173 --directory public
```

Playwright は CI（GitHub Actions）で実行する。仕様は `tests/` に置き、ローカルでは
ブラウザ自動操作ツールでスクリーンショットと DOM を確認する。

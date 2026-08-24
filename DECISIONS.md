# DECISIONS.md — 判断ログ

ORDER §1-1 に従い、発注者に確認せず自己解決した判断を1行ずつ追記する。**追記のみ。削除しない。**

書式: `YYYY-MM-DD | 分野 | 判断 | 理由（最も安く後戻りできる根拠）`

---

- 2026-08-25 | repo | リポジトリ名は `yt-trend-app` のまま、場所は `C:\Users\Owner\yt-trend-app` | 既存プロジェクト（pov_wrestle 等）がユーザーホーム直下に並ぶ慣例に合わせた
- 2026-08-25 | env | ローカルに Node/npm/gh CLI が無い。**インストールを勝手に実行せず** NEEDS_HUMAN.md ゲート0 に記載し、Node 非依存の経路で進める | 環境の書き換えは後戻りコストが高い。収集は Actions 上の Node 20 で走るのでローカル Node は必須ではない
- 2026-08-25 | tooling | ローカル配信は `python -m http.server`、モック生成は Python、視覚確認はブラウザ自動操作 | Python 3.10 は既に入っている。Playwright は CI で実行し、仕様は `tests/` に置く
- 2026-08-25 | ui | UI は `public/index.html` / `public/app.css` / `public/app.js` の3枚に集約（i18n 辞書と config のみ分離） | ORDER §3「発注者が単一ファイルの差分ループで手を入れられる構成を優先」
- 2026-08-25 | data | ランキング JSON はフラット命名 `data/{country}-{section}-{period}-{category}.json`＋`data/index.json` | Service Worker のキャッシュ列挙とプリフェッチが単純になる。階層より後戻りが安い
- 2026-08-25 | data | サムネ URL は JSON に持たず `videoId` から生成（`https://i.ytimg.com/vi/{id}/mqdefault.jpg`） | JSON サイズを約20%削減。i.ytimg.com の URL 規約は安定
- 2026-08-25 | budget | ORDER §4 の「24h＝毎時」は既定割当 10,000 units/日に収まらない（毎時だと 19,392 units/日）。**毎時 cron で起動し、予算プランナが自動で実効間隔を落とす**構成にした | ORDER §4 の「8,000 units 超で自動的に更新頻度を落とすセーフガード」を第一級の設計として実装。詳細は docs/BUDGET.md
- 2026-08-25 | budget | 総合（category=all）は上位100件（search 2ページ）、カテゴリ別タブは上位50件（1ページ） | 100件×全カテゴリは割当に収まらない。カテゴリ別は ORDER §2-3 で「割当の都合でまず24時間のみ」とされており、件数も同じ理由で削るのが最も安い
- 2026-08-25 | shorts | ショート判定は「長さ≤3分」を候補にし、`/shorts/{id}` の到達性で確定。結果は `_shorts_cache.json` に30日 TTL で保存 | ORDER §2-2。HTTP 確認は API 割当を消費しない。失敗時は長さヒューリスティックにフォールバック（数%の誤判定は許容）
- 2026-08-25 | i18n | 言語は `en` を既定、`?lang=` → localStorage → `navigator.language` の順で決定 | ORDER §0「英語ベース＋日本語切替」。世界展開前提のため既定は英語

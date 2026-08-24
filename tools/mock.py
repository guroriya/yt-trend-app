#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/mock.py — モックデータ生成（ローカル UI 開発用 / ORDER §3「APIキー未着の間はモックJSONで全UI開発を先行」）

- 構成は public/js/config.js から読む（設定の二重管理を避けるため簡易パースする）
- 出力は docs/SCHEMA.md のスキーマに完全準拠
- 決定論的（seed 固定）。スクリーンショット差分が安定する
- 生成された JSON の index.json には "source": "mock" が入り、UI に「サンプルデータ」バッジが出る

使い方:  python tools/mock.py
"""
from __future__ import annotations
import json, os, re, random, sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_JS = os.path.join(ROOT, "public", "js", "config.js")
OUT = os.path.join(ROOT, "public", "data")

NOW = datetime(2026, 8, 25, 3, 0, 0, tzinfo=timezone.utc)
rng = random.Random(20260825)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# --------------------------------------------------------------------------
# config.js の簡易パース（単一ソース維持のため）
# --------------------------------------------------------------------------
def read_config():
    src = open(CONFIG_JS, encoding="utf-8").read()

    def block(name):
        m = re.search(r"export const %s = \[(.*?)\n\];" % name, src, re.S)
        if not m:
            sys.exit("config.js: %s block not found" % name)
        return m.group(1)

    countries = re.findall(r"code:\s*'(\w+)'", block("COUNTRIES"))
    sections = re.findall(r"id:\s*'(\w+)'", block("SECTIONS"))
    periods = []
    for pid, days, size in re.findall(
        r"id:\s*'([\w]+)',\s*days:\s*(null|\d+),[^}]*?size:\s*(\d+)", block("PERIODS")
    ):
        periods.append({"id": pid, "days": None if days == "null" else int(days), "size": int(size)})
    cats = []
    for cid, ytid, plist, size in re.findall(
        r"id:\s*'([\w]+)',\s*ytId:\s*(null|'\d+'),\s*periods:\s*\[([^\]]*)\],\s*size:\s*(\d+)",
        block("CATEGORIES"),
    ):
        cats.append({
            "id": cid,
            "ytId": None if ytid == "null" else ytid.strip("'"),
            "periods": re.findall(r"'([\w]+)'", plist),
            "size": int(size),
        })
    map_countries = []
    for code, lat, lon in re.findall(
        r"code:\s*'(\w+)',\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", block("MAP_COUNTRIES")
    ):
        map_countries.append({"code": code, "lat": float(lat), "lon": float(lon)})
    return countries, sections, periods, cats, map_countries


# --------------------------------------------------------------------------
# 素材（サムネイルが実在するよう videoId は実在の著名動画から借りる。
# タイトル・再生数は完全に合成であり、index.json の source:"mock" で明示される）
# --------------------------------------------------------------------------
REAL_IDS = [
    "dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "JGwWNGJdvx8", "OPf0YbXqDm0",
    "fRh_vgS2dFE", "CevxZvSJLk8", "hT_nvWreIhg", "YQHsXMglC9A", "09R8_2nJtjg",
    "RgKAFK5djSk", "lp-EO5I60KA", "pRpeEdMmmQ0", "nfWlot6h_JM", "uelHwf8o7_U",
    "SlPhMPnQ58k", "60ItHLz5WEA", "e-ORhEE9VVg", "2Vv-BfVoq4g", "papuvlVeZg8",
    "kXYiU_JCYtU", "3AtDnEC4zak", "1w7OgIMMRc4", "5qm8PH4xAss", "ktvTqknDobU",
    "0KSOMA3QBU0", "iywaBOMvYLI", "hLQl3WQQoQ0", "450p7goxZqg", "QcIy9NiNbmo",
    "tt2k8PGm-TI", "AJtDXIazrMo", "ru0K8uYEZWw", "L_jWHffIx5E", "PT2_F-1esPk",
    "ZbZSe6N_BXs", "y6120QOlsfU", "djV11Xbc914", "MtN1YnoL46Q", "lWA2pjMjpBs",
]

JA_TITLE_PARTS = [
    ("【衝撃】", "を1週間やってみた結果がヤバすぎた"),
    ("", "の裏側、全部見せます"),
    ("【神回】", "でまさかの展開に…"),
    ("", "を100人に聞いてみた"),
    ("【検証】", "は本当に効果あるのか？"),
    ("", "、ついに完成しました"),
    ("【速報】", "が発表されました"),
    ("", "の作り方を丁寧に解説"),
    ("【感動】", "に涙が止まらない"),
    ("", "を全力で走ってみた"),
]
JA_TOPICS = [
    "深夜の無人駅", "自作キーボード", "町中華チャーハン", "限界ソロキャンプ", "推しのライブ",
    "廃線トンネル", "3000円の福袋", "全自動麻雀卓", "初代ゲーム機", "屋台のたこ焼き",
    "巨大水槽", "地下アイドル", "山奥の温泉", "冷凍餃子", "痩せる筋トレ",
    "格安スマホ", "猫のいる書店", "японский поезд".replace("японский поезд", "夜行列車"), "手打ちそば", "路地裏の古本屋",
]
JA_CHANNELS = [
    "ゆるっと検証チャンネル", "ミッドナイト鉄道", "こばやしクラフト", "町中華をめぐる旅",
    "スタジオ・ハレ", "深夜の実験室", "そらとぶ台所", "ぼっちキャンプ部", "ねこと本と",
    "サウンドの学校", "アトリエ十二時", "山と道と", "0円メシ研究所", "レトロゲーム保存会",
]
EN_TITLE_PARTS = [
    ("", " — I tried it for 7 days straight"),
    ("The truth about ", " that nobody tells you"),
    ("", ": the full breakdown"),
    ("I built ", " from scratch"),
    ("", " but everything goes wrong"),
    ("Why ", " is suddenly everywhere"),
    ("", " — first look"),
    ("Ranking every ", " ever made"),
    ("", " changed my mind completely"),
    ("24 hours inside ", ""),
]
EN_TOPICS = [
    "a $12 mechanical keyboard", "the last night train", "street food in Osaka",
    "a solar powered cabin", "the world's loudest guitar", "an abandoned mall",
    "a 40 year old game console", "the deepest cave dive", "a one man bakery",
    "the fastest chess opening", "a homemade jet engine", "the quietest room on earth",
    "a 1000 mile road trip", "the smallest apartment", "a lost film reel",
]
EN_CHANNELS = [
    "Slow Motion Lab", "Nightline Rail", "Bench & Beam", "The Long Way Round",
    "Studio Halfway", "Quietly Curious", "Kitchen Physics", "Solo Signal",
    "Paper Lantern", "Field Notes", "Twelve O'Clock Atelier", "Low Orbit",
]
LONG_JA = "【超長文タイトル検証用】このタイトルは意図的に極端に長くしてあります、レイアウトが崩れないか、二行で省略されるか、順位や再生数の位置がずれないかを確かめるためのものです"
LONG_EN = "An intentionally extremely long title used to verify that the ranking card layout does not break, that the text clamps to two lines, and that the rank number, view count and delta badge all stay exactly where they belong"

CAT_YT = {"music": "10", "gaming": "20", "entertainment": "24", "sports": "17", "news": "25"}
TAGS_JA = ["検証", "考察", "解説", "実況", "vlog", "料理", "旅", "作業用", "ライブ", "初心者向け", "рэтро".replace("рэтро", "レトロ"), "DIY"]
TAGS_EN = ["review", "howto", "vlog", "live", "reaction", "tutorial", "travel", "build", "cooking", "retro", "asmr", "explained"]


def make_title(country: str, i: int, long_one: bool) -> str:
    if long_one:
        return LONG_JA if country == "JP" else LONG_EN
    if country == "JP":
        pre, post = JA_TITLE_PARTS[i % len(JA_TITLE_PARTS)]
        return f"{pre}{JA_TOPICS[(i * 7) % len(JA_TOPICS)]}{post}"
    pre, post = EN_TITLE_PARTS[i % len(EN_TITLE_PARTS)]
    return f"{pre}{EN_TOPICS[(i * 5) % len(EN_TOPICS)]}{post}".strip().capitalize()


def make_list(country, section, period, category, size, days, metric="published"):
    items = []
    base = rng.randint(4_000_000, 30_000_000) if period in ("all", "year") else rng.randint(200_000, 4_000_000)
    window_start = None if days is None else NOW - timedelta(days=days)
    for i in range(size):
        vid = REAL_IDS[(i * 3 + hash(country + section + period + category)) % len(REAL_IDS)]
        views = int(base * (0.985 ** i) * rng.uniform(0.88, 1.0))
        if days is None:
            published = NOW - timedelta(days=rng.randint(400, 4000))
        else:
            published = NOW - timedelta(minutes=rng.randint(30, max(60, days * 24 * 60)))
        dur = rng.randint(15, 179) if section == "shorts" else rng.randint(181, 3600)
        # 順位変動: 15% が NEW、残りは ±6 の範囲で前回順位を持つ
        if rng.random() < 0.15:
            prev = None
        else:
            prev = max(1, min(size + 8, i + 1 + rng.randint(-6, 6)))
        tags = rng.sample(TAGS_JA if country == "JP" else TAGS_EN, k=rng.randint(2, 5))
        cat_id = CAT_YT.get(category) or rng.choice(list(CAT_YT.values()))
        items.append({
            "rank": i + 1,
            "prevRank": prev,
            "videoId": vid,
            "title": make_title(country, i, long_one=(i in (2, 11))),
            "channelId": "UC" + ("%022d" % ((i * 977 + 13) % 10 ** 22))[:22],
            "channelTitle": (JA_CHANNELS if country == "JP" else EN_CHANNELS)[i % len(JA_CHANNELS if country == "JP" else EN_CHANNELS)],
            "publishedAt": iso(published),
            "viewCount": views,
            "likeCount": int(views * rng.uniform(0.01, 0.06)),
            "commentCount": int(views * rng.uniform(0.0005, 0.004)),
            "durationSec": dur,
            "isShort": section == "shorts",
            "categoryId": cat_id,
            "tags": tags,
            "delta": None if prev is None else prev - (i + 1),
        })
    return {
        "schemaVersion": 1,
        "id": f"{country}-{section}-{period}-{category}" + ("-growth" if metric == "growth" else ""),
        "country": country, "section": section, "period": period, "category": category,
        "metric": metric,
        "generatedAt": iso(NOW),
        "prevGeneratedAt": iso(NOW - timedelta(hours=6)),
        "windowStart": iso(window_start) if window_start else None,
        "items": items,
    }


def main():
    countries, sections, periods, cats, map_countries = read_config()
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))

    datasets = {}
    written = 0
    for c in countries:
        for s in sections:
            for p in periods:
                for cat in cats:
                    if p["id"] not in cat["periods"]:
                        continue
                    size = min(cat["size"], p["size"])
                    data = make_list(c, s, p["id"], cat["id"], size, p["days"])
                    name = f"{c}-{s}-{p['id']}-{cat['id']}"
                    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as fh:
                        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
                    datasets[name] = {"generatedAt": data["generatedAt"], "count": len(data["items"]), "stale": False}
                    written += 1

    # 世界地図
    map_items = []
    for mc in map_countries:
        top = make_list(mc["code"], "video", "24h", "all", 1, 1)["items"][0]
        map_items.append({
            "country": mc["code"], "lat": mc["lat"], "lon": mc["lon"],
            "videoId": top["videoId"], "title": top["title"],
            "channelTitle": top["channelTitle"], "viewCount": top["viewCount"], "isShort": False,
        })
    with open(os.path.join(OUT, "map.json"), "w", encoding="utf-8") as fh:
        json.dump({"schemaVersion": 1, "generatedAt": iso(NOW), "items": map_items}, fh,
                  ensure_ascii=False, separators=(",", ":"))

    # タグ／頻出ワード
    for c in countries:
        pool = TAGS_JA if c == "JP" else TAGS_EN
        extra = (JA_TOPICS if c == "JP" else EN_TOPICS)[:10]
        terms = pool + [t.split()[-1] for t in extra]
        items = []
        for i, t in enumerate(sorted(set(terms))[:24]):
            items.append({
                "term": t, "score": round(100 * (0.93 ** i) * rng.uniform(0.9, 1.05), 1),
                "count": rng.randint(3, 40), "delta": rng.choice([None, -3, -1, 0, 1, 2, 5, 8]),
                "videoIds": rng.sample(REAL_IDS, 3),
            })
        items.sort(key=lambda x: -x["score"])
        for i, it in enumerate(items):
            it["rank"] = i + 1
        with open(os.path.join(OUT, f"tags-{c}.json"), "w", encoding="utf-8") as fh:
            json.dump({"schemaVersion": 1, "country": c, "generatedAt": iso(NOW),
                       "period": "24h", "items": items}, fh, ensure_ascii=False, separators=(",", ":"))

    index = {
        "schemaVersion": 1,
        "generatedAt": iso(NOW),
        "source": "mock",
        "countries": countries,
        "datasets": datasets,
        "features": {
            "growth": {"enabled": False, "daysCollected": 0, "requiredDays": 3, "periods": []},
            "map": True, "tags": True,
        },
        "quota": {"spentToday": 0, "dailyUnits": 10000, "degraded": False},
        "attribution": "This product uses the YouTube API Services.",
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"mock: {written} ranking files + map.json + tags + index.json -> public/data/")


if __name__ == "__main__":
    main()

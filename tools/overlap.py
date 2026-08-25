#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/overlap.py — 2カ国のランキング重複率を測る（API 0 units・公開 JSON を読むだけ）

背景（BACKLOG.md）: GB と US は同じ検索語（SEARCH_Q.en）を使うため、ランキングが
似通う可能性がある。regionCode は効いているはずだが、実データで重複率を測ってから
GB 専用の検索語を入れるかどうかを判断する（2026-08-25 発注者改訂 第3弾）。

使い方:
    python tools/overlap.py            # GB と US（既定）
    python tools/overlap.py JP KR      # 任意の2カ国

判断のめやす: 24時間・総合(video) の重複率が 50% 未満なら regionCode だけで
十分に分かれている → BACKLOG をクローズ。50% 以上なら GB 専用 q の A/B を検討。
"""
from __future__ import annotations
import json, os, sys

try:  # Windows のコンソール（cp932）でも文字化けさせない
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")


def load(name: str):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    a = (sys.argv[1] if len(sys.argv) > 1 else "GB").upper()
    b = (sys.argv[2] if len(sys.argv) > 2 else "US").upper()

    index = load("index.json")
    if not index:
        sys.exit("public/data/index.json がありません（実データが貯まってから実行してください）")
    if index.get("source") == "mock":
        print("注意: これは mock データです。実データで測り直してください。\n")

    rows, worst = [], (None, -1.0)
    for ds_id in sorted(index.get("datasets", {})):
        if not ds_id.startswith(f"{a}-") or ds_id.endswith("-growth"):
            continue
        peer_id = f"{b}-" + ds_id.split("-", 1)[1]
        da, db = load(f"{ds_id}.json"), load(f"{peer_id}.json")
        if not da or not db:
            continue
        ia = {it["videoId"] for it in da.get("items", [])}
        ib = {it["videoId"] for it in db.get("items", [])}
        if not ia or not ib:
            continue
        # 重複率 = 共通 / 小さい方（リスト長が違っても「片方がもう片方をなぞっているか」を見る）
        rate = len(ia & ib) / min(len(ia), len(ib))
        rows.append((ds_id.split("-", 1)[1], len(ia), len(ib), len(ia & ib), rate))
        if rate > worst[1]:
            worst = (ds_id.split("-", 1)[1], rate)

    if not rows:
        sys.exit(f"{a} / {b} の比較できるデータセットがありません")

    print(f"{a} vs {b} の重複率（共通 / 小さい方のリスト長）\n")
    print(f"{'axis':<28}{a:>6}{b:>6}{'共通':>6}{'重複率':>8}")
    for axis, na, nb, common, rate in rows:
        print(f"{axis:<28}{na:>6}{nb:>6}{common:>6}{rate:>7.0%}")

    key = next((r for r in rows if r[0] == "video-24h-all"), None)
    print()
    if key:
        rate = key[4]
        print(f"判定軸 video-24h-all: {rate:.0%}", "→ 50%未満: regionCode で十分分かれている（BACKLOG クローズ可）"
              if rate < 0.5 else "→ 50%以上: 専用 SEARCH_Q の A/B を検討（config.js に国別 q 上書きを足す）")
    print(f"最大重複: {worst[0]} ({worst[1]:.0%})")


if __name__ == "__main__":
    main()

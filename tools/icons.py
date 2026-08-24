#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/icons.py — PWA アイコン PNG を外部ライブラリなしで生成する。

Pillow が無い環境（この開発機）でも動くよう、zlib で PNG を直接書き出す。
デザイン: 角丸の縦グラデーション（accent → gold）に白い稲妻（zap）。
public/icons/icon.svg と同じ形を 4x スーパーサンプリングでラスタライズする。

使い方:  python tools/icons.py
"""
from __future__ import annotations
import os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")

ACCENT = (0xFF, 0x4D, 0x2D)
GOLD = (0xFF, 0xC2, 0x47)
WHITE = (0xFF, 0xFF, 0xFF)

# 1000x1000 座標系の稲妻ポリゴン（icon.svg と同一）
BOLT = [(560, 150), (330, 545), (470, 545), (410, 850), (670, 440), (520, 440)]


def lerp(a, b, u):
    return tuple(int(round(a[i] + (b[i] - a[i]) * u)) for i in range(3))


def inside(poly, x, y):
    n = len(poly)
    c = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def rounded(x, y, size, r):
    """角丸矩形の内側か（0..size 座標）。"""
    if r <= 0:
        return True
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size: int, maskable: bool) -> bytes:
    ss = 4                      # supersampling
    radius = 0 if maskable else size * 0.22
    pad = size * 0.18 if maskable else size * 0.10   # maskable は safe zone を確保
    scale = (size - pad * 2) / 1000.0
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            ar = ag = ab = aa = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = px + (sx + 0.5) / ss
                    y = py + (sy + 0.5) / ss
                    if not rounded(x, y, size, radius):
                        continue
                    base = lerp(ACCENT, GOLD, y / size)
                    bx = (x - pad) / scale
                    by = (y - pad) / scale
                    col = WHITE if inside(BOLT, bx, by) else base
                    ar += col[0]; ag += col[1]; ab += col[2]; aa += 255
            n = ss * ss
            if aa == 0:
                row += bytes((0, 0, 0, 0))
            else:
                k = aa / 255.0
                row += bytes((int(ar / k), int(ag / k), int(ab / k), int(aa / n)))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    return png


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [(180, False, "icon-180.png"), (192, False, "icon-192.png"),
               (512, False, "icon-512.png"), (512, True, "icon-maskable-512.png")]
    for size, maskable, name in targets:
        data = render(size, maskable)
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(data)
        print(f"  {name}  {len(data):,} bytes")

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="TrendZap">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ff4d2d"/><stop offset="1" stop-color="#ffc247"/>
  </linearGradient></defs>
  <rect width="1000" height="1000" rx="220" fill="url(#g)"/>
  <path d="M560 150 330 545h140l-60 305 260-410H520z" fill="#fff"/>
</svg>
"""
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)
    print("  icon.svg")


if __name__ == "__main__":
    main()

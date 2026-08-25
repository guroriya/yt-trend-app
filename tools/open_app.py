#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/open_app.py — ダブルクリック1回でアプリを開くためのランチャ。

なぜ必要か: public/index.html を直接ダブルクリックしても動かない。
このアプリは JSON を fetch し、JS をモジュールとして読み込むので、
file:// で開くとブラウザがどちらもブロックする（同一オリジンにならないため）。
＝ 必ずローカルサーバー越しに開く必要がある。

やること:
  1. public/data/ が空ならサンプルデータを作る（git に入れていないため / ORDER §8）
  2. 空いているポートを探す
  3. ブラウザを開く
  4. サーバーを動かし続ける（Ctrl+C か、開いた黒い画面を閉じれば終了）

使い方:  python tools/open_app.py       ルートの start-app.cmd から呼ばれる
"""
from __future__ import annotations
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
PORTS = range(4173, 4190)


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        # 開発用。編集した CSS/JS が古いキャッシュで隠れないようにする。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass          # アクセスログは出さない（黒い画面を静かに保つ）


def ensure_data() -> None:
    if os.path.exists(os.path.join(PUBLIC, "data", "index.json")):
        return
    print("サンプルデータを作っています…")
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "mock.py")], check=True)


def free_port() -> int:
    for p in PORTS:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit("4173〜4189 がすべて使われています。他のサーバーを止めてください。")


def main() -> None:
    ensure_data()
    port = free_port()
    url = f"http://localhost:{port}/"
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Handler, directory=PUBLIC)
    )
    threading.Timer(0.4, webbrowser.open, args=[url]).start()
    print(f"\n  TrendZap を開きました → {url}")
    print("  この黒い画面を閉じるか Ctrl+C で終了します。\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("終了しました。")


if __name__ == "__main__":
    main()

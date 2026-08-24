#!/usr/bin/env python3
"""tools/devserve.py — リポジトリ全体を配る開発用サーバー。
scripts/*.mjs をブラウザから import して検証するために使う（ローカルに Node が無いため）。
.mjs を text/javascript で返し、CORS を許可する点だけが http.server と違う。
    python tools/devserve.py 4174
"""
import sys, http.server, functools

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.js': 'text/javascript',
                      '.json': 'application/json', '.webmanifest': 'application/manifest+json'}
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 4174
root = sys.argv[2] if len(sys.argv) > 2 else '.'
http.server.ThreadingHTTPServer(('127.0.0.1', port),
    functools.partial(H, directory=root)).serve_forever()

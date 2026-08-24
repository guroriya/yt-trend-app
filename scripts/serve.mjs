/* scripts/serve.mjs — public/ を配る最小の静的サーバー（依存ゼロ）
   Playwright の webServer と `npm run serve` から使う。
   ORDER §3「ビルド工程なし」。npx serve を入れるより起動が速く、依存も増えない。 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    // パストラバーサル対策: 正規化して ROOT の外に出たら 403
    const target = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      // 開発／テスト用サーバーなのでキャッシュさせない（Service Worker の検証を妨げない範囲で）
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    }).end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(err && err.message));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`serving ${ROOT} at http://${HOST}:${PORT}/`);
});

/* TrendZap Service Worker — ORDER §2-10（オフライン時は直近キャッシュを表示）
   方針:
     app shell … precache（install 時）
     data/*.json … network-first → 失敗したらキャッシュ（＝直近の集計を表示）
     i.ytimg.com のサムネ … cache-first（上限件数つき LRU 風の間引き）
   キャッシュ名の版を上げるだけで安全に入れ替わる。 */

// 公開のたびに CI がコミット SHA へ書き換える（.github/workflows の「Service Worker の版を
// コミット SHA で刻む」ステップ）。ここが固定のままだと、本番は cache-first なので
// 一度キャッシュされたシェルが二度と更新されない。手で編集するときも必ず値を変えること。
const VERSION = 'v1';
/* ローカル開発（localhost）ではシェル資産を network-first にする。
   PWA の挙動（install / offline フォールバック）はそのまま検証できるが、
   編集した CSS/JS が古いキャッシュで隠れる事故を防ぐ。 */
const DEV = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const SHELL = `trendzap-shell-${VERSION}`;
const DATA  = `trendzap-data-${VERSION}`;
const IMG   = `trendzap-img-${VERSION}`;
const IMG_MAX = 300;

const SHELL_ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'js/config.js',
  'i18n/en.json',
  'i18n/ja.json',
  'privacy.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/** これが1つでも取れなければ install を失敗させる（壊れたシェルで active にしない）。 */
const CORE_ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'js/config.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 必須ぶんは addAll。失敗したら例外が上がって install が失敗し、次の機会に再試行される。
    await cache.addAll(CORE_ASSETS);
    // 残り（辞書・アイコン等）は欠けてもアプリは動くので、失敗を握って先に進む。
    const rest = SHELL_ASSETS.filter(u => !CORE_ASSETS.includes(u));
    await Promise.allSettled(rest.map(u => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, IMG]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('trendzap-') && !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // サムネイル（別オリジン）
  if (url.hostname.endsWith('ytimg.com')) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        cache.put(req, res.clone());
        trimCache(IMG, IMG_MAX);
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // 集計データ: network-first（常に最新を出したい）／落ちたら直近キャッシュ
  if (url.pathname.includes('/data/')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503, headers: { 'content-type': 'application/json' },
        });
      }
    })());
    return;
  }

  // ナビゲーション: network-first → キャッシュの index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('index.html')) || (await cache.match('./')) ||
          new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // それ以外の同一オリジン資産
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (DEV) {                                   // 開発: network-first
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || new Response('', { status: 504 });
      }
    }
    const hit = await cache.match(req);          // 本番: cache-first（版で入れ替え）
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

/* Service worker: lets the installed app open with no connection.

   App files use "network first, fall back to cache": when you're online you
   always get the latest version (the cache is refreshed as a side effect), and
   when you're offline — or the connection is so slow that waiting is pointless —
   the last good copy is served. Fonts are cached on first use. Requests to other
   origins (the sync API in particular) are never touched. */
const CACHE = 'focus-v1';
const SHELL = [
  './',
  './radhe-labs-focus.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './sync-core.js',
  './sync.js',
];
const NETWORK_TIMEOUT_MS = 3500;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  // one missing file must not stop the app installing, so add them individually
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return new Promise(resolve => {
    let settled = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./radhe-labs-focus.html'));
    const timer = setTimeout(() => {
      fallback().then(hit => { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(req)
      .then(res => {
        clearTimeout(timer);
        if (res && res.ok && !settled) {
          settled = true;
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          resolve(res);
        } else if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        } else if (!settled) {
          settled = true;
          fallback().then(hit => resolve(hit || res));
        }
      })
      .catch(() => {
        clearTimeout(timer);
        if (!settled) { settled = true; fallback().then(hit => resolve(hit || Response.error())); }
      });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
  // anything else (e.g. api.github.com) goes straight to the network
});

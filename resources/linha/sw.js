// Minimal app-shell service worker for the web/PWA delivery only. Electron never registers this
// (see the guarded navigator.serviceWorker.register() call in index.html) — it loads index.html
// directly via file://, where service workers don't run anyway, so this file has zero effect on
// the desktop app even if something went wrong here.
//
// Two different strategies for two different kinds of files:
//  - index.html (the actual app code, changes on every release): NETWORK-FIRST, falling back to
//    cache only when offline. A pure cache-first strategy (the original version of this file) left
//    installed PWAs permanently stuck on whatever index.html happened to be cached at install time
//    — the cache only ever gets refreshed when sw.js's OWN bytes change enough for the browser to
//    notice a new service worker, which index.html edits alone never trigger. Network-first fixes
//    that: every load gets the latest deployed code whenever there's a connection, with the cached
//    copy only used as an offline fallback — while still keeping "installable, works offline" true.
//  - manifest.json/icons (static, rarely change): CACHE-FIRST, same as before — no reason to hit
//    the network for something that's essentially immutable between releases.
const CACHE_NAME = 'linha-shell-v2';
const SHELL_FILES = ['./index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

function isAppShellDocument(url){
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let Google Fonts etc. go straight to network

  if (event.request.mode === 'navigate' || isAppShellDocument(url)) {
    event.respondWith(
      fetch(event.request)
        .then((fresh) => {
          const copy = fresh.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return fresh;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Minimal app-shell service worker for the web/PWA delivery only. Electron never registers this
// (see the guarded navigator.serviceWorker.register() call in index.html) — it loads index.html
// directly via file://, where service workers don't run anyway, so this file has zero effect on
// the desktop app even if something went wrong here.
//
// Cache-first for the app shell (this is what makes "Add to Home Screen" count as an installable,
// offline-capable PWA on both iOS Safari and Android Chrome — an install prompt without a service
// worker isn't a real PWA install on Android). Bump CACHE_NAME to invalidate old caches on a new
// release; anything not explicitly listed here (video files, project data — all in-memory or
// IndexedDB/localStorage, never fetched through this worker) is left alone.
const CACHE_NAME = 'linha-shell-v1';
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let Google Fonts etc. go straight to network
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// The deploy workflow replaces __BUILD__ with the commit SHA, so every deploy gets a fresh cache.
const VERSION = '__BUILD__';
const DEV = VERSION.startsWith('__');
const CACHE = `welltrack-${VERSION}`;

// Relative paths so the app works at a GitHub Pages sub-path like /welltrack/.
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/core.js', 'js/foods.js', 'js/store.js', 'js/ai.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  if (DEV) self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('welltrack-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this when the user taps "Reload" on the update toast.
self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // never touch Anthropic API calls

  // In development, or for page loads, go to the network first so edits show up; fall back to cache offline.
  if (DEV || req.mode === 'navigate') {
    event.respondWith(
      fetch(req, DEV ? { cache: 'no-store' } : undefined)
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('index.html'))),
    );
    return;
  }

  // Deployed assets are pinned to this version's cache, so a page never mixes old and new modules.
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./'))),
  );
});

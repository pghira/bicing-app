const CACHE_NAME = 'bicing-fast-v4-nocache';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Wipe out ALL existing caches to force a fresh load
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => caches.delete(key)));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Completely bypass cache during development to ensure CSS updates
  event.respondWith(fetch(event.request));
});

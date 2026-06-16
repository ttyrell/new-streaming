const CACHE_NAME = 'streamer-v1';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

// Install Service Worker and Cache Assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate and Clean Old Caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch and Serve Cached Assets or Network Fallback
self.addEventListener('fetch', (e) => {
  // Only intercept HTTP requests (ignore chrome-extension, etc.)
  if (!e.request.url.startsWith('http')) return;

  // TMDB API requests shouldn't be cached in the service worker static cache
  if (e.request.url.includes('api.themoviedb.org')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});

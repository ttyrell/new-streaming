const STATIC_CACHE = 'streamer-static-v2';
const API_CACHE = 'streamer-api-v2';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

// Install Service Worker and Pre-Cache App Shell Assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate and Purge Legacy Caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch Strategy: Network-First for TMDB API, Stale-While-Revalidate for App Shell
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http') || e.request.method !== 'GET') return;

  // Network-First with Cache Fallback for TMDB API calls (offline resilience)
  if (e.request.url.includes('api.themoviedb.org')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Stale-While-Revalidate for Static Assets
  e.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(e.request).then((cachedResponse) => {
        const networkFetch = fetch(e.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    )
  );
});

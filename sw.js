const CACHE_VERSION = 'silqueroad-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

const STATIC_ASSETS = [
  '/icon-192 (3).png',
  '/icon-512 (3).png',
  '/logo (4).png'
];

const HTML_PAGES = [
  '/',
  '/index.html',
  '/marketplace.html',
  '/about.html',
  '/compliance.html',
  '/seller-apply.html',
  '/order-status.html',
  '/terms.html',
  '/privacy.html',
  '/seller-agreement.html',
  '/disclaimer.html',
  '/404.html'
];

// Never cache these
const BYPASS_URLS = [
  'supabase.co',
  'nowpayments.io',
  '.netlify/functions',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'api.resend.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => !key.startsWith(CACHE_VERSION)).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Bypass API and external calls
  if (BYPASS_URLS.some(u => url.includes(u))) return;

  // HTML pages — network first, fall back to cache
  if (event.request.destination === 'document' || url.endsWith('.html') || url === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/404.html')))
    );
    return;
  }

  // Static assets — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

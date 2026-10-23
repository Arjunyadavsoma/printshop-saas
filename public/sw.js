/**
 * PrintShop SaaS — Service Worker
 *
 * Strategy:
 *   - Precache the app shell on install (homepage, login, icons, manifest)
 *   - Static assets (_next/static/*, images, fonts): cache-first, fall back
 *     to network, cache new responses for next time
 *   - Navigations (HTML pages): network-first (fresh when online, cached
 *     shell when offline)
 *   - API calls (/api/*): NEVER cache — always go to network so the
 *     shopkeeper sees fresh orders/payments
 *   - Cross-origin requests (local printer agents on 127.0.0.1:32191/32192,
 *     Supabase storage): NEVER intercept — let the browser handle them
 *     directly (the SW only sees same-origin requests anyway, but being
 *     explicit avoids surprises)
 *
 * Versioning: bump CACHE_VERSION on every deploy so the activate handler
 * purges old caches.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `printshop-static-${CACHE_VERSION}`;
const APP_SHELL = [
  '/',
  '/shop/login',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // addAll is atomic — if any URL fails, none are cached. Use individual
      // puts so a single missing URL doesn't break the whole shell.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only intercept GET — POST/PUT/DELETE go straight through.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only handle same-origin requests. Cross-origin (printer agents,
  // Supabase, external CDNs) bypass the SW entirely.
  if (url.origin !== self.location.origin) return;

  // NEVER cache API calls — shopkeepers need fresh order/payment data.
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (Next.js hashed assets, images, fonts, icons) — cache-first.
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|css|js|wasm)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              // Cache a copy for next time (only valid responses).
              if (res.ok && res.type === 'basic') {
                const copy = res.clone();
                caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
              }
              return res;
            })
            .catch(() => cached),
      ),
    );
    return;
  }

  // Navigations (HTML pages) — network-first, fall back to cached page,
  // then to the cached homepage shell as a last resort.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  // Default for other same-origin GETs (e.g. manifest, dynamic imports) —
  // stale-while-revalidate: serve cache immediately, refresh in background.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Allow the page to trigger an immediate update (skipWaiting + claim).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

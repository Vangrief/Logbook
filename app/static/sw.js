/* Logbook service worker — makes the app installable and keeps it usable
   offline without ever serving stale code.

   Strategy:
   - HTML (navigations): network-only, never cached. A deploy is picked up on
     the very next normal refresh; offline shows a minimal message.
   - JS / CSS: network-first. The newest deploy wins; cache is only a fallback
     when the network is unavailable.
   - Icons / fonts / manifest: cache-first. These never change between deploys
     (and the cache key carries the git hash anyway).
   - API: network-first, cache as offline fallback.

   The placeholder in CACHE_VERSION below is replaced with the git commit hash
   at build time (see Dockerfile) so every build invalidates the old cache. */
const CACHE_VERSION = 'logbook-v2-CACHE_VERSION_PLACEHOLDER';

// Pre-cached as offline fallbacks only. HTML shells are deliberately absent so
// they are always fetched fresh from the network.
const SHELL = [
  "/manifest.json",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/js/api.js",
  "/static/js/util.js",
  "/static/icons/icon-72.png",
  "/static/icons/icon-96.png",
  "/static/icons/icon-128.png",
  "/static/icons/icon-144.png",
  "/static/icons/icon-152.png",
  "/static/icons/icon-192.png",
  "/static/icons/icon-384.png",
  "/static/icons/icon-512.png",
];

const OFFLINE_HTML =
  "<!doctype html><meta charset=utf-8><meta name=viewport " +
  "content='width=device-width,initial-scale=1'>" +
  "<title>Offline · Logbook</title>" +
  "<body style='font-family:system-ui,sans-serif;background:#15110f;color:#e8e2dc;" +
  "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;" +
  "text-align:center'>" +
  "<div><h1 style='font-weight:600'>Offline</h1>" +
  "<p style='color:#8a7f7f'>Logbook can’t reach the network. " +
  "Reconnect and refresh to continue.</p></div>";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // Tolerate individual failures (e.g. an asset 404s during a partial deploy).
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network-first: try the network, store a fresh copy, fall back to cache offline.
function networkFirst(req, origin) {
  return fetch(req)
    .then((resp) => {
      if (resp.ok && origin === self.location.origin) {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
      }
      return resp;
    })
    .catch(() => caches.match(req));
}

// Cache-first: serve from cache, otherwise fetch and store.
function cacheFirst(req, origin) {
  return caches.match(req).then(
    (cached) =>
      cached ||
      fetch(req).then((resp) => {
        if (resp.ok && origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return resp;
      })
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const path = url.pathname;

  // HTML navigations: always network, never cache. Offline → minimal message.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
      )
    );
    return;
  }

  // Cache-first for assets that never change between deploys.
  const isImmutable =
    path.startsWith("/static/icons/") ||
    path.startsWith("/static/fonts/") ||
    path === "/manifest.json";
  if (isImmutable) {
    event.respondWith(cacheFirst(req, url.origin));
    return;
  }

  // Network-first for JS/CSS (and API), so new deploys are picked up at once.
  event.respondWith(networkFirst(req, url.origin));
});

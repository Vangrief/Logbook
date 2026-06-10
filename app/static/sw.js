/* Logbook service worker — minimal, makes the app installable + offline shell.
   Cache-first for static assets, network-first for API calls.
   The placeholder in CACHE_VERSION below is replaced with the git commit hash
   at build time (see Dockerfile) so every build invalidates the old cache. */
const CACHE_VERSION = 'logbook-CACHE_VERSION_PLACEHOLDER';

const SHELL = [
  "/",
  "/login",
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // Tolerate individual failures (e.g. "/" may redirect when signed out).
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Network-first for API calls; fall back to cache if offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Cache-first for everything else (the app shell / static assets).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((resp) => {
          // Cache same-origin successful GETs for later.
          if (resp.ok && url.origin === self.location.origin) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          }
          return resp;
        })
    )
  );
});

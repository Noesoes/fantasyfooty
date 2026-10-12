// Service worker for the installed app. It keeps the app's own files on the
// phone so it opens instantly, even on bad stadium Wi-Fi. Data from Sleeper
// and ESPN is never cached here — it always comes fresh from the network.
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const MAX_ASSETS = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(new Request(self.registration.scope, { cache: "reload" })))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Sleeper, ESPN, images: straight to the network
  if (url.pathname.endsWith(".json") && !url.pathname.includes("/_next/")) return; // live snapshots

  // Pages: network first so updates show up right away; cached copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(self.registration.scope, copy));
          }
          return res;
        })
        .catch(() => caches.match(self.registration.scope, { ignoreSearch: true }).then((r) => r || Response.error())),
    );
    return;
  }

  // Build files have a content hash in their name, so a cached copy never goes stale.
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy).then(trim));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons, manifest: serve what we have, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});

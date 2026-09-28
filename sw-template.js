// Jackpop's service worker: keeps the machine on the phone so it starts
// offline. The build fills in VERSION and PRECACHE (see vite.config.ts).
/* global self, caches, fetch, location */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `jackpop-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("jackpop-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks for the waiting version when you tap "Neu laden".
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (request.mode === "navigate") {
    // Online the page comes fresh from the server (new releases show up at
    // once); offline the saved copy starts the machine.
    event.respondWith(fetch(request).catch(async () => (await caches.match(SCOPE, { ignoreSearch: true, ignoreVary: true })) ?? Response.error()));
    return;
  }
  // Bundles are content-hashed, so a saved copy never goes stale. The cache
  // holds only this app's own files, so a server's Vary header (Origin,
  // Accept-Encoding) must not stop a module script from finding its copy.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request)));
});

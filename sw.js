// Service worker: lets the game be installed as an app and opens it quickly
// next time. The game's own files are kept in a cache and refreshed in the
// background; map data and the libraries from other sites always come from
// the network, since the game needs a connection to fly anyway.

const CACHE = "aircraft-explorer-v1";
const FILES = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "src/main.js",
  "src/config.js",
  "src/physics.js",
  "src/route.js",
  "src/trip.js",
  "src/places.js",
  "src/input.js",
  "src/facade.js",
  "src/flights.js",
  "src/labels.js",
  "src/suggest.js",
  "src/minimap.js",
  "src/helicopter.js",
  "data/airports.json",
  "data/runways.json",
  "models/Cesium_Air.glb",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
  );
  self.clients.claim();
});

// The game's files: from the cache straight away, updated from the network
// for next time ("stale while revalidate"). Everything else: network only.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const fresh = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

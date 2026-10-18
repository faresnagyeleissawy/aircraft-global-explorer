// Service worker: lets the game be installed as an app. The game's own files
// always come fresh from the network when it can be reached, checked against
// the server rather than any older copy the browser holds, so a new version
// never mixes with pieces of the old one; the cached copies are only used when
// there is no connection. Map data and the libraries from other sites always
// come from the network, since the game needs a connection to fly anyway.

const CACHE = "aircraft-explorer-v2";
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
  "src/jet.js",
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

// The game's files: network first ("no-cache" makes the browser check with
// the server), the saved copy when offline. Everything else: network only.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(event.request, { cache: "no-cache" });
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        throw new Error("offline and not saved: " + url.pathname);
      }
    })
  );
});

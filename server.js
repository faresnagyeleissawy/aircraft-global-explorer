// Local server for the game: serves the files in this folder and relays live
// aircraft positions, which the browser cannot fetch itself because the free
// flight-data services do not allow requests from other web sites.
//
//   node server.js            # http://localhost:8080
//
// Flight data: https://adsb.lol (open data, ODbL). No key needed.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8080;
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const FLIGHTS_API = "https://api.adsb.lol/v2/point/";
const USER_AGENT = "aircraft-global-explorer (https://github.com/faresnagyeleissawy/aircraft-global-explorer)";
const MAX_RADIUS = 250; // nautical miles, the most the service allows
const CACHE_MS = 5000; // repeat requests for the same area reuse the last answer

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

const cache = new Map();

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}

async function flights(query, res) {
  const lat = Number(query.get("lat"));
  const lon = Number(query.get("lon"));
  const dist = Math.min(MAX_RADIUS, Math.max(1, Number(query.get("dist")) || 100));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    send(res, 400, "application/json", JSON.stringify({ error: "lat and lon must be numbers in range" }));
    return;
  }
  // One decimal place (about 10 km) is plenty to centre a 100+ mile circle.
  const key = lat.toFixed(1) + "/" + lon.toFixed(1) + "/" + Math.round(dist);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) {
    send(res, 200, "application/json", hit.body);
    return;
  }
  try {
    // The service turns away requests that do not say who is asking.
    const answer = await fetch(FLIGHTS_API + key, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!answer.ok) throw new Error("flight service answered " + answer.status);
    const body = await answer.text();
    cache.set(key, { time: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    send(res, 200, "application/json", body);
  } catch (err) {
    send(res, 502, "application/json", JSON.stringify({ error: String(err.message || err) }));
  }
}

async function file(pathname, res) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "") || "index.html";
  const full = join(ROOT, relative);
  // Never serve anything outside this folder, or git's own files.
  if (!full.startsWith(ROOT) || relative.split(sep).some((part) => part.startsWith("."))) {
    send(res, 404, "text/plain", "Not found");
    return;
  }
  try {
    send(res, 200, TYPES[extname(full)] || "application/octet-stream", await readFile(full));
  } catch {
    send(res, 404, "text/plain", "Not found");
  }
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") send(res, 405, "text/plain", "Method not allowed");
  else if (url.pathname === "/api/flights") flights(url.searchParams, res);
  else file(url.pathname, res);
}).listen(PORT, "127.0.0.1", () => {
  console.log("Aircraft Global Explorer: http://localhost:" + PORT);
});

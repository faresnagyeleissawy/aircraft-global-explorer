// Route helpers. Pure functions with no Cesium imports, so they can be unit
// tested in Node. Points are { lon, lat } in degrees; headings are radians
// (0 = north, clockwise) to match physics.js.

const EARTH_RADIUS = 6378137;
const rad = (d) => (d * Math.PI) / 180;

export const BURJ_KHALIFA = { name: "Burj Khalifa", lon: 55.2744, lat: 25.1972 };

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  const twoPi = Math.PI * 2;
  return (Math.atan2(y, x) + twoPi) % twoPi;
}

// Points along the shortest path over the globe from a to b, both included:
// the line a flight between them follows.
export function greatCircle(a, b, steps) {
  const vector = (p) => {
    const lat = rad(p.lat);
    const lon = rad(p.lon);
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  const va = vector(a);
  const vb = vector(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-9) return [a, b];
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    const wb = Math.sin(t * angle) / Math.sin(angle);
    const [x, y, z] = [0, 1, 2].map((k) => wa * va[k] + wb * vb[k]);
    points.push({ lon: (Math.atan2(y, x) * 180) / Math.PI, lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI });
  }
  return points;
}

// "25.19, 55.27" typed into a search box.
export function parseLatLon(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Separate X (longitude) and Y (latitude) boxes.
export function parseXY(x, y) {
  if (!String(x).trim() || !String(y).trim()) return null;
  const lon = Number(x);
  const lat = Number(y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { lon, lat };
}

// Wraps a list of points with the running distance to the end of the line.
export function createRoute(points) {
  const toEnd = new Array(points.length).fill(0);
  for (let i = points.length - 2; i >= 0; i--) {
    toEnd[i] = toEnd[i + 1] + distance(points[i], points[i + 1]);
  }
  return { points, toEnd, length: toEnd[0] || 0, index: 0 };
}

// Distance left to drive from `here`. Remembers the closest point so far and
// only looks a little way back, so a route that crosses itself is not confused.
export function remaining(route, here) {
  const { points, toEnd } = route;
  if (points.length === 0) return 0;
  let best = route.index;
  let bestDist = Infinity;
  const from = Math.max(0, route.index - 5);
  const to = Math.min(points.length - 1, route.index + 60);
  for (let i = from; i <= to; i++) {
    const d = distance(here, points[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  route.index = best;
  return bestDist + toEnd[best];
}

// One-line name for a place from OpenStreetMap address parts, as returned by
// the Photon geocoder: "Dubai Mall, Dubai, United Arab Emirates".
export function placeName(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const parts = [p.name || street, p.name ? street : "", p.city || p.county, p.state, p.country];
  return parts.filter((part, i) => part && parts.indexOf(part) === i).join(", ");
}

// First few parts of a long comma-separated address.
export function shortAddress(text, parts = 3) {
  return text.split(", ").slice(0, parts).join(", ");
}

export function formatDistance(meters) {
  return meters >= 1000 ? (meters / 1000).toFixed(1) + " km" : Math.round(meters / 10) * 10 + " m";
}

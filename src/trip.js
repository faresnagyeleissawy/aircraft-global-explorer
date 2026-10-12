// A flight from one place to another, flown on autopilot: where the plane is
// after a given distance along the line, and how high. Pure functions with no
// Cesium imports, so they can be unit tested in Node.
//
// Points are { lon, lat } in degrees, distances and heights meters, headings
// radians (0 = north, clockwise), as in route.js.

import { bearing, createRoute, distance } from "./route.js";

export const CRUISE_SPEED = 250; // meters per second, about 900 km/h
const CRUISE_HEIGHT = 10500; // above the ground
const END_HEIGHT = 600; // above the ground at both ends of the trip
const CLIMB = 0.08; // meters up per meter flown
const DESCENT = 0.05;

// points: the line to fly. startGround / endGround: ground level at its two ends.
export function createTrip(points, startGround, endGround, from, to) {
  const route = createRoute(points);
  return {
    route,
    from,
    to,
    length: route.length,
    startGround,
    endGround,
    // Short hops never reach airliner height.
    cruise: Math.min(CRUISE_HEIGHT, END_HEIGHT + route.length * 0.03),
    flown: 0,
    segment: 0, // index of the line segment the plane is on, kept to make the lookup quick
  };
}

// Height above the ellipsoid after `flown` meters: climb, cruise, descend.
export function tripHeight(trip, flown) {
  const part = trip.length > 0 ? flown / trip.length : 1;
  const ground = trip.startGround + (trip.endGround - trip.startGround) * part;
  const up = END_HEIGHT + flown * CLIMB;
  const down = END_HEIGHT + (trip.length - flown) * DESCENT;
  return ground + Math.max(END_HEIGHT, Math.min(trip.cruise, up, down));
}

// Position and attitude after `flown` meters along the line.
export function tripState(trip, flown) {
  const { points, toEnd } = trip.route;
  const s = Math.max(0, Math.min(trip.length, flown));
  const fromStart = (i) => trip.length - toEnd[i];
  let i = Math.min(trip.segment, points.length - 2);
  while (i > 0 && fromStart(i) > s) i--;
  while (i < points.length - 2 && fromStart(i + 1) < s) i++;
  trip.segment = i;

  const a = points[i];
  const b = points[i + 1];
  const span = fromStart(i + 1) - fromStart(i);
  const t = span > 0 ? (s - fromStart(i)) / span : 0;
  // Take the short way round where the line crosses longitude 180.
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const lon = ((a.lon + dLon * t + 540) % 360) - 180;
  const here = { lon, lat: a.lat + (b.lat - a.lat) * t };
  const step = 200;
  return {
    ...here,
    // Aim at the end of the segment, so the nose follows the curve of the line.
    heading: bearing(distance(here, b) > 1 ? here : a, b),
    height: tripHeight(trip, s),
    pitch: Math.atan2(tripHeight(trip, Math.min(trip.length, s + step)) - tripHeight(trip, s), step),
  };
}

// Distance along the line of the point on it nearest to `here`, for rejoining
// the trip after flying by hand.
export function nearestFlown(trip, here) {
  const { points, toEnd } = trip.route;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = distance(here, points[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return trip.length - toEnd[best];
}

// "3 h 05 min" or "12 min".
export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return minutes + " min";
  return Math.floor(minutes / 60) + " h " + String(minutes % 60).padStart(2, "0") + " min";
}

// Airports are rows of [code, name, city, country, lat, lon].
export function airportPlace(row) {
  return { code: row[0], name: row[0] + " – " + row[1] + (row[2] ? ", " + row[2] : ""), lat: row[4], lon: row[5], airport: true };
}

// The airport with exactly this three-letter code, if any.
export function findAirport(airports, text) {
  const code = text.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const row = airports.find((a) => a[0] === code);
  return row ? airportPlace(row) : null;
}

// Airports to suggest for what has been typed: codes first, then cities and names.
export function suggestAirports(airports, text, limit = 5) {
  const typed = text.trim().toLowerCase();
  if (typed.length < 2) return [];
  const byCode = airports.filter((a) => a[0].toLowerCase().startsWith(typed));
  const byCity = airports.filter((a) => !byCode.includes(a) && a[2].toLowerCase().startsWith(typed));
  const byName = airports.filter(
    (a) => !byCode.includes(a) && !byCity.includes(a) && typed.length > 2 && a[1].toLowerCase().includes(typed)
  );
  return [...byCode, ...byCity, ...byName].slice(0, limit).map(airportPlace);
}

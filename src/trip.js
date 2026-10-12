// A flight from one place to another, flown on autopilot: where the plane is
// after a given distance along the line, how high and how fast. Pure functions
// with no Cesium imports, so they can be unit tested in Node.
//
// A trip either starts and ends in the air above its two ends, or, with
// runways, rolls down one runway and lands on another.
//
// Points are { lon, lat } in degrees, distances and heights meters, headings
// radians (0 = north, clockwise), as in route.js.

import { bearing, createRoute, distance, greatCircle } from "./route.js";

export const CRUISE_SPEED = 250; // meters per second, about 900 km/h
const CRUISE_HEIGHT = 10500; // above the ground
const END_HEIGHT = 600; // above the ground at both ends of a trip without runways
const CLIMB = 0.08; // meters up per meter flown
const DESCENT = 0.05;
const GLIDE = Math.tan((3 * Math.PI) / 180); // the usual 3 degree approach to a runway
const GEAR = 2; // meters from the wheels to the middle of the plane
const TAKEOFF_SPEED = 80;
const LANDING_SPEED = 70;
const TAXI_SPEED = 3; // slowest the plane moves on the runway
const SPEED_UP = 0.004; // m/s gained or lost per meter flown, in the climb and the approach
const CLIMB_OUT = 8000; // straight ahead after the runway before turning on course
const FINAL = 15000; // lined up with the runway this far before it
const TOUCHDOWN = 300; // past the start of the runway
export const MIN_RUNWAY_TRIP = 60000; // shorter trips have no room for the two turns

const EARTH_RADIUS = 6378137;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// The point `meters` away from p in the direction `heading`. Good for the few
// kilometers around a runway.
function ahead(p, heading, meters) {
  return {
    lon: p.lon + deg((meters * Math.sin(heading)) / (EARTH_RADIUS * Math.cos(rad(p.lat)))),
    lat: p.lat + deg((meters * Math.cos(heading)) / EARTH_RADIUS),
  };
}

// Smallest angle between two headings.
function turn(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// The line for a trip between two runways, each given as [lat, lon, lat, lon]
// for its two ends. Both are used in the direction that best matches the way
// the trip goes. Returns the points and where along them the wheels leave and
// meet the ground.
export function runwayLine(departure, arrival) {
  const ends = (r) => [
    { lat: r[0], lon: r[1] },
    { lat: r[2], lon: r[3] },
  ];
  let [start, far] = ends(departure);
  let [threshold, stop] = ends(arrival);
  const course = bearing(start, threshold);
  if (turn(bearing(start, far), course) > Math.PI / 2) [start, far] = [far, start];
  if (turn(bearing(threshold, stop), course) > Math.PI / 2) [threshold, stop] = [stop, threshold];

  const climbOut = ahead(far, bearing(start, far), CLIMB_OUT);
  const final = ahead(threshold, bearing(stop, threshold), FINAL);
  const between = distance(climbOut, final);
  const cruise = greatCircle(climbOut, final, Math.max(2, Math.min(400, Math.ceil(between / 5000))));
  const points = [start, far, ...cruise, threshold, stop];
  const length = createRoute(points).length;
  return {
    points,
    liftoff: Math.min(2000, distance(start, far) * 0.7),
    touchdown: length - distance(threshold, stop) + Math.min(TOUCHDOWN, distance(threshold, stop) / 2),
  };
}

// points: the line to fly. startGround / endGround: ground level at its two
// ends. runway: { liftoff, touchdown } from runwayLine, or nothing for a trip
// that starts and ends in the air.
export function createTrip(points, startGround, endGround, from, to, runway) {
  const route = createRoute(points);
  return {
    route,
    from,
    to,
    length: route.length,
    startGround,
    endGround,
    runways: Boolean(runway),
    liftoff: runway ? runway.liftoff : 0,
    touchdown: runway ? runway.touchdown : route.length,
    // Short hops never reach airliner height.
    cruise: Math.min(CRUISE_HEIGHT, END_HEIGHT + route.length * 0.03),
    flown: 0,
    segment: 0, // index of the line segment the plane is on, kept to make the lookup quick
  };
}

// Height above the ground after `flown` meters: climb, cruise, descend.
export function tripClearance(trip, flown) {
  const ends = trip.runways ? 0 : END_HEIGHT;
  const up = ends + Math.max(0, flown - trip.liftoff) * CLIMB;
  const down = ends + Math.max(0, trip.touchdown - flown) * (trip.runways ? GLIDE : DESCENT);
  return Math.min(trip.cruise, up, down);
}

// Height above the ellipsoid after `flown` meters.
export function tripHeight(trip, flown) {
  const airborne = trip.touchdown - trip.liftoff;
  const part = airborne > 0 ? Math.max(0, Math.min(1, (flown - trip.liftoff) / airborne)) : 1;
  const ground = trip.startGround + (trip.endGround - trip.startGround) * part;
  return ground + tripClearance(trip, flown) + (trip.runways ? GEAR : 0);
}

// Speed over the ground after `flown` meters. Without runways the plane
// cruises all the way; with them it speeds up along the runway and in the
// climb, and slows down for the approach and after landing.
export function tripSpeed(trip, flown) {
  if (!trip.runways) return CRUISE_SPEED;
  if (flown < trip.liftoff) return Math.max(TAXI_SPEED, TAKEOFF_SPEED * Math.sqrt(flown / trip.liftoff));
  if (flown >= trip.touchdown) {
    const roll = trip.length - trip.touchdown;
    const left = roll > 0 ? Math.max(0, (trip.length - flown) / roll) : 0;
    return Math.max(TAXI_SPEED, LANDING_SPEED * Math.sqrt(left));
  }
  const climbing = TAKEOFF_SPEED + (flown - trip.liftoff) * SPEED_UP;
  const approaching = LANDING_SPEED + (trip.touchdown - flown) * SPEED_UP;
  return Math.min(CRUISE_SPEED, climbing, approaching);
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
    speed: tripSpeed(trip, s),
    clearance: tripClearance(trip, s),
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

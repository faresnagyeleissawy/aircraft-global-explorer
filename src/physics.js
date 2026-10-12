// Movement model for the plane. Pure functions with no Cesium imports, so
// they can be unit tested in Node with a fake ground function.
//
// Angles are radians. heading: 0 = north, clockwise. lon/lat: radians.
// ground(lon, lat) returns the surface height (meters, ellipsoid) at that point,
// or undefined when the data under that point has not loaded yet.

const EARTH_RADIUS = 6378137;
const GRAVITY = 9.81;

export const PLANE = {
  minSpeed: 35,
  maxSpeed: 200,
  stallSpeed: 40,
  pitchRate: 0.6,
  maxPitch: 0.6,
  maxRoll: 0.8,
  clearance: 2,
};

export function offset(lon, lat, distance, heading) {
  return {
    lon: lon + (distance * Math.sin(heading)) / (EARTH_RADIUS * Math.cos(lat)),
    lat: lat + (distance * Math.cos(heading)) / EARTH_RADIUS,
  };
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

export function createState(lon, lat, height, heading = 0) {
  return {
    lon,
    lat,
    height, // aircraft height above the ellipsoid
    heading,
    pitch: 0, // nose up is positive
    roll: 0,
    speed: 0,
    throttle: 0.4,
    crashed: false,
  };
}

export function updatePlane(s, input, dt, ground) {
  if (s.crashed) return;
  if (input.throttleUp || input.boost) s.throttle = clamp(s.throttle + 0.5 * dt, 0, 1);
  if (input.throttleDown) s.throttle = clamp(s.throttle - 0.5 * dt, 0, 1);

  const target = PLANE.minSpeed + s.throttle * (PLANE.maxSpeed - PLANE.minSpeed);
  s.speed += (target - s.speed) * Math.min(1, dt * 0.4);
  s.speed -= GRAVITY * Math.sin(s.pitch) * 0.5 * dt; // climbing costs speed
  s.speed = clamp(s.speed, 15, PLANE.maxSpeed * 1.2);

  // Up arrow climbs, down arrow dives. Released, the nose slowly levels out.
  const pitchInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (pitchInput !== 0) {
    s.pitch = clamp(s.pitch + pitchInput * PLANE.pitchRate * dt, -PLANE.maxPitch, PLANE.maxPitch);
  } else {
    s.pitch *= 1 - Math.min(1, dt * 0.5);
  }

  const rollInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  s.roll += (rollInput * PLANE.maxRoll - s.roll) * Math.min(1, dt * 2.5);
  s.heading = wrapAngle(s.heading + ((GRAVITY * Math.tan(s.roll)) / Math.max(s.speed, 20)) * dt);

  const horizontal = s.speed * Math.cos(s.pitch) * dt;
  let vertical = s.speed * Math.sin(s.pitch) * dt;
  if (s.speed < PLANE.stallSpeed) vertical -= (PLANE.stallSpeed - s.speed) * 0.5 * dt;

  const next = offset(s.lon, s.lat, horizontal, s.heading);
  s.lon = next.lon;
  s.lat = next.lat;
  s.height += vertical;

  const g = ground(s.lon, s.lat);
  if (g !== undefined && s.height < g + PLANE.clearance) {
    s.crashed = true;
    s.speed = 0;
  }
}

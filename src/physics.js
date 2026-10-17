// Movement models for the plane and the helicopter. Pure functions with no Cesium imports, so
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
    height, // aircraft height above the ellipsoid (a helicopter's skids)
    heading,
    pitch: 0, // nose up is positive
    roll: 0,
    speed: 0,
    vz: 0, // helicopter climb rate, m/s
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

export const HELI = {
  maxSpeed: 75, // about 270 km/h
  maxReverse: -15,
  accel: 6,
  turnRate: 0.9,
  climbRate: 8,
  descentRate: 5, // near the ground: slower than safeTouchdown, so holding S all the way down lands safely
  fastDescent: 12, // high up
  lowAltitude: 60, // meters above the ground where it slows to descentRate
  verticalAccel: 6,
  safeTouchdown: 6, // m/s down: anything faster on landing is a crash
  crashSpeed: 25, // m/s: hitting a wall faster than this is a crash, slower just stops
  maxStep: 1.5, // ground this much higher ahead is a wall; less is a slope to slide up
};

// Up/down arrows fly forward and back, left/right turn on the spot. Climbing
// and descending: W / S, or the up/down arrows with Shift held. Without input
// it hovers. It can land on the ground or a roof if it comes down gently.
export function updateHeli(s, input, dt, ground) {
  if (s.crashed) return;
  const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  s.heading = wrapAngle(s.heading + turn * HELI.turnRate * dt);

  const arrows = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const forward = input.boost ? 0 : arrows;
  const lift = clamp((input.boost ? arrows : 0) + (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0), -1, 1);

  const target = forward > 0 ? HELI.maxSpeed : forward < 0 ? HELI.maxReverse : 0;
  const rate = forward !== 0 ? HELI.accel : HELI.accel * 0.6;
  s.speed += clamp(target - s.speed, -rate * dt, rate * dt);
  const below = ground(s.lon, s.lat);
  const high = below === undefined || s.height - below > HELI.lowAltitude;
  const down = high ? HELI.fastDescent : HELI.descentRate;
  s.vz += clamp(lift * (lift > 0 ? HELI.climbRate : down) - s.vz, -HELI.verticalAccel * dt, HELI.verticalAccel * dt);

  // Nose down to go forward, lean into turns: only for looks.
  s.pitch = clamp(-0.06 * forward - (0.15 * s.speed) / HELI.maxSpeed, -0.3, 0.3);
  s.roll = turn * 0.25 * clamp(Math.abs(s.speed) / HELI.maxSpeed, 0.2, 1);

  s.blocked = false;
  if (Math.abs(s.speed) > 0.01) {
    const next = offset(s.lon, s.lat, s.speed * dt, s.heading);
    const ahead = ground(next.lon, next.lat);
    if (ahead !== undefined && ahead - s.height > HELI.maxStep) {
      if (Math.abs(s.speed) > HELI.crashSpeed) {
        s.crashed = true;
        s.speed = 0;
        s.vz = 0;
        return;
      }
      s.blocked = true;
      s.speed = 0;
    } else {
      s.lon = next.lon;
      s.lat = next.lat;
    }
  }

  s.height += s.vz * dt;
  const g = ground(s.lon, s.lat);
  s.grounded = false;
  if (g !== undefined && s.height <= g) {
    if (s.vz < -HELI.safeTouchdown) {
      s.crashed = true;
      s.speed = 0;
      s.vz = 0;
      s.height = g;
      return;
    }
    s.height = g;
    if (s.vz < 0) s.vz = 0;
    s.grounded = true;
    if (forward === 0) s.speed *= 1 - Math.min(1, dt * 3); // skids do not slide
  }
}

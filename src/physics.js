// Movement models for the plane, the fighter jet and the helicopter. Pure
// functions with no Cesium imports, so
// they can be unit tested in Node with a fake ground function.
//
// Angles are radians. heading: 0 = north, clockwise. lon/lat: radians.
// ground(lon, lat) returns the surface height (meters, ellipsoid) at that point,
// or undefined when the data under that point has not loaded yet.

const EARTH_RADIUS = 6378137;
const GRAVITY = 9.81;

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

export const PLANE = {
  maxSpeed: 200,
  stallSpeed: 40,
  thrust: 6, // m/s² at full throttle
  pitchRate: 0.9, // rad/s with the stick held, at flying speed
  rollRate: 1.8,
  yawRate: 0.35,
  clearance: 2,
  turnBoost: 1, // how hard the wings pull round in a bank, as a multiple of a gentle turn
};

// A fighter in the style of the F-35: much faster, quicker to roll and pitch,
// and pulls much tighter turns.
export const JET = {
  maxSpeed: 550, // about Mach 1.6
  stallSpeed: 75,
  thrust: 30,
  pitchRate: 1.6,
  rollRate: 4.0,
  yawRate: 0.5,
  clearance: 3,
  turnBoost: 5,
};

// ---------------------------------------------------------------- attitude
//
// The plane's attitude is kept as three unit vectors in the local east, north,
// up frame: f points along the nose, r along the right wing, u out of the
// cockpit roof. Turning them by small rotations each step lets the plane loop,
// roll and fly upside down, which angles alone cannot do. heading, pitch and
// roll are worked out from them afterwards, for the camera and the display.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a) => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

// v turned by `angle` about the unit axis k (Rodrigues' formula).
function turn(v, k, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

function turnAll(s, axis, angle) {
  if (!angle) return;
  s.f = turn(s.f, axis, angle);
  s.r = turn(s.r, axis, angle);
  s.u = turn(s.u, axis, angle);
}

// Builds the three vectors from heading, pitch and roll.
function setBasis(s) {
  const [h, p, b] = [s.heading, s.pitch, s.roll];
  s.f = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  const right = [Math.cos(h), -Math.sin(h), 0];
  const up = [-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p)];
  // Roll right: the right wing goes down, the roof leans right.
  s.r = add(scale(right, Math.cos(b)), scale(up, -Math.sin(b)));
  s.u = add(scale(up, Math.cos(b)), scale(right, Math.sin(b)));
  s.attitude = [s.heading, s.pitch, s.roll];
}

// heading, pitch and roll back from the three vectors.
function readBasis(s) {
  s.f = unit(s.f);
  s.r = unit(add(s.r, scale(s.f, -dot(s.r, s.f))));
  s.u = cross(s.r, s.f);
  s.pitch = Math.asin(clamp(s.f[2], -1, 1));
  // Straight up or down the nose has no heading of its own: use the roof's.
  const level = Math.hypot(s.f[0], s.f[1]) > 1e-3 ? s.f : scale(s.u, -Math.sign(s.f[2]));
  s.heading = wrapAngle(Math.atan2(level[0], level[1]));
  s.roll = Math.atan2(-s.r[2], s.u[2]);
  s.attitude = [s.heading, s.pitch, s.roll];
}

// ↑ / ↓ pitch the nose up and down, ← / → roll, Q / E yaw. Held, they keep
// turning, so the plane can loop, roll right round and fly upside down. With
// input.assist the wings and nose come back to level when the keys are let go.
// Thrust (W / S, Shift) and gravity set the speed: climbing slows the plane,
// diving speeds it up, and below its stall speed the nose drops.
export function updatePlane(s, input, dt, ground, model = PLANE) {
  if (s.crashed) return;
  // Someone else (a trip, a respawn) set the angles: start from them.
  if (!s.f || !s.attitude || s.attitude[0] !== s.heading || s.attitude[1] !== s.pitch || s.attitude[2] !== s.roll) {
    setBasis(s);
  }

  if (input.throttleUp || input.boost) s.throttle = clamp(s.throttle + 0.5 * dt, 0, 1);
  if (input.throttleDown) s.throttle = clamp(s.throttle - 0.5 * dt, 0, 1);
  const drag = model.thrust / (model.maxSpeed * model.maxSpeed);
  s.speed += (model.thrust * s.throttle - drag * s.speed * s.speed - GRAVITY * s.f[2]) * dt;
  s.speed = clamp(s.speed, 15, model.maxSpeed * 1.3);

  // Controls bite less when slow.
  const grip = clamp(s.speed / (model.stallSpeed * 1.5), 0.2, 1);
  const pitchIn = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const rollIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const yawIn = (input.yawRight ? 1 : 0) - (input.yawLeft ? 1 : 0);
  turnAll(s, s.r, pitchIn * model.pitchRate * grip * dt);
  turnAll(s, s.f, rollIn * model.rollRate * grip * dt);
  turnAll(s, s.u, -yawIn * model.yawRate * grip * dt);

  readBasis(s);
  if (input.assist) {
    // Let go, and the wings level out and the nose comes back towards the horizon.
    // Only when nothing is held and the nose is not near the vertical: in a
    // loop, going over the top turns the plane upside down, and that is fine.
    if (!rollIn && !pitchIn && Math.abs(s.pitch) < 1) turnAll(s, s.f, -s.roll * Math.min(1, dt * 1.5));
    if (!pitchIn && Math.abs(s.roll) < Math.PI / 2) turnAll(s, s.r, -s.pitch * Math.min(1, dt * 0.4));
  }

  // The wings' lift pulls a banked plane round: right bank, right turn.
  const up = [0, 0, 1];
  const lift = (GRAVITY * Math.sin(s.roll) * Math.cos(s.pitch) * model.turnBoost) / Math.max(s.speed, 20);
  turnAll(s, up, -lift * dt);
  // Too slow, or flying on its side or upside down without pulling: the nose
  // sinks towards the ground.
  const sink = Math.max(0, (model.stallSpeed - s.speed) / model.stallSpeed) + 0.3 * Math.max(0, 1 - s.u[2]) * (pitchIn ? 0 : 1);
  const down = cross(s.f, [0, 0, -1]);
  if (sink > 0 && Math.hypot(...down) > 1e-3) turnAll(s, unit(down), sink * (GRAVITY / Math.max(s.speed, 20)) * dt);
  readBasis(s);

  // Fly where the nose points.
  const step = s.speed * dt;
  const ground2d = Math.hypot(s.f[0], s.f[1]) * step;
  const next = offset(s.lon, s.lat, ground2d, Math.atan2(s.f[0], s.f[1]));
  s.lon = next.lon;
  s.lat = next.lat;
  s.height += s.f[2] * step;

  const g = ground(s.lon, s.lat);
  if (g !== undefined && s.height < g + model.clearance) {
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

// The fighter jet flies like the plane, with the numbers in JET.
export function updateJet(s, input, dt, ground) {
  updatePlane(s, input, dt, ground, JET);
}

// The nose, right-wing and roof directions (east, north, up) of an aircraft
// state, from its vectors when they are current, otherwise from its angles.
export function attitudeVectors(s) {
  const current = s.f && s.attitude && s.attitude[0] === s.heading && s.attitude[1] === s.pitch && s.attitude[2] === s.roll;
  if (current) return { f: s.f, r: s.r, u: s.u };
  const copy = { heading: s.heading, pitch: s.pitch, roll: s.roll };
  setBasis(copy);
  return { f: copy.f, r: copy.r, u: copy.u };
}

// v (east, north, up) turned by `angle` about the unit axis k.
export const rotateVector = turn;

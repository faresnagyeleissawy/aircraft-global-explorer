// Movement models for the three modes. Pure functions with no Cesium imports,
// so they can be unit tested in Node with a fake ground function.
//
// Angles are radians. heading: 0 = north, clockwise. lon/lat: radians.
// ground(lon, lat) returns the surface height (meters, ellipsoid) at that point,
// or undefined when the data under that point has not loaded yet.

const EARTH_RADIUS = 6378137;
const GRAVITY = 9.81;

export const WALK = {
  eyeHeight: 1.7,
  walkSpeed: 1.6,
  runSpeed: 6,
  turnRate: 1.8,
  maxStep: 0.6,
  lookAhead: 0.4,
};

export const CAR = {
  accel: 5,
  boostAccel: 9,
  brake: 12,
  reverseAccel: 3,
  maxSpeed: 40,
  boostMaxSpeed: 60,
  maxReverse: -8,
  steerRate: 0.9,
  maxStep: 1.2,
  lookAhead: 2.5,
};

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
    height, // feet / wheels / aircraft height above the ellipsoid
    heading,
    pitch: 0, // body pitch (car slope, aircraft nose)
    roll: 0,
    lookPitch: 0, // walk mode camera pitch, driven by the mouse
    speed: 0,
    vz: 0,
    throttle: 0.4,
    grounded: false,
    crashed: false,
    blocked: false,
  };
}

// Keeps feet on the surface: steps up instantly (smoothed), falls under gravity.
function settle(s, groundHere, dt) {
  if (groundHere === undefined) return;
  if (s.height <= groundHere + 0.01) {
    s.height += (groundHere - s.height) * Math.min(1, dt * 15);
    if (groundHere - s.height < 0.02) s.height = groundHere;
    s.vz = 0;
    s.grounded = true;
  } else {
    s.vz -= GRAVITY * dt;
    s.height += s.vz * dt;
    if (s.height <= groundHere) {
      s.height = groundHere;
      s.vz = 0;
      s.grounded = true;
    } else {
      s.grounded = false;
    }
  }
}

export function updateWalk(s, input, dt, ground) {
  const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  s.heading = wrapAngle(s.heading + turn * WALK.turnRate * dt);

  const dir = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  s.speed = dir * (input.boost ? WALK.runSpeed : WALK.walkSpeed);
  s.blocked = false;

  if (s.speed !== 0) {
    const next = offset(s.lon, s.lat, s.speed * dt, s.heading);
    const probe = offset(next.lon, next.lat, Math.sign(s.speed) * WALK.lookAhead, s.heading);
    const groundAhead = ground(probe.lon, probe.lat);
    if (groundAhead !== undefined && groundAhead - s.height > WALK.maxStep) {
      s.blocked = true;
      s.speed = 0;
    } else if (groundAhead !== undefined || ground(s.lon, s.lat) !== undefined) {
      s.lon = next.lon;
      s.lat = next.lat;
    }
  }
  settle(s, ground(s.lon, s.lat), dt);
}

export function updateCar(s, input, dt, ground) {
  const maxSpeed = input.boost ? CAR.boostMaxSpeed : CAR.maxSpeed;
  if (input.brake) {
    s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), CAR.brake * 1.3 * dt);
  } else if (input.up) {
    s.speed += (input.boost ? CAR.boostAccel : CAR.accel) * dt;
  } else if (input.down) {
    s.speed -= (s.speed > 0.5 ? CAR.brake : CAR.reverseAccel) * dt;
  } else {
    const drag = 0.8 + 0.004 * s.speed * s.speed;
    s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), drag * dt);
  }
  s.speed = clamp(s.speed, CAR.maxReverse, Math.max(maxSpeed, s.speed - CAR.brake * dt));

  // Steering only bites when moving, and gets gentler at high speed.
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const grip = clamp(Math.abs(s.speed) / 6, 0, 1) / (1 + Math.abs(s.speed) / 25);
  s.heading = wrapAngle(s.heading + steer * CAR.steerRate * grip * Math.sign(s.speed) * dt);

  s.blocked = false;
  if (Math.abs(s.speed) > 0.01) {
    const next = offset(s.lon, s.lat, s.speed * dt, s.heading);
    const probe = offset(next.lon, next.lat, Math.sign(s.speed) * CAR.lookAhead, s.heading);
    const groundAhead = ground(probe.lon, probe.lat);
    if (groundAhead !== undefined && groundAhead - s.height > CAR.maxStep) {
      // Hit a wall: bounce back a little.
      s.blocked = true;
      s.speed = -s.speed * 0.25;
    } else if (groundAhead !== undefined || ground(s.lon, s.lat) !== undefined) {
      s.lon = next.lon;
      s.lat = next.lat;
      if (groundAhead !== undefined && s.grounded) {
        const slope = Math.atan2(groundAhead - s.height, CAR.lookAhead) * Math.sign(s.speed);
        s.pitch += (clamp(slope, -0.4, 0.4) - s.pitch) * Math.min(1, dt * 5);
      }
    }
  }
  settle(s, ground(s.lon, s.lat), dt);
  if (!s.grounded) s.pitch *= 1 - Math.min(1, dt * 2);
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

export const updaters = { walk: updateWalk, car: updateCar, plane: updatePlane };

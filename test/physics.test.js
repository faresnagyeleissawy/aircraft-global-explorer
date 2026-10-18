import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, updatePlane, updateHeli, updateJet, offset } from "../src/physics.js";

const rad = (d) => (d * Math.PI) / 180;
const LON = rad(55.27);
const LAT = rad(25.2);
const noKeys = { up: false, down: false, left: false, right: false, boost: false };

// Flat ground at 0 m with a 30 m tall "building" starting 20 m north of the start.
const wallLat = offset(LON, LAT, 20, 0).lat;
const groundWithWall = (lon, lat) => (lat >= wallLat ? 30 : 0);
const flat = () => 0;

function run(updater, s, input, seconds, ground) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) updater(s, input, dt, ground);
}

test("plane climbs with the up arrow, and leans and turns right with the right arrow", () => {
  const s = createState(LON, LAT, 300, 0);
  s.speed = 70;
  run(updatePlane, s, { ...noKeys, up: true }, 1, flat);
  assert.ok(s.height > 300 && s.pitch > 0.5, "climbed");
  const t = createState(LON, LAT, 3000, 0);
  t.speed = 70;
  run(updatePlane, t, { ...noKeys, right: true }, 2, flat);
  assert.ok(t.roll > 0.4 && t.roll < 0.7, "leaned into the turn, not rolled over: " + t.roll);
  assert.ok(t.heading > 0.5 && t.heading < Math.PI, "came round to the right: " + t.heading);
  const l = createState(LON, LAT, 3000, 0);
  l.speed = 70;
  run(updatePlane, l, { ...noKeys, left: true }, 2, flat);
  assert.ok(l.heading > Math.PI && l.heading < 2 * Math.PI - 0.5, "and to the left: " + l.heading);
});

test("plane loops with the up arrow held, and rolls right round with E held", () => {
  const s = createState(LON, LAT, 3000, 0);
  s.speed = 150;
  s.throttle = 1;
  let wasUpsideDown = false;
  let wasVertical = false;
  const dt = 1 / 60;
  for (let time = 0; time < (2 * Math.PI) / 0.9 + 0.2; time += dt) {
    updatePlane(s, { ...noKeys, up: true }, dt, flat);
    if (s.u[2] < -0.9) wasUpsideDown = true;
    if (s.pitch > 1.4) wasVertical = true;
  }
  assert.ok(wasVertical && wasUpsideDown, "went up, over the top and upside down");
  assert.ok(Math.abs(s.pitch) < 0.4, "came back round to level: " + s.pitch);

  const r = createState(LON, LAT, 3000, 0);
  r.speed = 150;
  let inverted = false;
  for (let time = 0; time < (2 * Math.PI) / 1.8; time += dt) {
    updatePlane(r, { ...noKeys, rollRight: true }, dt, flat);
    if (Math.abs(r.roll) > 3) inverted = true;
  }
  assert.ok(inverted, "rolled upside down on the way");
  assert.ok(Math.abs(r.roll) < 0.3, "and back upright: " + r.roll);
});

test("with assist, the wings level out when the keys are let go", () => {
  const s = createState(LON, LAT, 3000, 0);
  s.speed = 100;
  run(updatePlane, s, { ...noKeys, rollRight: true }, 0.5, flat);
  assert.ok(s.roll > 0.5);
  run(updatePlane, s, { ...noKeys, assist: true }, 4, flat);
  assert.ok(Math.abs(s.roll) < 0.05, "level again: " + s.roll);
});

test("plane dives with down arrow and speeds up with Shift", () => {
  const s = createState(LON, LAT, 300, 0);
  s.speed = 70;
  run(updatePlane, s, { ...noKeys, down: true }, 2, flat);
  assert.ok(s.height < 300, "dived");
  const t = createState(LON, LAT, 300, 0);
  t.speed = 70;
  run(updatePlane, t, { ...noKeys, boost: true }, 5, flat);
  assert.ok(t.throttle > 0.9 && t.speed > 70, "throttle and speed went up");
});

test("plane crashes into tall buildings", () => {
  const s = createState(LON, LAT, 20, 0);
  s.speed = 80;
  run(updatePlane, s, noKeys, 3, groundWithWall);
  assert.equal(s.crashed, true);
});

test("plane ignores ground that has not loaded", () => {
  const s = createState(LON, LAT, 1, 0);
  s.speed = 80;
  run(updatePlane, s, noKeys, 1, () => undefined);
  assert.equal(s.crashed, false);
});

test("helicopter hovers without input and climbs with W", () => {
  const s = createState(LON, LAT, 100, 0);
  run(updateHeli, s, noKeys, 3, flat);
  assert.ok(Math.abs(s.height - 100) < 1e-9, "held its height");
  assert.equal(s.speed, 0);
  run(updateHeli, s, { ...noKeys, throttleUp: true }, 3, flat);
  assert.ok(s.height > 110, "climbed: " + s.height);
});

test("helicopter flies forward with the up arrow and turns on the spot", () => {
  const s = createState(LON, LAT, 100, 0);
  run(updateHeli, s, { ...noKeys, up: true }, 5, flat);
  assert.ok(s.lat > LAT && s.speed > 20, "moving north");
  assert.ok(s.pitch < 0, "nose down");
  const t = createState(LON, LAT, 100, 0);
  run(updateHeli, t, { ...noKeys, right: true }, 1, flat);
  assert.ok(t.heading > 0.5 && t.lat === LAT, "turned without moving");
});

test("helicopter lands gently but crashes when it comes down too fast", () => {
  const s = createState(LON, LAT, 20, 0);
  run(updateHeli, s, { ...noKeys, throttleDown: true }, 10, flat);
  assert.equal(s.crashed, false);
  assert.equal(s.height, 0);
  assert.equal(s.grounded, true);

  const t = createState(LON, LAT, 5, 0);
  t.vz = -12;
  run(updateHeli, t, noKeys, 3, flat);
  assert.equal(t.crashed, true);
});

test("helicopter stops at a building when slow and crashes into it when fast", () => {
  const slow = createState(LON, LAT, 10, 0);
  slow.speed = 5;
  run(updateHeli, slow, noKeys, 6, groundWithWall);
  assert.equal(slow.crashed, false);
  assert.ok(slow.lat < wallLat, "did not pass through the wall");

  const fast = createState(LON, LAT, 10, 0);
  fast.speed = 60;
  run(updateHeli, fast, { ...noKeys, up: true }, 2, groundWithWall);
  assert.equal(fast.crashed, true);
});

test("helicopter comes down fast from high up and slows near the ground", () => {
  const s = createState(LON, LAT, 400, 0);
  run(updateHeli, s, { ...noKeys, throttleDown: true }, 5, flat);
  assert.ok(s.vz < -10, "fast descent high up: " + s.vz);
  run(updateHeli, s, { ...noKeys, throttleDown: true }, 60, flat);
  assert.equal(s.crashed, false, "slowed down in time to land");
  assert.equal(s.grounded, true);
});

test("the jet is faster than the plane, rolls quicker and turns tighter", () => {
  const plane = createState(LON, LAT, 3000, 0);
  plane.speed = 150;
  plane.throttle = 1;
  const jet = createState(LON, LAT, 3000, 0);
  jet.speed = 150;
  jet.throttle = 1;
  run(updatePlane, plane, noKeys, 20, flat);
  run(updateJet, jet, noKeys, 20, flat);
  assert.ok(jet.speed > plane.speed * 1.5, "jet " + jet.speed + " vs plane " + plane.speed);

  const p = createState(LON, LAT, 3000, 0);
  p.speed = 200;
  const j = createState(LON, LAT, 3000, 0);
  j.speed = 200;
  run(updatePlane, p, { ...noKeys, rollRight: true }, 0.3, flat);
  run(updateJet, j, { ...noKeys, rollRight: true }, 0.3, flat);
  assert.ok(j.roll > p.roll * 1.8, "jet rolled " + j.roll + ", plane " + p.roll);

  // Same bank, same speed: the jet comes round faster.
  const pb = createState(LON, LAT, 3000, 0);
  const jb = createState(LON, LAT, 3000, 0);
  for (const s of [pb, jb]) {
    s.speed = 200;
    s.roll = 0.7;
  }
  run(updatePlane, pb, noKeys, 2, flat);
  run(updateJet, jb, noKeys, 2, flat);
  assert.ok(jb.heading > pb.heading * 2, "jet turned " + jb.heading + ", plane " + pb.heading);
});

test("with assist, holding the up arrow still loops", () => {
  const s = createState(LON, LAT, 3000, 0);
  s.speed = 150;
  s.throttle = 1;
  let wasUpsideDown = false;
  const dt = 1 / 60;
  for (let time = 0; time < 8; time += dt) {
    updatePlane(s, { ...noKeys, up: true, assist: true }, dt, flat);
    if (s.u[2] < -0.9) wasUpsideDown = true;
  }
  assert.ok(wasUpsideDown, "went over the top");
});

test("the forward control speeds up every aircraft", () => {
  const plane = createState(LON, LAT, 3000, 0);
  plane.speed = 70;
  run(updatePlane, plane, { ...noKeys, forward: true }, 3, flat);
  assert.ok(plane.throttle > 0.9, "plane throttle opened: " + plane.throttle);

  const jet = createState(LON, LAT, 3000, 0);
  jet.speed = 150;
  run(updateJet, jet, { ...noKeys, forward: true }, 3, flat);
  assert.ok(jet.throttle > 0.9, "jet throttle opened");

  const heli = createState(LON, LAT, 100, 0);
  run(updateHeli, heli, { ...noKeys, forward: true }, 3, flat);
  assert.ok(heli.speed > 10 && heli.lat > LAT, "helicopter flew forward");
});

test("the jet turns left and right faster than the plane, and rolls without turning", () => {
  const p = createState(LON, LAT, 3000, 0);
  p.speed = 200;
  const j = createState(LON, LAT, 3000, 0);
  j.speed = 200;
  run(updatePlane, p, { ...noKeys, right: true }, 1.5, flat);
  run(updateJet, j, { ...noKeys, right: true }, 1.5, flat);
  assert.ok(j.heading > p.heading * 1.5, "jet came round " + j.heading + ", plane " + p.heading);

  // A full roll on Q / E ends pointing the same way it started.
  const r = createState(LON, LAT, 3000, 0);
  r.speed = 200;
  run(updateJet, r, { ...noKeys, rollRight: true }, (2 * Math.PI) / 4.0, flat);
  const heading = Math.min(r.heading, 2 * Math.PI - r.heading);
  assert.ok(heading < 0.25, "still heading about north: " + r.heading);
});

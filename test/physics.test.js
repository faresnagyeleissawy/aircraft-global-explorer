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

test("plane climbs with up arrow and banks right with right arrow", () => {
  const s = createState(LON, LAT, 300, 0);
  s.speed = 70;
  run(updatePlane, s, { ...noKeys, up: true }, 2, flat);
  assert.ok(s.height > 300, "climbed");
  run(updatePlane, s, { ...noKeys, right: true }, 2, flat);
  assert.ok(s.roll > 0.5, "banked right");
  assert.ok(s.heading > 0 && s.heading < Math.PI, "turned right");
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

test("the jet is faster than the plane and turns tighter", () => {
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
  run(updatePlane, p, { ...noKeys, right: true }, 3, flat);
  run(updateJet, j, { ...noKeys, right: true }, 3, flat);
  assert.ok(j.heading > p.heading * 2, "jet turned " + j.heading + ", plane " + p.heading);
});

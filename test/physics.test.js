import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, updatePlane, offset } from "../src/physics.js";

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

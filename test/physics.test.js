import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, updateCar, updateDrone, updatePlane, offset } from "../src/physics.js";

const rad = (d) => (d * Math.PI) / 180;
const LON = rad(55.27);
const LAT = rad(25.2);
const noKeys = { up: false, down: false, left: false, right: false, boost: false, brake: false };

// Flat ground at 0 m with a 30 m tall "building" starting 20 m north of the start.
const wallLat = offset(LON, LAT, 20, 0).lat;
const groundWithWall = (lon, lat) => (lat >= wallLat ? 30 : 0);
const flat = () => 0;

function run(updater, s, input, seconds, ground) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) updater(s, input, dt, ground);
}

test("a car in the air falls to the ground", () => {
  const s = createState(LON, LAT, 10, 0);
  updateCar(s, noKeys, 0.1, flat);
  assert.ok(s.height < 10 && s.height > 0, "falling");
  run(updateCar, s, noKeys, 3, flat);
  assert.equal(s.height, 0);
});

test("drone flies forward with the up arrow and climbs with Shift held", () => {
  const s = createState(LON, LAT, 30, 0);
  run(updateDrone, s, { ...noKeys, up: true }, 2, flat);
  assert.ok(s.lat > LAT, "moved north");
  assert.equal(s.height, 30);
  const lat = s.lat;
  run(updateDrone, s, noKeys, 3, flat); // coast to a stop
  run(updateDrone, s, { ...noKeys, up: true, boost: true }, 2, flat);
  assert.ok(s.height > 40, "climbed");
  assert.ok(Math.abs(s.lat - lat) < 1e-6, "did not move forward while climbing");
});

test("drone stops at a tall building but flies over it from above", () => {
  const low = createState(LON, LAT, 10, 0);
  run(updateDrone, low, { ...noKeys, up: true }, 10, groundWithWall);
  assert.ok(low.lat < wallLat, "did not pass through the wall");
  assert.equal(low.blocked, true);

  const high = createState(LON, LAT, 50, 0);
  run(updateDrone, high, { ...noKeys, up: true }, 10, groundWithWall);
  assert.ok(high.lat > wallLat, "flew over the roof");
});

test("drone never sinks into the ground", () => {
  const s = createState(LON, LAT, 5, 0);
  run(updateDrone, s, { ...noKeys, down: true, boost: true }, 5, flat);
  assert.equal(s.height, 2);
});

test("car accelerates, is speed limited, and bounces off walls", () => {
  const s = createState(LON, LAT, 0, Math.PI / 2); // heading east, wall is north
  run(updateCar, s, { ...noKeys, up: true }, 20, groundWithWall);
  assert.ok(s.speed > 35 && s.speed <= 40.01, `speed ${s.speed}`);

  const t = createState(LON, LAT, 0, 0);
  run(updateCar, t, { ...noKeys, up: true }, 10, groundWithWall);
  assert.ok(t.lat < wallLat, "stopped before the wall");
});

test("car steering turns right only while moving", () => {
  const s = createState(LON, LAT, 0, 0);
  run(updateCar, s, { ...noKeys, right: true }, 1, flat);
  assert.equal(s.heading, 0, "no turning when stopped");
  run(updateCar, s, { ...noKeys, up: true, right: true }, 2, flat);
  assert.ok(s.heading > 0 && s.heading < Math.PI, "turned clockwise");
});

test("plane climbs with up arrow and banks right with right arrow", () => {
  const s = createState(LON, LAT, 300, 0);
  s.speed = 70;
  run(updatePlane, s, { ...noKeys, up: true }, 2, flat);
  assert.ok(s.height > 300, "climbed");
  run(updatePlane, s, { ...noKeys, right: true }, 2, flat);
  assert.ok(s.roll > 0.5, "banked right");
  assert.ok(s.heading > 0 && s.heading < Math.PI, "turned right");
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

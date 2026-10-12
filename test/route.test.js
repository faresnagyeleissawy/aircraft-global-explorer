import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, bearing, parseLatLon, createRoute, remaining, formatDistance, BURJ_KHALIFA } from "../src/route.js";

const A = { lon: 55.27, lat: 25.2 };
const north = (m) => ({ lon: A.lon, lat: A.lat + (m / 6378137) * (180 / Math.PI) });

test("distance and bearing between two points", () => {
  const b = north(1000);
  assert.ok(Math.abs(distance(A, b) - 1000) < 1);
  assert.ok(Math.abs(bearing(A, b)) < 1e-6, "north is heading 0");
  const east = { lon: A.lon + 0.01, lat: A.lat };
  assert.ok(Math.abs(bearing(A, east) - Math.PI / 2) < 0.01, "east is a quarter turn");
});

test("parseLatLon reads coordinates and rejects addresses", () => {
  assert.deepEqual(parseLatLon("25.1972, 55.2744"), { lat: 25.1972, lon: 55.2744 });
  assert.deepEqual(parseLatLon(" 25.1 55.2 "), { lat: 25.1, lon: 55.2 });
  assert.equal(parseLatLon("Dubai Mall"), null);
  assert.equal(parseLatLon("125, 55"), null);
});

test("remaining distance shrinks as you follow the route", () => {
  const route = createRoute([A, north(500), north(1000)]);
  assert.ok(Math.abs(route.length - 1000) < 1);
  assert.ok(Math.abs(remaining(route, A) - 1000) < 1);
  assert.ok(Math.abs(remaining(route, north(500)) - 500) < 1);
  assert.ok(remaining(route, north(1000)) < 1);
});

test("formatDistance switches from meters to kilometers", () => {
  assert.equal(formatDistance(234), "230 m");
  assert.equal(formatDistance(2340), "2.3 km");
});

test("Burj Khalifa is in downtown Dubai", () => {
  assert.ok(distance(BURJ_KHALIFA, { lon: 55.2744, lat: 25.1972 }) < 1);
});

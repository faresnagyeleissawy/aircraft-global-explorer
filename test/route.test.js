import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distance,
  bearing,
  parseLatLon,
  parseXY,
  createRoute,
  remaining,
  formatDistance,
  greatCircle,
  placeName,
  shortAddress,
  BURJ_KHALIFA,
} from "../src/route.js";

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

test("parseXY reads longitude and latitude boxes", () => {
  assert.deepEqual(parseXY("55.2744", " 25.1972 "), { lon: 55.2744, lat: 25.1972 });
  assert.equal(parseXY("55.2744", ""), null);
  assert.equal(parseXY("abc", "25"), null);
  assert.equal(parseXY("190", "25"), null);
  assert.equal(parseXY("55", "95"), null);
});

test("remaining distance shrinks as you follow the route", () => {
  const route = createRoute([A, north(500), north(1000)]);
  assert.ok(Math.abs(route.length - 1000) < 1);
  assert.ok(Math.abs(remaining(route, A) - 1000) < 1);
  assert.ok(Math.abs(remaining(route, north(500)) - 500) < 1);
  assert.ok(remaining(route, north(1000)) < 1);
});

test("greatCircle joins two points along the shortest path", () => {
  const dubai = { lon: 55.36, lat: 25.25 };
  const london = { lon: -0.45, lat: 51.47 };
  const line = greatCircle(dubai, london, 50);
  assert.equal(line.length, 51);
  assert.ok(distance(line[0], dubai) < 1 && distance(line[50], london) < 1, "ends where asked");
  assert.ok(Math.abs(createRoute(line).length - distance(dubai, london)) < 1000, "as long as the direct distance");
  // Flights between them arc north of the straight line on a flat map.
  assert.ok(line[25].lat > (dubai.lat + london.lat) / 2);
  const mid = greatCircle({ lon: 0, lat: 0 }, { lon: 90, lat: 0 }, 2)[1];
  assert.ok(Math.abs(mid.lon - 45) < 1e-9 && Math.abs(mid.lat) < 1e-9);
});

test("formatDistance switches from meters to kilometers", () => {
  assert.equal(formatDistance(234), "230 m");
  assert.equal(formatDistance(2340), "2.3 km");
});

test("placeName builds a one-line name without repeats", () => {
  assert.equal(
    placeName({ name: "Dubai Mall", street: "Financial Center Street", city: "Dubai", state: "Dubai", country: "United Arab Emirates" }),
    "Dubai Mall, Financial Center Street, Dubai, United Arab Emirates"
  );
  assert.equal(placeName({ housenumber: "10", street: "Downing Street", city: "London", country: "United Kingdom" }), "10 Downing Street, London, United Kingdom");
  assert.equal(placeName({ name: "Paris", country: "France" }), "Paris, France");
});

test("shortAddress keeps the first parts of a long address", () => {
  assert.equal(shortAddress("A, B, C, D, E"), "A, B, C");
  assert.equal(shortAddress("A, B"), "A, B");
});

test("Burj Khalifa is in downtown Dubai", () => {
  assert.ok(distance(BURJ_KHALIFA, { lon: 55.2744, lat: 25.1972 }) < 1);
});

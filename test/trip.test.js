import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, greatCircle } from "../src/route.js";
import {
  createTrip,
  tripHeight,
  tripState,
  nearestFlown,
  formatDuration,
  findAirport,
  suggestAirports,
} from "../src/trip.js";

const DXB = { lon: 55.371, lat: 25.2498 };
const LHR = { lon: -0.4599, lat: 51.4707 };
const AIRPORTS = [
  ["DXB", "Dubai International Airport", "Dubai", "AE", 25.2498, 55.371],
  ["DWC", "Al Maktoum International Airport", "Dubai", "AE", 24.8964, 55.1614],
  ["LHR", "London Heathrow Airport", "London", "GB", 51.4707, -0.4599],
  ["LGW", "London Gatwick Airport", "London", "GB", 51.1481, -0.1903],
];

const longTrip = () => createTrip(greatCircle(DXB, LHR, 200), -30, 70, DXB, LHR);

test("a long trip climbs to cruising height and comes down at the other end", () => {
  const trip = longTrip();
  assert.ok(Math.abs(trip.length - distance(DXB, LHR)) < 2000);
  assert.equal(tripHeight(trip, 0), -30 + 600);
  assert.equal(tripHeight(trip, trip.length), 70 + 600);
  const middle = tripHeight(trip, trip.length / 2);
  assert.ok(middle > 10000 && middle < 11200, "cruising in the middle: " + middle);
  assert.ok(tripHeight(trip, 50000) > tripHeight(trip, 10000), "climbing after take-off");
  assert.ok(tripHeight(trip, trip.length - 50000) > tripHeight(trip, trip.length - 10000), "descending before landing");
});

test("a short hop stays low", () => {
  const near = { lon: 55.5, lat: 25.3 };
  const trip = createTrip(greatCircle(DXB, near, 5), 0, 0, DXB, near);
  assert.ok(trip.cruise < 1500);
  assert.ok(tripHeight(trip, trip.length / 2) <= trip.cruise);
});

test("tripState follows the line from start to destination", () => {
  const trip = longTrip();
  const start = tripState(trip, 0);
  assert.ok(distance(start, DXB) < 1);
  assert.ok(start.heading > 5 && start.heading < 2 * Math.PI, "heads north-west from Dubai: " + start.heading);
  assert.ok(start.pitch > 0, "nose up while climbing");

  const half = tripState(trip, trip.length / 2);
  assert.ok(Math.abs(distance(half, DXB) - trip.length / 2) < 5000, "half way is half the distance");
  assert.ok(Math.abs(half.pitch) < 1e-3, "level in the cruise");

  const end = tripState(trip, trip.length + 5000);
  assert.ok(distance(end, LHR) < 1, "does not overshoot");
});

test("tripState crosses longitude 180 the short way", () => {
  const fiji = { lon: 177.4, lat: -17.8 };
  const samoa = { lon: -172.0, lat: -13.8 };
  const trip = createTrip(greatCircle(fiji, samoa, 4), 0, 0, fiji, samoa);
  const half = tripState(trip, trip.length / 2);
  assert.ok(Math.abs(half.lon) > 177, "stays near the date line: " + half.lon);
});

test("nearestFlown finds where to rejoin the line", () => {
  const trip = longTrip();
  const there = tripState(trip, 2000000);
  assert.ok(Math.abs(nearestFlown(trip, there) - 2000000) < 30000);
});

test("formatDuration", () => {
  assert.equal(formatDuration(12 * 60), "12 min");
  assert.equal(formatDuration(3 * 3600 + 5 * 60), "3 h 05 min");
});

test("airports are found by code and suggested by code, city or name", () => {
  assert.equal(findAirport(AIRPORTS, " dxb ").name, "DXB – Dubai International Airport, Dubai");
  assert.equal(findAirport(AIRPORTS, "Dubai"), null);
  assert.equal(findAirport(AIRPORTS, "XXX"), null);
  assert.deepEqual(suggestAirports(AIRPORTS, "l").length, 0);
  assert.deepEqual(suggestAirports(AIRPORTS, "LH").map((a) => a.code), ["LHR"]);
  assert.deepEqual(suggestAirports(AIRPORTS, "london").map((a) => a.code), ["LHR", "LGW"]);
  assert.deepEqual(suggestAirports(AIRPORTS, "maktoum").map((a) => a.code), ["DWC"]);
});

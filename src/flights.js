// Live air traffic: real aircraft near the player, drawn as planes that keep
// moving between position reports. Reports come every few seconds from the
// relay in server.js (the flight-data service cannot be called from a web
// page directly), so this only works when the game is run with that server.

import { offset } from "./physics.js";

const POLL_MS = 10000;
const RADIUS_NM = 100; // nautical miles around the player
const MAX_AIRCRAFT = 150;
const STALE_MS = 60000; // an aircraft not heard from for this long is removed
const FEET = 0.3048;
const KNOTS = 0.514444; // meters per second
const MODEL_WITHIN = 40000; // meters: a 3D model up close, a dot beyond

const rad = (deg) => (deg * Math.PI) / 180;

// One line about an aircraft for its label: "UAE203  B77W".
function title(a) {
  return [(a.flight || a.r || a.hex || "").trim(), a.t].filter(Boolean).join("  ");
}

export function createFlights(Cesium, viewer, url) {
  const craft = new Map(); // hex code -> { entity, lon, lat, height, speed, heading, grounded, seen, info }
  const color = Cesium.Color.fromCssColorString("#ffd27a");
  let enabled = true;
  let available = true; // false once the relay turns out to be missing
  let lastPoll = -POLL_MS;
  let busy = false;

  function place(c, now) {
    // Carry on along the last known course until the next report.
    const dt = Math.min(30, (now - c.seen) / 1000);
    const at = offset(c.lon, c.lat, c.speed * dt, c.heading);
    const position = Cesium.Cartesian3.fromRadians(at.lon, at.lat, c.height);
    c.entity.position = position;
    // Model +X is forward; Cesium's model heading 0 points east, ours points north.
    c.entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(c.heading - Math.PI / 2, 0, 0)
    );
  }

  function add(hex) {
    const c = { grounded: false };
    c.entity = viewer.entities.add({
      model: {
        uri: "models/Cesium_Air.glb",
        scale: 3,
        minimumPixelSize: 28,
        color,
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.6,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, MODEL_WITHIN),
      },
      point: {
        pixelSize: 6,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(MODEL_WITHIN, Number.MAX_VALUE),
      },
      label: {
        font: "600 12px sans-serif",
        fillColor: color,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.07, 0.09, 0.11, 0.7),
        pixelOffset: new Cesium.Cartesian2(0, -22),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 120000),
      },
    });
    craft.set(hex, c);
    return c;
  }

  function apply(list, now) {
    for (const a of list.slice(0, MAX_AIRCRAFT)) {
      if (!a.hex || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      const c = craft.get(a.hex) || add(a.hex);
      const feet = Number.isFinite(a.alt_geom) ? a.alt_geom : a.alt_baro;
      const grounded = !Number.isFinite(feet);
      if (grounded !== c.grounded) {
        c.entity.model.heightReference = grounded ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
      }
      c.grounded = grounded;
      c.lon = rad(a.lon);
      c.lat = rad(a.lat);
      c.height = c.grounded ? 0 : feet * FEET;
      c.speed = (Number(a.gs) || 0) * KNOTS;
      c.heading = rad(Number.isFinite(a.track) ? a.track : Number(a.true_heading) || 0);
      c.seen = now;
      c.info = [
        title(a) || "Aircraft",
        c.grounded ? "on the ground" : Math.round(c.height).toLocaleString("en") + " m",
        Math.round(c.speed * 3.6) + " km/h",
      ].join("\n");
      c.entity.label.text = title(a);
      c.entity.show = enabled;
      place(c, now);
    }
    for (const [hex, c] of craft) {
      if (now - c.seen > STALE_MS) {
        viewer.entities.remove(c.entity);
        craft.delete(hex);
      }
    }
  }

  return {
    get available() {
      return available;
    },
    get count() {
      return craft.size;
    },
    get entities() {
      return [...craft.values()].map((c) => c.entity);
    },
    // Text for the label shown when an aircraft is clicked, or "" for any other entity.
    describe(entity) {
      for (const c of craft.values()) if (c.entity === entity) return c.info;
      return "";
    },
    setEnabled(on) {
      enabled = on;
      for (const c of craft.values()) c.entity.show = on;
    },
    // Call every frame with the player's position in degrees. Resolves to true
    // when the set of aircraft may have changed.
    async update(here, now) {
      if (!enabled || !available) return false;
      for (const c of craft.values()) place(c, now);
      if (busy || now - lastPoll < POLL_MS) return false;
      busy = true;
      lastPoll = now;
      try {
        const res = await fetch(url + "?lat=" + here.lat.toFixed(2) + "&lon=" + here.lon.toFixed(2) + "&dist=" + RADIUS_NM);
        // No relay on this host (a plain static site): stop asking.
        if (res.status === 404 || res.status === 405) available = false;
        if (res.ok) apply((await res.json()).ac || [], performance.now());
      } catch {
        // A missed report is harmless: the aircraft keep flying their last course.
      }
      busy = false;
      return true;
    },
  };
}

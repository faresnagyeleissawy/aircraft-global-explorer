import { createState, updaters, offset, WALK } from "./physics.js";
import { PLACES } from "./places.js";
import { createInput } from "./input.js";
import { createFacade } from "./facade.js";
import { BURJ_KHALIFA, bearing, createRoute, distance, formatDistance, parseLatLon, remaining } from "./route.js";

const Cesium = window.Cesium;

const TOKEN_KEY = "dubai3d.ionToken";
const DATA_KEY = "dubai3d.data";
const PLACE_KEY = "dubai3d.place";

// ?offline runs on a plain globe with no Cesium ion data (used for local testing).
const params = new URLSearchParams(window.location.search);
const OFFLINE = params.has("offline");

const MODES = ["walk", "car", "plane"];
const MODE_LABELS = { walk: "Walk", car: "Car", plane: "Plane" };
const PLANE_SPAWN_HEIGHT = 350;
const RESPAWN_DELAY = 2.5;
const ARRIVE_DISTANCE = 25;
// Public OSRM demo server: free, no key, best effort.
const ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
// OpenStreetMap's Nominatim geocoder: free, no key, at most one search a second.
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en";
// Street level in Dubai, in meters above the ellipsoid (sea level is about -32 m there).
const DUBAI_GROUND = -28;
const DUBAI_BOX = "54.85,25.40,55.65,24.75"; // west, north, east, south

const $ = (id) => document.getElementById(id);

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode): settings just won't persist.
  }
}

// ---------------------------------------------------------------- token dialog

function showTokenDialog(message) {
  $("token-dialog").hidden = false;
  $("token-error").textContent = message || "";
  $("token-error").hidden = !message;
  $("token-input").value = storageGet(TOKEN_KEY) || "";
  $("token-input").focus();
}

$("token-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const token = $("token-input").value.trim();
  if (!token) return;
  storageSet(TOKEN_KEY, token);
  window.location.reload();
});

$("change-token").addEventListener("click", () => showTokenDialog());

// ---------------------------------------------------------------- boot

boot();

async function boot() {
  const token = storageGet(TOKEN_KEY);
  if (!token && !OFFLINE) {
    showTokenDialog();
    return;
  }
  if (!OFFLINE) Cesium.Ion.defaultAccessToken = token;
  try {
    await startGame();
  } catch (err) {
    console.error(err);
    showTokenDialog(
      "Could not load the map data. Check that your Cesium ion token is correct and has access to the default assets. (" +
        (err && err.message ? err.message : err) +
        ")"
    );
  }
}

async function startGame() {
  // OSM Buildings is the default: Google's photorealistic tiles have no 3D mesh
  // for Dubai, only satellite photos on flat ground.
  const dataMode = OFFLINE ? "none" : storageGet(DATA_KEY) || "osm";
  $("data-select").value = dataMode === "none" ? "osm" : dataMode;

  const viewerOptions = {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  };
  if (dataMode === "osm") {
    viewerOptions.terrain = Cesium.Terrain.fromWorldTerrain();
  } else {
    viewerOptions.baseLayer = false;
  }

  const viewer = new Cesium.Viewer("cesiumContainer", viewerOptions);
  const scene = viewer.scene;
  const camera = viewer.camera;
  window.viewer = viewer; // handy in the browser console

  scene.screenSpaceCameraController.enableInputs = false;
  camera.frustum.near = 0.2;
  // Midday in Dubai so buildings are lit from above.
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T08:00:00Z");
  viewer.clock.shouldAnimate = false;

  if (dataMode === "google") {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    scene.primitives.add(tileset);
    scene.globe.show = false;
  } else if (dataMode === "osm") {
    const buildings = await Cesium.createOsmBuildingsAsync();
    // OSM Buildings are untextured blocks. Draw windows and glass on them
    // (facade.js), tint each building a little differently, and cast sun
    // shadows so they read as a city.
    const facade = createFacade(Cesium, camera, 55.27, 25.2, DUBAI_GROUND);
    buildings.customShader = facade.shader;
    scene.preRender.addEventListener(facade.update);
    buildings.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ["Number(${feature['cesium#estimatedHeight']}) > 150", "color('#cfe2f5')"],
          ["Number(${feature['cesium#estimatedHeight']}) > 60", "color('#e6eef6')"],
          ["Number(${feature['elementId']}) % 3 === 0", "color('#fff1d6')"],
          ["Number(${feature['elementId']}) % 3 === 1", "color('#f3e3cf')"],
          ["true", "color('#ffffff')"],
        ],
      },
    });
    scene.primitives.add(buildings);
    scene.globe.depthTestAgainstTerrain = true;
    viewer.shadows = true;
    viewer.terrainShadows = Cesium.ShadowMode.RECEIVE_ONLY;
    viewer.shadowMap.maximumDistance = 1500;
    viewer.shadowMap.darkness = 0.45;
  } else {
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9b98f");
  }

  if (!scene.sampleHeightSupported) {
    console.warn("sampleHeight is not supported by this browser; ground following will be approximate.");
  }

  const game = createGame(viewer, dataMode);
  game.start();
}

// ---------------------------------------------------------------- game

function createGame(viewer, dataMode) {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const HPR = Cesium.HeadingPitchRoll;
  const scratchCarto = new Cesium.Cartographic();

  let mode = "plane";
  let view = "chase"; // "chase" or "inside" for car and plane
  let place = PLACES.find((p) => p.id === storageGet(PLACE_KEY)) || PLACES[0];
  let state = createState(0, 0, 0, 0);
  let pendingDrop = false; // waiting for ground data before landing in walk/car mode
  let crashTimer = 0;
  let camHeading = 0;
  let lastTime = performance.now();
  let lastGround; // most recent ground height under the player
  let route = null; // active point-to-point route, see route.js
  let routeEntities = [];
  let flashText = "";
  let flashUntil = 0;

  const input = createInput(onAction);

  // Vehicle models follow the shared state through callbacks.
  const position = new Cesium.CallbackPositionProperty(
    () => Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height),
    false
  );
  const orientationFor = (headingOffset) =>
    new Cesium.CallbackProperty(() => {
      const pos = Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height);
      // Model +X is forward; Cesium's model heading 0 points east, ours points north.
      return Cesium.Transforms.headingPitchRollQuaternion(
        pos,
        new HPR(state.heading - Math.PI / 2 + headingOffset, state.pitch, state.roll)
      );
    }, false);

  const car = viewer.entities.add({
    position,
    orientation: orientationFor(0),
    model: { uri: "models/CesiumMilkTruck.glb", scale: 1.0 },
    show: false,
  });
  const plane = viewer.entities.add({
    position,
    orientation: orientationFor(0),
    model: { uri: "models/Cesium_Air.glb", scale: 1.5 },
    show: false,
  });
  const exclude = [car, plane];

  // Height of whatever is rendered under (lon, lat): buildings, mesh or terrain.
  function sampleGround(lon, lat) {
    scratchCarto.longitude = lon;
    scratchCarto.latitude = lat;
    scratchCarto.height = 0;
    let h;
    if (scene.sampleHeightSupported) h = scene.sampleHeight(scratchCarto, exclude);
    if (h === undefined && scene.globe.show) h = scene.globe.getHeight(scratchCarto);
    return h;
  }

  // On foot or wheels, treat missing data as flat ground at the current height
  // so the player is never frozen by a tile that has not loaded yet.
  function groundForMode(lon, lat) {
    const h = sampleGround(lon, lat);
    if (h !== undefined) return h;
    return mode === "plane" ? undefined : state.height;
  }

  // ------------------------------------------------------------ search and routes

  const toDeg = Cesium.Math.toDegrees;
  const toRad = Cesium.Math.toRadians;
  const here = () => ({ lon: toDeg(state.lon), lat: toDeg(state.lat) });

  // Addresses come from OpenStreetMap, except on Google's photorealistic
  // tiles, whose terms only allow Google's own geocoder on top of them.
  const googleGeocoder =
    dataMode === "google"
      ? new Cesium.IonGeocoderService({ scene, geocodeProviderType: Cesium.IonGeocodeProviderType.GOOGLE })
      : null;

  async function nominatim(text, area) {
    let rows;
    try {
      const res = await fetch(GEOCODE_URL + area + "&q=" + encodeURIComponent(text.trim()));
      rows = await res.json();
    } catch {
      throw new Error("The address search did not answer. Try again in a moment.");
    }
    return Array.isArray(rows) ? rows[0] : undefined;
  }

  async function findAddress(text) {
    const coords = parseLatLon(text);
    if (coords) return { ...coords, name: text.trim() };
    const known = PLACES.find((p) => p.name.toLowerCase() === text.trim().toLowerCase());
    if (known) return { lon: known.lon, lat: known.lat, name: known.name };
    const missing = new Error('No place found for "' + text.trim() + '".');
    if (googleGeocoder) {
      const query = /dubai|uae|emirates/i.test(text) ? text : text + ", Dubai";
      const results = await googleGeocoder.geocode(query);
      if (!results.length) throw missing;
      const dest = results[0].destination;
      const carto =
        dest instanceof Cesium.Rectangle ? Cesium.Rectangle.center(dest) : Cesium.Cartographic.fromCartesian(dest);
      return { lon: toDeg(carto.longitude), lat: toDeg(carto.latitude), name: results[0].displayName };
    }
    // Look inside Dubai first, then anywhere in the UAE.
    const row =
      (await nominatim(text, "&bounded=1&viewbox=" + DUBAI_BOX)) || (await nominatim(text, "&countrycodes=ae"));
    if (!row) throw missing;
    return { lon: Number(row.lon), lat: Number(row.lat), name: row.display_name.split(",").slice(0, 2).join(",") };
  }

  async function fetchRoute(from, to) {
    const pair = [from, to].map((p) => p.lon.toFixed(6) + "," + p.lat.toFixed(6)).join(";");
    let data;
    try {
      const res = await fetch(ROUTE_URL + pair + "?overview=full&geometries=geojson");
      data = await res.json();
    } catch {
      throw new Error("The route service did not answer. Try again in a moment.");
    }
    if (data.code !== "Ok" || !data.routes || !data.routes.length) {
      throw new Error("No road route found between those points.");
    }
    const points = data.routes[0].geometry.coordinates.map(([lon, lat]) => ({ lon, lat }));
    if (points.length < 2) throw new Error("Those two points are the same place.");
    return points;
  }

  function marker(point, text) {
    return viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromCssColorString("#f0b429"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text,
        font: "600 14px sans-serif",
        showBackground: true,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function showRoute(points) {
    clearRoute();
    route = createRoute(points);
    const line = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(points.flatMap((p) => [p.lon, p.lat])),
        width: 8,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
        material: Cesium.Color.fromCssColorString("#f0b429").withAlpha(0.85),
      },
    });
    routeEntities = [line, marker(points[0], "Start"), marker(points[points.length - 1], "Destination")];
    // The line and markers must not count as ground under the player.
    exclude.push(...routeEntities);
  }

  function clearRoute() {
    for (const e of routeEntities) viewer.entities.remove(e);
    exclude.length -= routeEntities.length;
    routeEntities = [];
    route = null;
  }

  // Runs a search from the panel: shows progress, reports errors, and hands
  // the keyboard back to the game afterwards.
  async function runNav(task) {
    const status = $("nav-status");
    const buttons = $("nav").querySelectorAll("button");
    status.classList.remove("error");
    status.textContent = "Searching…";
    buttons.forEach((b) => (b.disabled = true));
    try {
      status.textContent = await task();
    } catch (err) {
      console.error(err);
      status.classList.add("error");
      status.textContent = err && err.message ? err.message : String(err);
    }
    buttons.forEach((b) => (b.disabled = false));
    if (document.activeElement) document.activeElement.blur();
  }

  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("search-input").value;
    if (!text.trim()) return;
    runNav(async () => {
      const found = await findAddress(text);
      placeAt(found.lon, found.lat, state.heading);
      return "Moved to " + found.name;
    });
  });

  $("route-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fromText = $("route-from").value;
    const toText = $("route-to").value;
    if (!toText.trim()) return;
    runNav(async () => {
      const to = await findAddress(toText);
      const from = fromText.trim() ? await findAddress(fromText) : here();
      const points = await fetchRoute(from, to);
      showRoute(points);
      // With a typed start you are put on the road there, facing along the route.
      if (fromText.trim()) placeAt(points[0].lon, points[0].lat, bearing(points[0], points[1]));
      return "Follow the yellow line: " + formatDistance(route.length) + " to " + to.name;
    });
  });

  $("route-clear").addEventListener("click", (e) => {
    clearRoute();
    $("nav-status").textContent = "";
    e.currentTarget.blur();
  });

  $("fly-burj").addEventListener("click", (e) => {
    flyToBurjKhalifa();
    e.currentTarget.blur();
  });

  // ------------------------------------------------------------ UI wiring

  const placeSelect = $("place-select");
  for (const p of PLACES) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    placeSelect.appendChild(opt);
  }
  placeSelect.value = place.id;
  placeSelect.addEventListener("change", () => {
    place = PLACES.find((p) => p.id === placeSelect.value) || PLACES[0];
    storageSet(PLACE_KEY, place.id);
    spawn();
    placeSelect.blur();
  });

  $("data-select").addEventListener("change", (e) => {
    storageSet(DATA_KEY, e.target.value);
    window.location.reload();
  });

  for (const m of MODES) {
    $("mode-" + m).addEventListener("click", (e) => {
      setMode(m);
      e.currentTarget.blur();
    });
  }
  $("help-toggle").addEventListener("click", (e) => {
    toggleHelp();
    e.currentTarget.blur();
  });

  // Mouse look while walking (click the map to capture the mouse, Esc to release).
  const canvas = scene.canvas;
  canvas.addEventListener("click", () => {
    if (mode === "walk" && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  });
  // Cesium's own handlers try to capture the pointer on every press, which
  // browsers refuse (with a console error) while the mouse is locked.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (document.pointerLockElement === canvas) e.stopPropagation();
    },
    true
  );
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas || mode !== "walk") return;
    state.heading += e.movementX * 0.0025;
    state.lookPitch = Math.max(-1.2, Math.min(1.2, state.lookPitch - e.movementY * 0.0025));
  });

  function toggleHelp() {
    $("help").hidden = !$("help").hidden;
  }

  function onAction(code) {
    if (code === "Digit1") setMode("walk");
    else if (code === "Digit2") setMode("car");
    else if (code === "Digit3") setMode("plane");
    else if (code === "KeyC") setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    else if (code === "KeyV") view = view === "chase" ? "inside" : "chase";
    else if (code === "KeyR") spawn();
    else if (code === "KeyH") toggleHelp();
    else if (code === "KeyB") flyToBurjKhalifa();
  }

  // ------------------------------------------------------------ modes

  function spawn() {
    // Flying from Downtown starts with the tower in front of you.
    if (mode === "plane" && place.id === "downtown") flyToBurjKhalifa();
    else placeAt(place.lon, place.lat, toRad(place.heading));
  }

  // Puts the player above a point (degrees). On foot or wheels they then drop to the ground.
  function placeAt(lon, lat, heading, height = PLANE_SPAWN_HEIGHT) {
    state = createState(toRad(lon), toRad(lat), height, heading);
    camHeading = heading;
    crashTimer = 0;
    lastGround = undefined;
    if (mode === "plane") {
      state.speed = 70;
      pendingDrop = false;
    } else {
      pendingDrop = true;
    }
    showMessage(mode === "plane" ? "" : "Loading the ground…");
  }

  // Starts a flight 3 km south-west of Burj Khalifa, aimed just to the right
  // of the tower so it stays in view as you pass it.
  function flyToBurjKhalifa() {
    if (mode !== "plane") setMode("plane");
    const start = offset(toRad(BURJ_KHALIFA.lon), toRad(BURJ_KHALIFA.lat), 3000, toRad(225));
    placeAt(toDeg(start.lon), toDeg(start.lat), toRad(52), 500);
    flash("Burj Khalifa ahead", 4);
  }

  function setMode(next) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    if (document.pointerLockElement && next !== "walk") document.exitPointerLock();

    state.speed = 0;
    state.vz = 0;
    state.roll = 0;
    state.pitch = 0;
    state.crashed = false;
    crashTimer = 0;

    if (next === "plane") {
      // Take off from wherever you are.
      if (prev !== "plane") state.height += 150;
      state.speed = 70;
      state.throttle = 0.4;
      showMessage("");
    } else if (prev === "plane" || pendingDrop) {
      const g = sampleGround(state.lon, state.lat);
      if (g !== undefined) {
        state.height = g;
        pendingDrop = false;
        showMessage("");
      } else {
        pendingDrop = true;
        showMessage("Loading the ground…");
      }
    }
    camHeading = state.heading;
    updateModeButtons();
  }

  function updateModeButtons() {
    for (const m of MODES) $("mode-" + m).classList.toggle("active", m === mode);
    car.show = mode === "car" && view === "chase";
    plane.show = mode === "plane" && view === "chase";
    $("hud-mode").textContent = MODE_LABELS[mode];
    $("nav").hidden = mode === "plane";
    $("plane-tools").hidden = mode !== "plane";
  }

  // ------------------------------------------------------------ loop

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (pendingDrop) {
      const g = sampleGround(state.lon, state.lat);
      if (g !== undefined) {
        state.height = g;
        pendingDrop = false;
        showMessage("");
      } else {
        hoverCamera();
        updateHud(undefined);
        return;
      }
    }

    if (state.crashed) {
      crashTimer += dt;
      if (crashTimer > RESPAWN_DELAY) {
        const g = sampleGround(state.lon, state.lat);
        state.crashed = false;
        crashTimer = 0;
        state.height = (g !== undefined ? g : state.height) + 200;
        state.speed = 70;
        state.pitch = 0;
        state.roll = 0;
        state.throttle = 0.4;
        showMessage("");
      }
    } else {
      updaters[mode](state, input, dt, groundForMode);
      if (state.crashed) showMessage("Crashed! Respawning…");
    }

    lastGround = sampleGround(state.lon, state.lat);
    updateCamera(dt);
    updateHud(lastGround);
    car.show = mode === "car" && view === "chase";
    plane.show = mode === "plane" && view === "chase";
  }

  function hoverCamera() {
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, PLANE_SPAWN_HEIGHT),
      orientation: { heading: state.heading, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
  }

  function updateCamera(dt) {
    if (mode === "walk") {
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + WALK.eyeHeight),
        orientation: { heading: state.heading, pitch: state.lookPitch, roll: 0 },
      });
      return;
    }

    if (view === "inside") {
      const eye = mode === "car" ? 2.2 : 1.2;
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + eye),
        orientation: { heading: state.heading, pitch: state.pitch, roll: mode === "plane" ? state.roll : 0 },
      });
      return;
    }

    // Chase camera: trails behind the vehicle and swings round smoothly on turns.
    let diff = state.heading - camHeading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    camHeading += diff * Math.min(1, dt * (mode === "car" ? 4 : 2.5));

    const range = mode === "car" ? 14 : 45;
    const pitch = mode === "car" ? -0.22 : -0.18;
    const lift = mode === "car" ? 1.5 : 0;
    const target = Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + lift);
    camera.lookAt(target, new Cesium.HeadingPitchRange(camHeading, pitch, range));
  }

  // ------------------------------------------------------------ HUD

  // Shows a message for a few seconds, unless something more urgent replaces it.
  function flash(text, seconds) {
    flashText = text;
    flashUntil = performance.now() + seconds * 1000;
  }

  // Distance and direction (relative to where you face) to a point in degrees.
  function pointer(label, target, meters) {
    const turn = bearing(here(), target) - state.heading;
    const arrow = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][((Math.round(turn / (Math.PI / 4)) % 8) + 8) % 8];
    return label + " " + arrow + " " + formatDistance(meters);
  }

  function updateTarget() {
    if (mode === "plane") {
      $("hud-target").textContent = pointer(BURJ_KHALIFA.name, BURJ_KHALIFA, distance(here(), BURJ_KHALIFA));
      return;
    }
    if (!route) {
      $("hud-target").textContent = "";
      return;
    }
    const left = remaining(route, here());
    const next = route.points[Math.min(route.index + 1, route.points.length - 1)];
    $("hud-target").textContent = pointer("Destination", next, left);
    if (left < ARRIVE_DISTANCE) {
      clearRoute();
      $("nav-status").textContent = "";
      flash("You have arrived", 4);
    }
  }

  function showMessage(text) {
    $("hud-message").textContent = text;
    $("hud-message").hidden = !text;
  }

  function updateHud(ground) {
    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    $("hud-speed").textContent = kmh + " km/h";
    const agl = ground !== undefined ? Math.max(0, Math.round(state.height - ground)) : null;
    $("hud-alt").textContent = mode === "plane" ? (agl !== null ? agl + " m above ground" : "—") : "";
    $("hud-throttle").textContent = mode === "plane" ? "Throttle " + Math.round(state.throttle * 100) + "%" : "";
    const deg = Math.round(Cesium.Math.toDegrees(state.heading) + 360) % 360;
    $("hud-heading").textContent = deg + "° " + compass(deg);
    updateTarget();
    if (!state.crashed && !pendingDrop) {
      showMessage(state.blocked ? "Blocked" : performance.now() < flashUntil ? flashText : "");
    }
  }

  function compass(deg) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  }

  return {
    start() {
      updateModeButtons();
      spawn();
      scene.postRender.addEventListener(tick);
      // Exposed for automated tests and debugging.
      window.game = {
        get state() {
          return state;
        },
        get mode() {
          return mode;
        },
        setMode,
        spawn,
      };
    },
  };
}

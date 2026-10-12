import { createState, updaters, WALK } from "./physics.js";
import { PLACES } from "./places.js";
import { createInput } from "./input.js";

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
  const dataMode = OFFLINE ? "none" : storageGet(DATA_KEY) || "google";
  $("data-select").value = dataMode === "none" ? "google" : dataMode;

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
    scene.primitives.add(buildings);
    scene.globe.depthTestAgainstTerrain = true;
  } else {
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9b98f");
  }

  if (!scene.sampleHeightSupported) {
    console.warn("sampleHeight is not supported by this browser; ground following will be approximate.");
  }

  const game = createGame(viewer);
  game.start();
}

// ---------------------------------------------------------------- game

function createGame(viewer) {
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
  }

  // ------------------------------------------------------------ modes

  function spawn() {
    const heading = Cesium.Math.toRadians(place.heading);
    state = createState(Cesium.Math.toRadians(place.lon), Cesium.Math.toRadians(place.lat), PLANE_SPAWN_HEIGHT, heading);
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
    if (!state.crashed && !pendingDrop) {
      $("hud-message").hidden = !state.blocked;
      if (state.blocked) $("hud-message").textContent = "Blocked";
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

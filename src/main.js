import { createState, updaters, offset } from "./physics.js";
import { PLACES } from "./places.js";
import { createInput } from "./input.js";
import { createFacade } from "./facade.js";
import { labelBuildings } from "./labels.js";
import { attachSuggest } from "./suggest.js";
import {
  BURJ_KHALIFA,
  bearing,
  createRoute,
  distance,
  formatDistance,
  parseLatLon,
  placeName,
  remaining,
  shortAddress,
} from "./route.js";

const Cesium = window.Cesium;

const TOKEN_KEY = "dubai3d.ionToken";
const DATA_KEY = "dubai3d.data";
const PLACE_KEY = "dubai3d.place";

// ?offline runs on a plain globe with no Cesium ion data (used for local testing).
const params = new URLSearchParams(window.location.search);
const OFFLINE = params.has("offline");

const MODES = ["car", "drone", "plane"];
const MODE_LABELS = { car: "Car", drone: "Drone", plane: "Plane" };
const PLANE_SPAWN_HEIGHT = 350;
const DRONE_SPAWN_HEIGHT = 60;
// Chase camera: distance behind each vehicle and how far down it looks (radians).
const CHASE = {
  car: { range: 14, pitch: -0.22, lift: 1.5 },
  drone: { range: 9, pitch: -0.35, lift: 0 },
  plane: { range: 45, pitch: -0.18, lift: 0 },
};
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 40;
const RESPAWN_DELAY = 2.5;
const ARRIVE_DISTANCE = 25;
const MAX_ROUTE_LENGTH = 300000; // longer lines are too heavy to drape on the ground
const REANCHOR_DISTANCE = 15000;
const MAX_DROP = 400;
// Public OSRM demo server: free, no key, best effort.
const ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
const NEAREST_ROAD_URL = "https://router.project-osrm.org/nearest/v1/driving/";
const MAX_SNAP = 500; // a car is moved onto a road only if one is this close, in meters
// OpenStreetMap's Nominatim geocoder: free, no key, at most one search a second.
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en";
// Photon, another free OpenStreetMap geocoder, is built for search-as-you-type
// (Nominatim's rules do not allow that use).
const SUGGEST_URL = "https://photon.komoot.io/api/?limit=6&lang=en";
const INFO_SECONDS = 12;
// Street level in Dubai, in meters above the ellipsoid (sea level is about -32 m there).
const DUBAI_GROUND = -28;

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
  // OSM Buildings is the default because it has buildings everywhere. Google's
  // photorealistic tiles only have a 3D mesh in some cities (not Dubai, for one).
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
  // World terrain is drawn only under the OSM buildings, but it is also asked
  // for the ground height of a place before the player is sent there.
  const terrainReady = OFFLINE ? null : Cesium.createWorldTerrainAsync();
  if (dataMode === "osm") {
    viewerOptions.terrain = new Cesium.Terrain(terrainReady);
  } else {
    viewerOptions.baseLayer = false;
  }

  const viewer = new Cesium.Viewer("cesiumContainer", viewerOptions);
  const scene = viewer.scene;
  const camera = viewer.camera;
  window.viewer = viewer; // handy in the browser console

  scene.screenSpaceCameraController.enableInputs = false;
  camera.frustum.near = 0.2;
  viewer.clock.shouldAnimate = false;
  let facade = null;

  if (dataMode === "google") {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    scene.primitives.add(tileset);
    scene.globe.show = false;
  } else if (dataMode === "osm") {
    const buildings = await Cesium.createOsmBuildingsAsync();
    // OSM Buildings are untextured blocks. Draw windows and glass on them
    // (facade.js), tint each building a little differently, and cast sun
    // shadows so they read as a city.
    facade = createFacade(Cesium, camera, 55.27, 25.2, DUBAI_GROUND);
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
    labelBuildings(Cesium, scene, buildings, describeBuilding);
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

  const game = createGame(viewer, dataMode, { facade, terrain: terrainReady ? await terrainReady : null });
  game.start();
}

// ---------------------------------------------------------------- buildings

// Name and street address of an OSM building, as far as OpenStreetMap has them.
function buildingText(feature) {
  const address = [feature.getProperty("addr:housenumber"), feature.getProperty("addr:street")].filter(Boolean).join(" ");
  return [feature.getProperty("name"), address].filter(Boolean).join("\n");
}

// What labels.js needs to label an OSM building, or null for one with no name or address.
function describeBuilding(feature) {
  const text = buildingText(feature);
  const lon = Number(feature.getProperty("cesium#longitude"));
  const lat = Number(feature.getProperty("cesium#latitude"));
  if (!text || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { text, lon, lat, height: Number(feature.getProperty("cesium#estimatedHeight")) || 10 };
}

// ---------------------------------------------------------------- game

// world.facade is the building shader (OSM mode only) and world.terrain a
// terrain provider for height lookups; either can be null.
function createGame(viewer, dataMode, world) {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const HPR = Cesium.HeadingPitchRoll;
  const scratchCarto = new Cesium.Cartographic();

  let mode = "plane";
  let view = "chase"; // "chase" or "inside" for car and plane
  let place = PLACES.find((p) => p.id === storageGet(PLACE_KEY)) || PLACES[0];
  let state = createState(0, 0, 0, 0);
  let pendingDrop = false; // waiting for ground data before landing in car mode
  let zoom = 1; // mouse wheel: multiplies the chase camera distance
  let crashTimer = 0;
  let camHeading = 0;
  let lastTime = performance.now();
  let lastGround; // most recent ground height under the player
  let route = null; // active point-to-point route, see route.js
  let routeEntities = [];
  let info = null; // label left by the last click on the map
  let infoTimer = 0;
  let flashText = "";
  let flashUntil = 0;
  let reanchoring = false;
  let placed = false; // false until the first start point has been reached
  let anchor = { lon: 0, lat: 0, ground: 0 }; // where the sun and the building shader were last set up

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
  const drone = viewer.entities.add({
    position,
    orientation: orientationFor(0),
    box: {
      dimensions: new Cesium.Cartesian3(1.4, 1.4, 0.3),
      material: Cesium.Color.fromCssColorString("#20252c"),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#f0b429"),
    },
    show: false,
  });
  const models = { car, drone, plane };
  const exclude = [];

  // Our own models, lines and labels must not count as ground under the player.
  function refreshExclude() {
    exclude.length = 0;
    exclude.push(car, drone, plane, ...routeEntities);
    if (info) exclude.push(info);
  }
  refreshExclude();

  // Height of whatever is rendered under (lon, lat): buildings, mesh or terrain.
  function sampleGround(lon, lat) {
    scratchCarto.longitude = lon;
    scratchCarto.latitude = lat;
    scratchCarto.height = 0;
    let h;
    if (scene.sampleHeightSupported) h = scene.sampleHeight(scratchCarto, exclude);
    if (h === undefined && scene.globe.show) h = scene.globe.getHeight(scratchCarto);
    // While an area is still loading, its coarse stand-in surface can be
    // kilometers below the real one; nothing real is that far under the
    // local ground level.
    if (h !== undefined && h < anchor.ground - MAX_DROP) h = undefined;
    return h;
  }

  // On wheels, treat missing data as flat ground at the current height so the
  // car is never frozen by a tile that has not loaded yet.
  function groundForMode(lon, lat) {
    const h = sampleGround(lon, lat);
    if (h !== undefined) return h;
    return mode === "car" ? state.height : undefined;
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

  async function nominatim(text) {
    let rows;
    try {
      const res = await fetch(GEOCODE_URL + "&q=" + encodeURIComponent(text.trim()));
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
      const results = await googleGeocoder.geocode(text.trim());
      if (!results.length) throw missing;
      return fromGoogle(results[0]);
    }
    // Anywhere in the world: the best-known match wins, as on a map site.
    const row = await nominatim(text);
    if (!row) throw missing;
    const parts = row.display_name.split(", ");
    const name = parts.length > 3 ? [parts[0], parts[1], parts[parts.length - 1]].join(", ") : row.display_name;
    return { lon: Number(row.lon), lat: Number(row.lat), name };
  }

  function fromGoogle(result) {
    const dest = result.destination;
    const carto =
      dest instanceof Cesium.Rectangle ? Cesium.Rectangle.center(dest) : Cesium.Cartographic.fromCartesian(dest);
    return { lon: toDeg(carto.longitude), lat: toDeg(carto.latitude), name: result.displayName };
  }

  // Places matching what has been typed so far, for the list under a search box.
  async function suggestPlaces(text) {
    if (googleGeocoder) {
      const results = await googleGeocoder.geocode(text, Cesium.GeocodeType.AUTOCOMPLETE);
      return results.filter((r) => r.destination).slice(0, 6).map(fromGoogle);
    }
    const h = here();
    const near = "&lat=" + h.lat.toFixed(3) + "&lon=" + h.lon.toFixed(3);
    const res = await fetch(SUGGEST_URL + near + "&q=" + encodeURIComponent(text));
    const data = await res.json();
    return (data.features || [])
      .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: placeName(f.properties) }))
      .filter((place, i, all) => place.name && all.findIndex((other) => other.name === place.name) === i);
  }

  // Address of a point in degrees, or "" when it has none or cannot be looked up.
  async function reverseGeocode(lon, lat) {
    try {
      const res = await fetch(REVERSE_URL + "&lat=" + lat.toFixed(6) + "&lon=" + lon.toFixed(6));
      const data = await res.json();
      return data.display_name ? shortAddress(data.display_name) : "";
    } catch {
      return "";
    }
  }

  // The closest point on a road, or the point itself when no road is near.
  async function nearestRoad(lon, lat) {
    try {
      const res = await fetch(NEAREST_ROAD_URL + lon.toFixed(6) + "," + lat.toFixed(6));
      const data = await res.json();
      const hit = data.waypoints && data.waypoints[0];
      if (hit && hit.distance < MAX_SNAP) return { lon: hit.location[0], lat: hit.location[1] };
    } catch {
      // Fall through: staying off the road is better than not travelling.
    }
    return { lon, lat };
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
    if (data.routes[0].distance > MAX_ROUTE_LENGTH) {
      throw new Error("That route is " + formatDistance(data.routes[0].distance) + " long. Pick places less than 300 km apart.");
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
    refreshExclude();
  }

  function clearRoute() {
    for (const e of routeEntities) viewer.entities.remove(e);
    routeEntities = [];
    route = null;
    refreshExclude();
  }

  // Pins a label to a spot on the map for a few seconds.
  function showInfo(spot, text) {
    clearInfo();
    info = viewer.entities.add({
      position: spot,
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString("#f0b429"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text,
        font: "600 14px sans-serif",
        showBackground: true,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    refreshExclude();
    infoTimer = setTimeout(clearInfo, INFO_SECONDS * 1000);
  }

  function clearInfo() {
    clearTimeout(infoTimer);
    if (info) viewer.entities.remove(info);
    info = null;
    refreshExclude();
  }

  // Each search box offers a list of matching places while you type. A place
  // picked from the list is remembered, so it is used as it is rather than
  // searched for again.
  const picked = new Map();
  const suggest = {};
  for (const id of ["search-input", "route-from", "route-to"]) {
    suggest[id] = attachSuggest($(id), suggestPlaces, (place) => {
      picked.set(id, place);
      if (id === "search-input") $("search-form").requestSubmit();
    });
  }

  function resolvePlace(id) {
    suggest[id].cancel();
    const place = picked.get(id);
    return place && place.name === $(id).value ? Promise.resolve(place) : findAddress($(id).value);
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
      const found = await resolvePlace("search-input");
      await travelTo(found.lon, found.lat, state.heading);
      return "Moved to " + found.name;
    });
  });

  $("route-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fromText = $("route-from").value;
    const toText = $("route-to").value;
    if (!toText.trim()) return;
    runNav(async () => {
      const to = await resolvePlace("route-to");
      const from = fromText.trim() ? await resolvePlace("route-from") : here();
      const points = await fetchRoute(from, to);
      showRoute(points);
      // A car always starts exactly on the first point of the line, facing
      // along it. Flying, you are only moved when you typed a start.
      if (mode === "car" || fromText.trim()) {
        await travelTo(points[0].lon, points[0].lat, bearing(points[0], points[1]), false);
      }
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

  // Mouse: the wheel zooms the chase camera, a double-click goes to that spot.
  const canvas = scene.canvas;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(e.deltaY * 0.0015)));
      view = "chase";
    },
    { passive: false }
  );
  // Cesium's own double-click would lock the camera onto the clicked vehicle.
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  function mousePoint(e) {
    const box = canvas.getBoundingClientRect();
    return new Cesium.Cartesian2(e.clientX - box.left, e.clientY - box.top);
  }

  // The point of the scene under a canvas position, if there is one.
  function pickSpot(point) {
    let spot = scene.pickPositionSupported ? scene.pickPosition(point) : undefined;
    const ray = camera.getPickRay(point);
    if (!Cesium.defined(spot) && ray && scene.globe.show) spot = scene.globe.pick(ray, scene);
    return Cesium.defined(spot) && Cesium.Cartographic.fromCartesian(spot) ? spot : undefined;
  }

  // A click labels the building or spot under the mouse with its name and
  // address: from the building's own data if it has any, otherwise looked up.
  async function identify(point) {
    const spot = pickSpot(point);
    if (!spot) return;
    const feature = scene.pick(point);
    let text = feature instanceof Cesium.Cesium3DTileFeature ? buildingText(feature) : "";
    if (!text && !googleGeocoder) {
      const there = Cesium.Cartographic.fromCartesian(spot);
      text = await reverseGeocode(toDeg(there.longitude), toDeg(there.latitude));
    }
    if (text) showInfo(spot, text);
  }

  let clickTimer = 0;
  canvas.addEventListener("click", (e) => {
    const point = mousePoint(e);
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => identify(point), 300); // long enough for a double-click to cancel it
  });
  canvas.addEventListener("dblclick", (e) => {
    clearTimeout(clickTimer);
    const spot = pickSpot(mousePoint(e));
    if (!spot) return;
    const there = Cesium.Cartographic.fromCartesian(spot);
    travelTo(toDeg(there.longitude), toDeg(there.latitude), state.heading);
  });

  function toggleHelp() {
    $("help").hidden = !$("help").hidden;
  }

  function onAction(code) {
    if (code === "Digit1") setMode("car");
    else if (code === "Digit2") setMode("drone");
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
    else travelTo(place.lon, place.lat, toRad(place.heading));
  }

  // Ground height (meters above the ellipsoid) at a point in degrees, or 0 when it cannot be looked up.
  async function terrainHeight(lon, lat) {
    if (!world.terrain) return 0;
    try {
      const [point] = await Cesium.sampleTerrainMostDetailed(world.terrain, [Cesium.Cartographic.fromDegrees(lon, lat)]);
      return point.height || 0;
    } catch {
      return 0;
    }
  }

  // Sends the player to a point anywhere in the world (degrees). A car is put
  // on the nearest road, unless the point is already known to be on one.
  async function travelTo(lon, lat, heading, snapToRoad = true) {
    const spot = snapToRoad && mode === "car" ? await nearestRoad(lon, lat) : { lon, lat };
    placeAt(spot.lon, spot.lat, heading, await terrainHeight(spot.lon, spot.lat));
  }

  // Midday sun wherever the player is, so buildings are lit from above.
  function setSun(lon) {
    const hours = (((12 - lon / 15) % 24) + 24) % 24;
    const midnight = Cesium.JulianDate.fromIso8601("2026-03-20T00:00:00Z");
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(midnight, hours * 3600, midnight);
  }

  // Ties the sun and the building shader to the ground at a point in degrees.
  function setAnchor(lon, lat, ground) {
    anchor = { lon, lat, ground };
    setSun(lon);
    if (world.facade) world.facade.setAnchor(lon, lat, ground);
  }

  // Puts the player `lift` meters above ground level at a point (degrees). A
  // car then drops to the ground.
  function placeAt(lon, lat, heading, ground, lift = mode === "drone" ? DRONE_SPAWN_HEIGHT : PLANE_SPAWN_HEIGHT) {
    state = createState(toRad(lon), toRad(lat), ground + lift, heading);
    setAnchor(lon, lat, ground);
    placed = true;
    camHeading = heading;
    crashTimer = 0;
    lastGround = undefined;
    if (mode === "plane") state.speed = 70;
    pendingDrop = mode === "car";
    showMessage(pendingDrop ? "Loading the ground…" : "");
  }

  // Starts a flight 3 km south-west of Burj Khalifa, aimed just to the right
  // of the tower so it stays in view as you pass it.
  function flyToBurjKhalifa() {
    if (mode !== "plane") setMode("plane");
    const start = offset(toRad(BURJ_KHALIFA.lon), toRad(BURJ_KHALIFA.lat), 3000, toRad(225));
    placeAt(toDeg(start.lon), toDeg(start.lat), toRad(52), DUBAI_GROUND, 530);
    flash("Burj Khalifa ahead", 4);
  }

  function setMode(next) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
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
    } else if (next === "drone") {
      // Lift off from the road; coming from the plane, hover where you are.
      if (prev === "car") state.height += 30;
      pendingDrop = false;
      showMessage("");
    } else {
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
    for (const m of MODES) {
      $("mode-" + m).classList.toggle("active", m === mode);
      models[m].show = m === mode && view === "chase";
    }
    $("hud-mode").textContent = MODE_LABELS[mode];
    $("plane-tools").hidden = mode !== "plane";
  }

  // ------------------------------------------------------------ loop

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (!placed) return;

    // After a long trip, move the sun and the building shader along too.
    if (!reanchoring && distance(here(), anchor) > REANCHOR_DISTANCE) {
      const { lon, lat } = here();
      reanchoring = true;
      terrainHeight(lon, lat).then((ground) => {
        setAnchor(lon, lat, ground);
        reanchoring = false;
      });
    }

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
    for (const m of MODES) models[m].show = m === mode && view === "chase";
  }

  function hoverCamera() {
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height),
      orientation: { heading: state.heading, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
  }

  function updateCamera(dt) {
    if (view === "inside") {
      const eye = mode === "car" ? 2.2 : mode === "plane" ? 1.2 : 0;
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + eye),
        // The drone's camera looks a little down, like a real one.
        orientation: {
          heading: state.heading,
          pitch: mode === "drone" ? -0.3 : state.pitch,
          roll: mode === "plane" ? state.roll : 0,
        },
      });
      return;
    }

    // Chase camera: trails behind the vehicle and swings round smoothly on turns.
    let diff = state.heading - camHeading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    camHeading += diff * Math.min(1, dt * (mode === "car" ? 4 : 2.5));

    // Zooming out also tilts the camera down, towards a map-like view from above.
    const chase = CHASE[mode];
    const pitch = Math.max(-1.3, chase.pitch - Math.max(0, Math.log(zoom)) * 0.3);
    const target = Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + chase.lift);
    camera.lookAt(target, new Cesium.HeadingPitchRange(camHeading, pitch, chase.range * zoom));
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
    if (!route) {
      // In the air over Dubai, point to the tower instead.
      const toTower = distance(here(), BURJ_KHALIFA);
      const show = mode === "plane" && toTower < 50000;
      $("hud-target").textContent = show ? pointer(BURJ_KHALIFA.name, BURJ_KHALIFA, toTower) : "";
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
    $("hud-alt").textContent = mode === "car" ? "" : agl !== null ? agl + " m above ground" : "—";
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

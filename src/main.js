import { createState, updatePlane, offset } from "./physics.js";
import { PLACES } from "./places.js";
import { createInput } from "./input.js";
import { PUBLIC_ION_TOKEN } from "./config.js";
import { createFacade } from "./facade.js";
import { createFlights } from "./flights.js";
import { labelBuildings } from "./labels.js";
import { attachSuggest } from "./suggest.js";
import {
  CRUISE_SPEED,
  MIN_RUNWAY_TRIP,
  createTrip,
  findAirport,
  formatDuration,
  nearestFlown,
  runwayLine,
  suggestAirports,
  tripState,
} from "./trip.js";
import {
  BURJ_KHALIFA,
  bearing,
  createRoute,
  distance,
  formatDistance,
  greatCircle,
  parseLatLon,
  parseXY,
  placeName,
  remaining,
  shortAddress,
} from "./route.js";

const Cesium = window.Cesium;

const TOKEN_KEY = "dubai3d.ionToken";
const DATA_KEY = "dubai3d.data";
const PLACE_KEY = "dubai3d.place";
const QUALITY_KEY = "dubai3d.quality";

// ?offline runs on a plain globe with no Cesium ion data (used for local testing).
const params = new URLSearchParams(window.location.search);
// ?simple does the same but draws the OpenStreetMap street map on the globe,
// for visitors who want to try the game without a Cesium ion token.
const SIMPLE = params.has("simple");
const OFFLINE = SIMPLE || params.has("offline");
const STREET_MAP_URL = "https://tile.openstreetmap.org/";

const PLANE_SPAWN_HEIGHT = 350;
// Chase camera: distance behind the plane and how far down it looks (radians).
const CHASE_RANGE = 45;
const CHASE_PITCH = -0.18;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 40;
const RESPAWN_DELAY = 2.5;
const ARRIVE_DISTANCE = 300;
const AIRPORTS_URL = "data/airports.json";
const RUNWAYS_URL = "data/runways.json";
const RUNWAYS_KEY = "dubai3d.runways";
const LOW = 1500; // meters above the ground: below this the autopilot flies in real time
const HANDS_OFF = 150; // meters above the ground: below this the autopilot keeps the controls
const VIEWS = ["chase", "inside", "left", "right"]; // behind the plane, pilot's seat, window seats
const MAP_HEIGHT = 2500000; // camera height, in meters, when a trip is picked on the map
const MAX_ROUTE_LENGTH = 300000; // longer lines are too heavy to drape on the ground
const REANCHOR_DISTANCE = 15000;
const MAX_DROP = 400;
// Public OSRM demo server: free, no key, best effort.
const ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
// OpenStreetMap's Nominatim geocoder: free, no key, at most one search a second.
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en";
// Photon, another free OpenStreetMap geocoder, is built for search-as-you-type
// (Nominatim's rules do not allow that use).
const SUGGEST_URL = "https://photon.komoot.io/api/?limit=6&lang=en";
const AROUND_URL = "https://photon.komoot.io/reverse?lang=en";
// Live aircraft come through the relay in server.js; a plain static host has none.
const FLIGHTS_URL = "api/flights";
const INFO_SECONDS = 12;
const ADDRESS_EVERY = 4000; // ms between lookups of the address under the plane
const ADDRESS_STEP = 100; // meters the plane must move before the address is looked up again
const BAD_XY = "X must be a longitude from -180 to 180 and Y a latitude from -90 to 90.";
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

$("token-skip").addEventListener("click", () => {
  window.location.search = "?simple";
});

// ---------------------------------------------------------------- boot

boot();

async function boot() {
  // A visitor's own token wins over the one the host put in config.js.
  const token = storageGet(TOKEN_KEY) || PUBLIC_ION_TOKEN;
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

  // "ultra" is for a strong graphics card: see applyUltra below.
  const ultra = storageGet(QUALITY_KEY) === "ultra";
  $("quality-select").value = ultra ? "ultra" : "standard";
  $("quality-select").addEventListener("change", (e) => {
    storageSet(QUALITY_KEY, e.target.value === "ultra" ? "ultra" : null);
    window.location.reload();
  });
  if (ultra) {
    viewerOptions.msaaSamples = 8;
    // More map tiles and buildings in flight at once, so the picture fills in faster.
    Cesium.RequestScheduler.maximumRequestsPerServer = 18;
  }

  const viewer = new Cesium.Viewer("cesiumContainer", viewerOptions);
  $("gpu-note").textContent = graphicsCard(viewer.scene);
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
    if (ultra) applyUltra(viewer, tileset);
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
    if (ultra) applyUltra(viewer, buildings);
  } else {
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9b98f");
    if (SIMPLE) {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({ url: STREET_MAP_URL, maximumLevel: 18 })
      );
      // The other choices in this menu need a token.
      $("data-select").disabled = true;
      $("data-select").title = "3D buildings need a Cesium ion token: use Change token below";
    }
    if (ultra) applyUltra(viewer, null);
  }

  if (!scene.sampleHeightSupported) {
    console.warn("sampleHeight is not supported by this browser; ground following will be approximate.");
  }

  const game = createGame(viewer, dataMode, { facade, terrain: terrainReady ? await terrainReady : null });
  game.start();
}

// ---------------------------------------------------------------- graphics

// Name of the graphics card the browser is drawing with, so the player can
// see whether a laptop is using its fast card or its power-saving one.
function graphicsCard(scene) {
  try {
    const gl = scene.context._gl;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 ... Direct3D11 ...)" -> the card's own name.
    const inner = /^ANGLE \([^,]+, (.+?)(?: \(0x| Direct3D| OpenGL| Vulkan|,|$)/.exec(name);
    return "Drawn by: " + (inner ? inner[1].trim() : name);
  } catch {
    return "";
  }
}

// The best picture Cesium can give, for a strong graphics card: full screen
// resolution, smooth edges, finer buildings and terrain, long soft shadows
// and sunlight on the terrain. (Cesium can also shade corners, but that
// draws stripes across the ground from low down, so it is left off.) tileset is the 3D
// buildings or the photorealistic mesh, or null when there are none.
function applyUltra(viewer, tileset) {
  const scene = viewer.scene;
  viewer.useBrowserRecommendedResolution = false; // every pixel of a high-density screen
  viewer.resolutionScale = 1;
  scene.highDynamicRange = true;
  scene.postProcessStages.fxaa.enabled = true;

  // Lower numbers switch to detailed tiles sooner (defaults: 2 and 16).
  scene.globe.maximumScreenSpaceError = 1.2;
  scene.globe.tileCacheSize = 1500;
  if (tileset) {
    tileset.maximumScreenSpaceError = 6;
    tileset.cacheBytes = 2 * 1024 * 1024 * 1024;
    tileset.maximumCacheOverflowBytes = 1024 * 1024 * 1024;
    tileset.dynamicScreenSpaceError = false;
  }

  if (viewer.shadows) {
    viewer.shadowMap.size = 4096;
    viewer.shadowMap.softShadows = true;
    viewer.shadowMap.maximumDistance = 5000;
  }
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.fog.density = 0.00012;
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

  let view = "chase"; // one of VIEWS
  let airports = []; // rows of data/airports.json, once loaded
  let runways = {}; // data/runways.json, once loaded: airport code -> the two ends of its longest runway
  let demo = null; // while the demo tour plays: { spin, zoomTo, stop }
  let parked = false; // standing on the runway after landing, until an arrow key is pressed
  let trip = null; // the flight being flown from one place to another, see trip.js
  let autopilot = false; // true while the trip flies itself
  let timeScale = 1; // how much faster than real time the autopilot is asked to fly
  let flownScale = 1; // and how fast it is flying right now (real time near the ground)
  let place = PLACES.find((p) => p.id === storageGet(PLACE_KEY)) || PLACES[0];
  let state = createState(0, 0, 0, 0);
  let zoom = 1; // mouse wheel: multiplies the chase camera distance
  let orbit = { heading: 0, pitch: 0 }; // mouse drag: turns and tilts the chase camera (radians)
  let picking = null; // while a trip is being picked on the map: { points, marks }
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
  let addressAt = null; // where the address under the plane was last looked up
  let addressTime = 0;
  let addressBusy = false;
  let placed = false; // false until the first start point has been reached
  let anchor = { lon: 0, lat: 0, ground: 0 }; // where the sun and the building shader were last set up

  const input = createInput(onAction);

  // The plane model follows the shared state through callbacks.
  const position = new Cesium.CallbackPositionProperty(
    () => Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height),
    false
  );
  const orientation = new Cesium.CallbackProperty(() => {
    const pos = Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height);
    // Model +X is forward; Cesium's model heading 0 points east, ours points north.
    return Cesium.Transforms.headingPitchRollQuaternion(pos, new HPR(state.heading - Math.PI / 2, state.pitch, state.roll));
  }, false);

  const plane = viewer.entities.add({
    position,
    orientation,
    model: { uri: "models/Cesium_Air.glb", scale: 1.5 },
    show: false,
  });
  const flights = createFlights(Cesium, viewer, FLIGHTS_URL);
  const exclude = [];

  // Our own models, lines and labels must not count as ground under the player.
  function refreshExclude() {
    exclude.length = 0;
    exclude.push(plane, ...routeEntities, ...flights.entities);
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

  fetch(AIRPORTS_URL)
    .then((res) => res.json())
    .then((rows) => (airports = rows))
    .catch(() => console.warn("Airport codes could not be loaded; places can still be searched by name."));
  fetch(RUNWAYS_URL)
    .then((res) => res.json())
    .then((byCode) => (runways = byCode))
    .catch(() => console.warn("Runways could not be loaded; trips will start and end in the air."));

  // The advanced option, on the start screen and in the panel: one setting, two boxes.
  const runwayBoxes = [$("start-runways"), $("trip-runways")];
  for (const box of runwayBoxes) {
    box.checked = storageGet(RUNWAYS_KEY) === "1";
    box.addEventListener("change", () => {
      for (const other of runwayBoxes) other.checked = box.checked;
      storageSet(RUNWAYS_KEY, box.checked ? "1" : null);
      box.blur();
    });
  }

  async function findAddress(text) {
    const coords = parseLatLon(text);
    if (coords) return { ...coords, name: text.trim() };
    const airport = findAirport(airports, text);
    if (airport) return airport;
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
  // Airports come first, so a code such as DXB is one keystroke from its airport.
  async function suggestPlaces(text) {
    return [...suggestAirports(airports, text), ...(await suggestOther(text))];
  }

  async function suggestOther(text) {
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

  // Nearest named place or address to a point in degrees, or "".
  async function placeAround(lon, lat) {
    try {
      const res = await fetch(AROUND_URL + "&lon=" + lon.toFixed(5) + "&lat=" + lat.toFixed(5));
      const data = await res.json();
      return data.features && data.features.length ? placeName(data.features[0].properties) : "";
    } catch {
      return "";
    }
  }

  // Keeps the "Over: ..." line of the display up to date as the plane moves.
  // Not on Google's tiles, whose terms rule out other geocoders.
  function updateAddress(now) {
    if (googleGeocoder || addressBusy || now - addressTime < ADDRESS_EVERY) return;
    const spot = here();
    if (addressAt && distance(spot, addressAt) < ADDRESS_STEP) return;
    addressBusy = true;
    addressTime = now;
    addressAt = spot;
    placeAround(spot.lon, spot.lat).then((text) => {
      $("hud-address").textContent = text ? "Over: " + text : "";
      addressBusy = false;
    });
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
    trip = null;
    autopilot = false;
    if (parked) {
      // Ending the trip while standing on the runway: back into the air.
      parked = false;
      state.height += 150;
      state.speed = 70;
    }
    updateTripBar();
    refreshExclude();
  }

  // ------------------------------------------------------------ trips

  const shortName = (p) => p.code || (p.name ? p.name.split(",")[0] : "Start");

  // Starts a flight from one place to another along the line a real flight
  // takes, on autopilot: the traveller watches, or takes over with the arrows.
  async function startTrip(from, to) {
    const length = distance(from, to);
    if (length < 2000) throw new Error("Those two places are too close together for a flight.");
    // With the advanced option, and a runway known at both ends, the trip
    // takes off and lands; otherwise it starts and ends in the air.
    const wanted = $("trip-runways").checked;
    const onRunways = wanted && runways[from.code] && runways[to.code] && length > MIN_RUNWAY_TRIP;
    const runway = onRunways ? runwayLine(runways[from.code], runways[to.code]) : null;
    const line = runway ? runway.points : greatCircle(from, to, Math.max(2, Math.min(400, Math.ceil(length / 5000))));
    const first = line[0];
    const last = runway ? line[line.length - 2] : line[line.length - 1];
    const [startGround, endGround] = await Promise.all([terrainHeight(first.lon, first.lat), terrainHeight(last.lon, last.lat)]);
    showRoute(line);
    trip = createTrip(line, startGround, endGround, from, to, runway);
    const start = tripState(trip, 0);
    placeAt(start.lon, start.lat, start.heading, startGround, start.height - startGround);
    state.speed = start.speed;
    autopilot = true;
    parked = false;
    updateTripBar();
    const how = runway ? " (runway to runway)" : wanted ? " (no runway known at both ends, so it starts in the air)" : "";
    return "Trip " + shortName(from) + " → " + shortName(to) + ": " + formatDistance(length) + how;
  }

  // Moves the plane along the trip. Returns false when the trip has just ended.
  function flyTrip(dt) {
    const before = tripState(trip, trip.flown);
    // Take-off and landing are worth watching at their real pace.
    const scale = trip.runways && before.clearance < LOW ? 1 : timeScale;
    flownScale = scale;
    trip.flown = Math.min(trip.length, trip.flown + before.speed * scale * dt);
    const at = tripState(trip, trip.flown);
    state.lon = toRad(at.lon);
    state.lat = toRad(at.lat);
    state.height = at.height;
    state.pitch = at.pitch;
    state.speed = at.speed;
    // The line has corners where it leaves and joins the runways: bank round
    // them in the air, but stay straight on the ground.
    const swing = Math.atan2(Math.sin(at.heading - state.heading), Math.cos(at.heading - state.heading));
    const eased = at.clearance > 0 ? swing * Math.min(1, dt * scale * 0.6) : swing;
    state.heading += eased;
    state.roll = at.clearance > 0 ? Math.max(-0.5, Math.min(0.5, (swing - eased) * 1.5)) : 0;
    return trip.flown < trip.length;
  }

  function setAutopilot(on) {
    if (!trip || on === autopilot) return;
    autopilot = on;
    if (on) {
      // Rejoin the line at the point nearest to where the plane is now.
      trip.flown = nearestFlown(trip, here());
      trip.arrived = false;
      parked = false;
      state.crashed = false;
      crashTimer = 0;
    } else {
      // Hand over in level flight at a speed the plane can keep.
      state.pitch = 0;
      state.speed = 150;
      state.throttle = 0.7;
      flash("You have the controls. Press A for the autopilot.", 4);
    }
    updateTripBar();
  }

  function updateTripBar() {
    $("trip-bar").hidden = !trip;
    if (!trip) return;
    const left = trip.arrived ? 0 : autopilot ? trip.length - trip.flown : distance(here(), trip.to);
    const done = Math.max(0, Math.min(1, 1 - left / trip.length));
    $("trip-title").textContent = shortName(trip.from) + " → " + shortName(trip.to);
    $("trip-progress").value = done;
    $("trip-text").textContent =
      trip.arrived
        ? trip.runways
          ? "Landed"
          : "Arrived"
        : Math.round(done * 100) + "% · " + formatDistance(left) + " left · " + formatDuration(left / CRUISE_SPEED) + " of flying";
    $("trip-autopilot").textContent = autopilot ? "Autopilot: on" : "Autopilot: off";
    $("trip-autopilot").classList.toggle("active", autopilot);
  }

  $("trip-autopilot").addEventListener("click", (e) => {
    setAutopilot(!autopilot);
    e.currentTarget.blur();
  });
  $("trip-speed").addEventListener("change", (e) => {
    timeScale = Number(e.target.value) || 1;
    e.target.blur();
  });
  $("trip-end").addEventListener("click", (e) => {
    clearRoute();
    $("nav-status").textContent = "";
    e.currentTarget.blur();
  });

  function setView(next) {
    view = next;
    orbit = { heading: 0, pitch: 0 };
    $("view-select").value = view;
    $("window-frame").hidden = view !== "left" && view !== "right";
  }
  $("view-select").addEventListener("change", (e) => {
    setView(e.target.value);
    e.target.blur();
  });

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
  for (const id of ["search-input", "route-from", "route-to", "start-search", "start-from", "start-to"]) {
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
      const from = fromText.trim() ? await resolvePlace("route-from") : { ...here(), name: "Here" };
      // Between airports it is a flight; between other places, the road.
      if (from.airport || to.airport) return startTrip(from, to);
      const points = await fetchRoute(from, to);
      showRoute(points);
      // With a typed start you are taken there, heading along the route.
      if (fromText.trim()) await travelTo(points[0].lon, points[0].lat, bearing(points[0], points[1]));
      return "Follow the yellow line: " + formatDistance(route.length) + " to " + to.name;
    });
  });

  $("xy-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runNav(async () => {
      const spot = parseXY($("xy-x").value, $("xy-y").value);
      if (!spot) throw new Error(BAD_XY);
      await travelTo(spot.lon, spot.lat, state.heading);
      return "Moved to X " + spot.lon + ", Y " + spot.lat;
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

  // ------------------------------------------------------------ demo tour

  // A scripted tour of the main features with captions, made to be recorded
  // as a video. Esc stops it.
  function caption(text) {
    $("demo-caption").textContent = text;
    $("demo-caption").hidden = !text;
  }

  // Waits, unless the tour is stopped meanwhile.
  function pause(seconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, seconds * 1000);
      demo.stop = () => {
        clearTimeout(timer);
        reject(new Error("demo stopped"));
      };
    });
  }

  async function typeInto(id, text) {
    $(id).value = "";
    for (const letter of text) {
      $(id).value += letter;
      await pause(0.07);
    }
  }

  async function runDemo() {
    if (demo) return;
    demo = { spin: 0, zoomTo: 1, stop: null };
    $("start-dialog").hidden = true;
    $("help").hidden = true;
    try {
      caption("Aircraft Global Explorer: fly anywhere on Earth");
      clearRoute();
      setView("chase");
      flyToBurjKhalifa();
      await pause(7);

      caption("Every building in the world, in 3D");
      demo.spin = 0.3;
      demo.zoomTo = 3;
      await pause(11);
      demo.spin = 0;
      demo.zoomTo = 1;
      orbit = { heading: 0, pitch: 0 };

      caption("Search for any address");
      await typeInto("search-input", "Eiffel Tower, Paris");
      await pause(0.6);
      await travelTo(2.2885, 48.846, toRad(25));
      $("nav-status").textContent = "Moved to Eiffel Tower, Paris, France";
      await pause(9);

      caption("Take a window seat");
      setView("right");
      await pause(6);
      caption("Or the pilot's seat");
      setView("inside");
      await pause(4);
      setView("chase");

      if (flights.available && $("flights-toggle").checked) {
        caption("Real flights around you, live");
        await travelTo(-0.3, 51.44, toRad(290));
        demo.zoomTo = 5;
        await pause(10);
        demo.zoomTo = 1;
      }

      const from = findAirport(airports, "DXB");
      const to = findAirport(airports, "AUH");
      if (from && to) {
        caption("Fly a real trip: Dubai to Abu Dhabi, runway to runway");
        for (const box of runwayBoxes) box.checked = true;
        $("search-input").value = "";
        await typeInto("route-from", "DXB");
        await typeInto("route-to", "AUH");
        $("nav-status").textContent = await startTrip(from, to);
        await pause(20);
        caption("Take-off from Dubai International");
        await pause(33);
        setView("left");
        await pause(11);

        caption("Landing at Abu Dhabi");
        setView("chase");
        trip.flown = trip.touchdown - 3000;
        state.heading = tripState(trip, trip.flown).heading;
        await pause(58);
      }

      caption("Try it: faresnagyeleissawy.github.io/aircraft-global-explorer");
      await pause(6);
    } catch (err) {
      if (!err || err.message !== "demo stopped") console.error(err);
    }
    caption("");
    demo = null;
    orbit = { heading: 0, pitch: 0 };
    zoom = 1;
    setView("chase");
  }

  for (const id of ["start-demo", "play-demo"]) {
    $(id).addEventListener("click", (e) => {
      runDemo();
      e.currentTarget.blur();
    });
  }

  // ------------------------------------------------------------ trip on the map

  // The flight stops and the map takes over: Cesium's own mouse controls move
  // it, and two clicks set where the trip starts and ends.
  function startPicking() {
    $("start-dialog").hidden = true;
    picking = { points: [], marks: [] };
    plane.show = false;
    showMessage("");
    const centre = placed ? here() : place;
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    camera.setView({ destination: Cesium.Cartesian3.fromDegrees(centre.lon, centre.lat, MAP_HEIGHT) });
    scene.screenSpaceCameraController.enableInputs = true;
    updatePickBar();
  }

  function clearPickMarks() {
    for (const mark of picking.marks) viewer.entities.remove(mark);
    picking.points = [];
    picking.marks = [];
  }

  function pickPoint(point) {
    if (picking.points.length === 2) return;
    const spot = pickSpot(point) || camera.pickEllipsoid(point);
    if (!Cesium.defined(spot)) return;
    const there = Cesium.Cartographic.fromCartesian(spot);
    const chosen = { lon: toDeg(there.longitude), lat: toDeg(there.latitude) };
    picking.points.push(chosen);
    picking.marks.push(marker(chosen, picking.points.length === 1 ? "Start" : "Destination"));
    if (picking.points.length === 2) {
      const [a, b] = picking.points;
      picking.marks.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([a.lon, a.lat, b.lon, b.lat]),
            width: 4,
            clampToGround: true,
            material: Cesium.Color.fromCssColorString("#f0b429"),
          },
        })
      );
    }
    updatePickBar();
  }

  function updatePickBar() {
    const count = picking ? picking.points.length : 0;
    $("pick-bar").hidden = !picking;
    $("pick-go").disabled = count < 2;
    $("pick-again").disabled = count === 0;
    $("pick-text").textContent =
      count === 0
        ? "Click the map where your trip starts. Drag to move the map, use the wheel to zoom."
        : count === 1
          ? "Now click your destination."
          : "Trip: " + formatDistance(distance(picking.points[0], picking.points[1])) + " in a straight line.";
  }

  // Leaves the map. With fly = true the plane starts at the first point,
  // heading for the second along the line a real flight would take.
  function stopPicking(fly) {
    const [a, b] = picking.points;
    clearPickMarks();
    picking = null;
    scene.screenSpaceCameraController.enableInputs = false;
    updatePickBar();
    if (fly && a && b) {
      runNav(() => startTrip({ ...a, name: "Start" }, { ...b, name: "Destination" })).then(() => {
        if (!placed) openStart(); // the two points were too close together
      });
    } else if (!placed) {
      openStart();
    }
  }

  for (const id of ["start-map", "pick-trip"]) {
    $(id).addEventListener("click", (e) => {
      startPicking();
      e.currentTarget.blur();
    });
  }
  $("pick-go").addEventListener("click", () => stopPicking(true));
  $("pick-cancel").addEventListener("click", () => stopPicking(false));
  $("pick-again").addEventListener("click", () => {
    clearPickMarks();
    updatePickBar();
  });

  // ------------------------------------------------------------ start screen

  // The game waits on this screen until a start point is chosen: a searched
  // place, typed X / Y coordinates, or one of the famous places.
  function openStart() {
    $("start-error").hidden = true;
    $("start-place").value = place.id;
    $("start-dialog").hidden = false;
    $("start-search").focus();
  }

  $("start-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $("start-form").querySelector("button");
    button.disabled = true;
    $("start-error").hidden = true;
    try {
      if ($("start-from").value.trim() || $("start-to").value.trim()) {
        if (!$("start-from").value.trim() || !$("start-to").value.trim()) {
          throw new Error("A trip needs both a From and a To, for example DXB and LHR.");
        }
        const from = await resolvePlace("start-from");
        $("nav-status").textContent = await startTrip(from, await resolvePlace("start-to"));
      } else if ($("start-x").value.trim() || $("start-y").value.trim()) {
        const spot = parseXY($("start-x").value, $("start-y").value);
        if (!spot) throw new Error(BAD_XY);
        await travelTo(spot.lon, spot.lat, 0);
      } else if ($("start-search").value.trim()) {
        const found = await resolvePlace("start-search");
        await travelTo(found.lon, found.lat, 0);
      } else {
        choosePlace($("start-place").value);
      }
      $("start-dialog").hidden = true;
      if (document.activeElement) document.activeElement.blur();
    } catch (err) {
      $("start-error").textContent = err && err.message ? err.message : String(err);
      $("start-error").hidden = false;
    }
    button.disabled = false;
  });

  $("choose-start").addEventListener("click", (e) => {
    openStart();
    e.currentTarget.blur();
  });

  // ------------------------------------------------------------ UI wiring

  const placeSelect = $("place-select");
  for (const select of [placeSelect, $("start-place")]) {
    for (const p of PLACES) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    }
  }
  placeSelect.value = place.id;

  function choosePlace(id) {
    place = PLACES.find((p) => p.id === id) || PLACES[0];
    placeSelect.value = place.id;
    storageSet(PLACE_KEY, place.id);
    spawn();
  }
  placeSelect.addEventListener("change", () => {
    choosePlace(placeSelect.value);
    placeSelect.blur();
  });

  $("data-select").addEventListener("change", (e) => {
    storageSet(DATA_KEY, e.target.value);
    window.location.reload();
  });

  $("flights-toggle").addEventListener("change", (e) => {
    flights.setEnabled(e.target.checked);
    updateFlightsNote();
    e.target.blur();
  });

  function updateFlightsNote() {
    const toggle = $("flights-toggle");
    if (!flights.available) {
      toggle.checked = false;
      toggle.disabled = true;
      $("flights-note").textContent = "only when run with npm start";
    } else {
      $("flights-note").textContent = toggle.checked ? flights.count + " nearby" : "";
    }
  }

  $("help-toggle").addEventListener("click", (e) => {
    toggleHelp();
    e.currentTarget.blur();
  });

  // Mouse: the wheel zooms the chase camera, dragging turns and tilts it, a
  // right-click puts it back, and a double-click goes to that spot.
  const canvas = scene.canvas;
  let drag = null; // last pointer position while the left button is held
  let dragged = false; // true once the pointer has moved far enough to count as a drag
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    dragged = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) dragged = true;
    if (!dragged || picking) return;
    orbit.heading -= (e.clientX - drag.x) * 0.006;
    orbit.pitch -= (e.clientY - drag.y) * 0.005;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  window.addEventListener("pointerup", () => {
    drag = null;
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (picking) return;
    orbit = { heading: 0, pitch: 0 };
    zoom = 1;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (picking) return; // the map handles its own zoom
      e.preventDefault();
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(e.deltaY * 0.0015)));
      if (view !== "chase") setView("chase");
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
    const aircraft = feature && feature.id ? flights.describe(feature.id) : "";
    if (aircraft) {
      showInfo(spot, aircraft);
      return;
    }
    let text = feature instanceof Cesium.Cesium3DTileFeature ? buildingText(feature) : "";
    if (!text && !googleGeocoder) {
      const there = Cesium.Cartographic.fromCartesian(spot);
      text = await reverseGeocode(toDeg(there.longitude), toDeg(there.latitude));
    }
    if (text) showInfo(spot, text);
  }

  let clickTimer = 0;
  canvas.addEventListener("click", (e) => {
    if (dragged) return; // the end of a drag, not a click
    const point = mousePoint(e);
    if (picking) {
      pickPoint(point);
      return;
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => identify(point), 300); // long enough for a double-click to cancel it
  });
  canvas.addEventListener("dblclick", (e) => {
    clearTimeout(clickTimer);
    if (picking) return;
    const spot = pickSpot(mousePoint(e));
    if (!spot) return;
    const there = Cesium.Cartographic.fromCartesian(spot);
    travelTo(toDeg(there.longitude), toDeg(there.latitude), state.heading);
  });

  function toggleHelp() {
    $("help").hidden = !$("help").hidden;
  }

  function onAction(code) {
    if (code === "Escape" && demo && demo.stop) demo.stop();
    if (!placed || picking) return; // still choosing where to fly
    if (code === "KeyV") setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);
    else if (code === "KeyA") setAutopilot(!autopilot);
    else if (code === "KeyR") spawn();
    else if (code === "KeyH") toggleHelp();
    else if (code === "KeyB") flyToBurjKhalifa();
  }

  // ------------------------------------------------------------ travel

  function spawn() {
    // Flying from Downtown starts with the tower in front of you.
    if (place.id === "downtown") flyToBurjKhalifa();
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

  // Sends the plane to a point anywhere in the world (degrees).
  async function travelTo(lon, lat, heading) {
    const ground = await terrainHeight(lon, lat);
    autopilot = false; // going somewhere else leaves the trip's line
    parked = false;
    placeAt(lon, lat, heading, ground);
    updateTripBar();
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

  // Puts the plane in the air, `lift` meters above ground level at a point (degrees).
  function placeAt(lon, lat, heading, ground, lift = PLANE_SPAWN_HEIGHT) {
    state = createState(toRad(lon), toRad(lat), ground + lift, heading);
    setAnchor(lon, lat, ground);
    placed = true;
    camHeading = heading;
    crashTimer = 0;
    lastGround = undefined;
    state.speed = 70;
    showMessage("");
  }

  // Starts a flight 3 km south-west of Burj Khalifa, aimed just to the right
  // of the tower so it stays in view as you pass it.
  function flyToBurjKhalifa() {
    autopilot = false;
    parked = false;
    const start = offset(toRad(BURJ_KHALIFA.lon), toRad(BURJ_KHALIFA.lat), 3000, toRad(225));
    placeAt(toDeg(start.lon), toDeg(start.lat), toRad(52), DUBAI_GROUND, 530);
    flash("Burj Khalifa ahead", 4);
  }

  // ------------------------------------------------------------ loop

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (!placed || picking) return;

    // After a long trip, move the sun and the building shader along too.
    if (!reanchoring && distance(here(), anchor) > REANCHOR_DISTANCE) {
      const { lon, lat } = here();
      reanchoring = true;
      terrainHeight(lon, lat).then((ground) => {
        setAnchor(lon, lat, ground);
        reanchoring = false;
      });
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
    } else if (trip && autopilot) {
      const low = trip.runways && tripState(trip, trip.flown).clearance < HANDS_OFF;
      if ((input.up || input.down || input.left || input.right) && low) {
        flash("The autopilot keeps the controls this close to the ground.", 3);
        flyTrip(dt);
      } else if (input.up || input.down || input.left || input.right) {
        setAutopilot(false);
      } else if (!flyTrip(dt)) {
        autopilot = false;
        trip.arrived = true;
        state.pitch = 0;
        if (trip.runways) {
          parked = true;
          state.speed = 0;
          flash("You have landed at " + shortName(trip.to) + ". Press an arrow key to take off again.", 8);
        } else {
          state.speed = 150;
          state.throttle = 0.7;
          flash("You have arrived at " + shortName(trip.to) + ". You have the controls.", 6);
        }
      }
    } else if (parked) {
      // Standing on the runway. An arrow key starts a new flight from here.
      if (input.up || input.down || input.left || input.right) {
        parked = false;
        state.height += 150;
        state.speed = 70;
        state.throttle = 0.4;
      }
    } else {
      updatePlane(state, input, dt, sampleGround);
      if (state.crashed) showMessage("Crashed! Respawning…");
    }
    if (trip) updateTripBar();

    lastGround = sampleGround(state.lon, state.lat);
    updateCamera(dt);
    updateHud(lastGround);
    updateAddress(now);
    flights.update(here(), now).then((changed) => {
      if (!changed) return;
      refreshExclude();
      updateFlightsNote();
    });
    plane.show = view === "chase";
  }

  function updateCamera(dt) {
    if (view !== "chase") {
      // From a seat: straight ahead for the pilot, out to the side and a
      // little down for a window. Dragging the mouse looks around from there.
      const side = view === "left" ? -Math.PI / 2 : view === "right" ? Math.PI / 2 : 0;
      orbit.pitch = Math.min(0.6, Math.max(-1.4, orbit.pitch));
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height + 1.2),
        orientation: {
          heading: state.heading + side + orbit.heading,
          pitch: (side ? -0.2 : state.pitch) + orbit.pitch,
          roll: side ? 0 : state.roll,
        },
      });
      return;
    }

    if (demo) {
      // The tour moves the camera by itself: a slow circle and an eased zoom.
      orbit.heading += demo.spin * dt;
      zoom += (demo.zoomTo - zoom) * Math.min(1, dt * 0.8);
    }

    // Chase camera: trails behind the plane and swings round smoothly on turns.
    let diff = state.heading - camHeading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    camHeading += diff * Math.min(1, dt * 2.5);

    // Zooming out also tilts the camera down, towards a map-like view from above.
    // Dragging the mouse adds its own turn and tilt, from straight down to a little upwards.
    const zoomTilt = Math.max(-1.3, CHASE_PITCH - Math.max(0, Math.log(zoom)) * 0.3);
    const pitch = Math.min(0.3, Math.max(-1.5, zoomTilt + orbit.pitch));
    orbit.pitch = pitch - zoomTilt; // so a drag past the limit does not have to be undone first
    const target = Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.height);
    camera.lookAt(target, new Cesium.HeadingPitchRange(camHeading + orbit.heading, pitch, CHASE_RANGE * zoom));
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
    if (trip) {
      // The trip bar shows how far there is to go.
      $("hud-target").textContent = "";
      return;
    }
    if (!route) {
      // Over Dubai, point to the tower instead.
      const toTower = distance(here(), BURJ_KHALIFA);
      $("hud-target").textContent = toTower < 50000 ? pointer(BURJ_KHALIFA.name, BURJ_KHALIFA, toTower) : "";
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
    $("hud-speed").textContent = kmh + " km/h" + (trip && autopilot && flownScale > 1 ? " ×" + flownScale : "");
    const agl = ground !== undefined ? Math.max(0, Math.round(state.height - ground)) : null;
    $("hud-alt").textContent = agl !== null ? agl + " m above ground" : "—";
    $("hud-throttle").textContent = "Throttle " + Math.round(state.throttle * 100) + "%";
    const deg = Math.round(Cesium.Math.toDegrees(state.heading) + 360) % 360;
    $("hud-heading").textContent = deg + "° " + compass(deg);
    updateTarget();
    if (!state.crashed) showMessage(performance.now() < flashUntil ? flashText : "");
  }

  function compass(deg) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  }

  return {
    start() {
      openStart();
      scene.postRender.addEventListener(tick);
      // Exposed for automated tests and debugging.
      window.game = {
        get state() {
          return state;
        },
        spawn,
      };
    },
  };
}

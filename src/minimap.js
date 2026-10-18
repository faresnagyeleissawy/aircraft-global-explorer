// A small flat map in a corner of the screen, so the player can see where in
// the country they are and how big it is. It uses Leaflet with the
// OpenStreetMap street map, which draws country and province (governorate)
// borders, or satellite photos with the borders and names laid on them, and
// shows a scale bar, the plane as an arrow, and the trip line.

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// Esri's satellite photos, and its layer of borders and place names to lay on them.
const SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const BORDERS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const START_ZOOM = 6; // a whole country, with its provinces
const FOLLOW_PAUSE = 8000; // ms after the player drags the map before it follows the plane again

// An arrow pointing north, turned to the plane's heading with CSS.
const ARROW =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 L20 21 L12 16 L4 21 Z" fill="#f0b429" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';

// element: where the map goes. onPick(lon, lat) is called when the map is
// clicked, to fly to that spot.
export function createMinimap(L, element, onPick) {
  const map = L.map(element, {
    center: [25.2, 55.27],
    zoom: START_ZOOM,
    minZoom: 2,
    worldCopyJump: true,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  const streets = L.tileLayer(TILES, { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const satellite = L.layerGroup([
    L.tileLayer(SATELLITE, { maxZoom: 18, attribution: "© Esri, Maxar" }),
    L.tileLayer(BORDERS, { maxZoom: 18 }),
  ]);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  const plane = L.marker([25.2, 55.27], {
    icon: L.divIcon({ className: "minimap-plane", html: ARROW, iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false,
    keyboard: false,
  }).addTo(map);
  let line = null;
  let followAgainAt = 0;

  map.on("dragstart", () => (followAgainAt = Infinity));
  map.on("dragend", () => (followAgainAt = performance.now() + FOLLOW_PAUSE));
  map.on("click", (e) => onPick(e.latlng.lng, e.latlng.lat));

  return {
    // The plane's position in degrees and heading in degrees from north.
    update(lon, lat, heading) {
      plane.setLatLng([lat, lon]);
      const arrow = plane.getElement();
      if (arrow) arrow.firstChild.style.transform = "rotate(" + heading + "deg)";
      if (performance.now() > followAgainAt) map.panTo([lat, lon], { animate: false });
    },
    // The trip or route line as { lon, lat } points, or null to remove it.
    setLine(points) {
      if (line) line.remove();
      line = points ? L.polyline(points.map((p) => [p.lat, p.lon]), { color: "#f0b429", weight: 3 }).addTo(map) : null;
    },
    // "streets" or "satellite".
    setStyle(style) {
      const [on, off] = style === "satellite" ? [satellite, streets] : [streets, satellite];
      map.removeLayer(off);
      if (!map.hasLayer(on)) on.addTo(map);
    },
    // The map must measure itself again after its box is shown or resized.
    refresh() {
      map.invalidateSize();
      followAgainAt = 0;
    },
  };
}

# Aircraft Global Explorer

A browser game for exploring the real world in 3D. Search for any place and fly a plane there, steering with the arrow keys, or type two airport codes such as DXB and LHR and ride the flight between them as a passenger. The famous places list starts in Dubai. It is built on [CesiumJS](https://cesium.com/platform/cesiumjs/) (open source, Apache 2.0) and uses map data from a free [Cesium ion](https://ion.cesium.com) account.

## Run it

You need a Cesium ion access token. Sign in at [ion.cesium.com](https://ion.cesium.com), open **Access Tokens** and copy the **Default** token. The game asks for the token the first time it starts and keeps it only in your browser.

```bash
npm start          # runs server.js at http://localhost:8080 (Node 18+)
```

Any static web server also works, for example `python3 -m http.server 8080`, but then there are no live flights (see below). The page has to be served over http, because opening `index.html` as a file will not load the models.

### Letting visitors play without a token

Two things spare a visitor from making a Cesium ion account:

- The token box has a **Play without a token** button. It opens the game with `?simple`: the OpenStreetMap street map on a smooth globe, with no 3D buildings or terrain. Search, trips, airports, runways and the views all work.
- Whoever hosts the game can put a token of their own in `src/config.js`, and every visitor then gets the full 3D map at once. That file is public, so use a separate token limited to the `assets:read` and `geocode` scopes and to your site's address, never your Default token. Visitors' use counts against that account's monthly limits.

### Hosting on GitHub Pages

Go to **Settings → Pages** in the repository and choose "Deploy from a branch", with branch `main` and folder `/ (root)`. The game is plain HTML and JavaScript, so there is no build step.

## Controls

| Key | Plane |
| --- | --- |
| ↑ / ↓ | Nose up / down; hold for a loop |
| ← / → | Roll left / right; hold to roll right round |
| Q / E | Rudder: nose left / right |
| Shift | More throttle |
| Mouse wheel | Zoom in and out |
| Drag | Tilt and turn the view around the plane |
| Right-click or ⟲ Level | Put the view back behind the aircraft, level |
| Click | Show the name and address of that building or spot |
| Double-click | Fly to that spot on the map |

On a phone or tablet the game shows its own buttons: an arrow pad to steer, Faster for more throttle, View, Auto for the autopilot, and ＋ / － to zoom. The ☰ button opens and closes the menu, which starts closed on a small screen. Dragging a finger looks around and a double tap flies to that spot.

The arrow keys and Shift are all you need. W and S also work for throttle up and down. V changes the view, A turns the autopilot on and off during a trip, R takes you back to the start point, B flies to Burj Khalifa, and H shows or hides the controls. Zooming out keeps the camera's angle; tick "Tilt down when zooming out" in the menu to have it tilt towards a map-like view instead.

## Search, routes and Burj Khalifa

- **Search bar**: at the top of the screen, as on a map site, and always there. It moves you to any address or place in the world, puts a red pin on it and shows a card with its name, coordinates, ☆ Save and ✈ Trip here (a flight from where you are to that place).
- **Saved places**: the ★ button next to the search bar lists your saved places. Click one to fly there, ✕ to remove it, and "＋ Save this spot" saves where you are flying now. They are kept in your browser.
- **Search** results: While you type, a list of matching places appears; pick one with the mouse, a finger, or the arrow keys and Enter. Pressing Go without picking searches for what you typed and lists up to eight matching addresses to choose from; a single match is gone to straight away. You can also type coordinates as `lat, lon`.
- **Start screen**: the game opens by asking where to fly. Search for a place, type X (longitude) and Y (latitude), or pick a famous place, then press Start flying. "New start" in the panel brings the screen back.
- **Demo tour**: "Watch the demo tour" on the start screen, or "Demo" at the bottom of the panel, plays a three-minute scripted tour with captions: the city, a search, the window and pilot seats, live flights, and a trip from Dubai to Abu Dhabi with take-off and landing. It is meant for recording a video of the game. Esc stops it.
- **Trips**: type two airport codes (DXB, LHR) or places on the start screen, or in "Trip from / to" in the panel. The plane flies the trip on autopilot along the path a real flight takes: it climbs to cruising height, cruises at about 900 km/h and comes down at the other end. A bar at the bottom shows how far you are and how much flying is left. The speed buttons make the flight pass up to 60 times faster. Touch an arrow key to take the controls, and press A to give them back to the autopilot. Between two places that are not airports, "Trip from / to" still draws the road route.
- **Take-off and landing** (advanced option): tick "take off and land on the runways" and a trip between two airports starts standing on the departure runway. The plane rolls, lifts off, climbs straight ahead, turns on course, and at the other end lines up 15 km out, comes down a 3 degree approach, touches down and rolls to a stop. Near the ground the flight runs in real time whatever the speed buttons say, and the autopilot keeps the controls until the plane is 150 m up. Each airport's longest runway is used, in the direction that best fits the trip. `data/runways.json` has runways for 2,873 of the airports; without one at both ends, or on trips under 60 km, the trip starts and ends in the air as before.
- **Views**: V or the View menu switches between behind the plane, the pilot's seat, and a left or right window seat. Drag the mouse to look around from any of them.
- **Trip on the map**: "pick a trip on the map" on the start screen or in the panel shows the map from high above. Drag and zoom it, click where the trip starts and then where it ends, and press Start flying. The trip between them is then flown like any other.
- **Coordinates** in the panel takes you to an X (longitude) and Y (latitude).
- **Famous places** is a short list of cities and landmarks to jump to.
- **Live flights**: real aircraft within about 185 km are drawn as yellow planes with their callsign and type, at their real position and height, and they keep moving between reports. Click one for its height and speed. The positions come from [adsb.lol](https://adsb.lol) every 10 seconds. That service cannot be called from a web page, so `server.js` relays it: live flights work when you run the game with `npm start`, and not on a static host such as GitHub Pages.
- **Helicopter**: the Aircraft menu (or 1 and 2) switches between the plane and a helicopter, wherever you are. The helicopter hovers when you let go; ↑ / ↓ fly forward and back, ← / → turn on the spot, and W / S (Power + / − on a phone, or Shift with ↑ / ↓) go up and down. It can land on the ground or on a roof if it comes down gently, and crashes if it comes down too fast or hits a building at speed. It is modelled on a light helicopter such as the Airbus H125: a white cabin with a glass nose and red stripes, an engine cowling, a tapering tail with stabilizer, swept fin and spinning tail rotor, skids on cross tubes, and a spinning three-blade main rotor. It is built from simple shapes, since there is no free helicopter model to load. Trips are always flown by the plane.
- **Flying like a real aircraft**: the plane and the jet keep their full attitude, so they can loop, roll right round, fly upside down and turn by banking and pulling, as real ones do. Climbing costs speed and diving gains it; too slow, or on its side without pulling, the nose drops. The chase camera turns with the aircraft through all of it. In the menu, "Flight assist" (on by default) levels the wings and nose when you let go of the keys, and "Pilot controls" swaps ↑ / ↓ so that ↑ pushes the nose down, as with a real stick. The display shows pitch, bank and "upside down".
- **F-35 fighter jet**: the third choice in the Aircraft menu (or 3). It flies like the plane but much faster (up to about Mach 1.6), climbs and dives more steeply and turns far tighter; Shift or Power + gives full thrust. It is shaped like an F-35 from simple shapes: pointed nose, gold-tinted canopy, side intakes, trapezoid wings, swept tailplanes and twin fins leaning outwards. Trips are still flown by the plane.
- **Pause and speed**: the bar at the top has a Pause button (or P, or Space) that stops the plane, the trip and the live flights while you can still look around, and speed buttons for 1×, 2×, 5×, 20× and 60×. Flying by hand goes up to 5×; 20× and 60× are for trips on autopilot. Near the ground on a runway trip the flight stays in real time.
- **Map on the ground**: the menu's "Map on the ground" switches between satellite photos, satellite photos with place names, and the OpenStreetMap street map. The small map follows it: satellite photos with country and province borders and names, or the street map. Without a Cesium ion token the satellite photos come from Esri's World Imagery.
- **Small map**: a flat map in the corner shows where the plane is, which way it is heading, the trip line, a scale bar, and above it the province (governorate) and country you are over. It follows the plane; drag it to look around and it comes back after a few seconds. Click it to fly to that spot. M or its Map button hides and shows it. It uses [Leaflet](https://leafletjs.com) and the OpenStreetMap street map, and is left out with Google's tiles, whose terms rule out other maps beside them.
- **Address as you go**: the display shows the nearest address or named place under the plane, refreshed every few seconds.
- **Route from / to** draws the road route between two places as a yellow line and shows the distance left. Leave "from" empty to start where you are. With a typed start you are taken there, heading along the route. Routes longer than 300 km are refused.
- **Building labels**: buildings that have a name or address in OpenStreetMap show it as a label when you are within 300 m. Click any building or spot to see its name and address; if the building has none of its own, the address of that point is looked up.
- Near Dubai the display shows the direction and distance to Burj Khalifa. **Fly to Burj Khalifa** (or B) starts a flight 3 km away with the tower straight ahead, and so does starting a flight from Downtown.

## Map data

Use the **Buildings** menu to choose the data:

- **3D buildings** (the default) uses Cesium OSM Buildings on Cesium World Terrain with Bing imagery. It covers the whole world: buildings are 3D blocks with their real footprint and height, and the game draws windows on them.
- **Photorealistic** uses Google Photorealistic 3D Tiles through Cesium ion. Where Google has a 3D mesh the city looks like a photo, but many cities, Dubai among them, only have a satellite photo on flat ground. The free plan allows 1,000 sessions a month, and each page load uses one.

The **Graphics** menu has an **Ultra** setting for a strong graphics card: full screen resolution, smoothed edges, finer buildings and terrain, long soft shadows and sunlight on the terrain. Under the menu the game names the graphics card the browser is drawing with. On a laptop with two cards, browsers often use the power-saving one; Windows Settings → System → Display → Graphics lets you set the browser to "High performance".

The Cesium ion Community plan is free for personal and non-commercial use. Commercial use needs a paid plan.

## How it works

- `src/physics.js` holds the movement model for the plane. It is plain JavaScript with no Cesium code, and it is unit tested.
- `src/facade.js` is a shader that draws windows, glass and roofs on the plain OSM Buildings blocks, so the city looks built rather than like white boxes. The pattern is generated, not photographed, so it does not match each real building.
- `src/route.js` holds the distance, bearing and route-progress helpers. It is also plain JavaScript and unit tested.
- `src/trip.js` flies a trip on autopilot and looks up airports. It is plain JavaScript and unit tested. `data/airports.json` lists 3,244 airports with scheduled flights and `data/runways.json` their longest runways; `tools/airports.mjs` rebuilds both from [OurAirports](https://ourairports.com/data/).
- `src/flights.js` draws the live aircraft and `server.js` is the small local server that relays their positions.
- `src/suggest.js` is the list of places under the search boxes and `src/labels.js` puts the name and address labels on buildings.
- Addresses are looked up with OpenStreetMap's [Nominatim](https://nominatim.org) geocoder, which is free and needs no key but allows at most one search a second. The list shown while you type and the address under the plane come from [Photon](https://photon.komoot.io), another free OpenStreetMap geocoder that allows search-as-you-type. On Google's tiles the Google geocoder from Cesium ion is used instead, as Google's terms require. Routes come from the public [OSRM](https://project-osrm.org) demo server, which is free and needs no key but is best effort and meant for light use.
- `src/main.js` turns off Cesium's mouse navigation, runs the game loop and moves the camera every frame. It finds the height of whatever is under the plane (terrain or a rooftop) with `scene.sampleHeight`; the plane crashes when it drops below that surface, and starts again in the air above it.

## Known limits

- Flying under a bridge counts as a crash, because heights are sampled from above.
- The plane cannot land: touching the ground or a roof is a crash.
- Routes follow roads, so the yellow line is a guide to fly along, not a flight path.

## Development

```bash
npm test           # physics and route unit tests (Node 18+)
```

Open `http://localhost:8080/?offline` to run the game on a plain globe with no ion data, which is useful for testing the controls. Search and routes work offline too, because they do not use Cesium ion.

## Credits

- CesiumJS © Cesium GS, Inc. ([Apache 2.0](https://github.com/CesiumGS/cesium/blob/main/LICENSE.md)), loaded from jsDelivr.
- The plane model (`Cesium_Air.glb`) is a CesiumJS sample model © Cesium GS, Inc. ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- Map data: Google, Cesium, OpenStreetMap contributors and Microsoft Bing, credited on screen. The street map without a token is © OpenStreetMap contributors, from openstreetmap.org's own tile server, which is meant for light use.
- Satellite photos without a token, and the small map's satellite view with borders and place names: [Esri World Imagery and World Boundaries and Places](https://www.arcgis.com), © Esri, Maxar, Earthstar Geographics.
- Address search: [Nominatim](https://nominatim.org) and [Photon](https://photon.komoot.io) by Komoot, © OpenStreetMap contributors.
- Airports and runways: [OurAirports](https://ourairports.com/data/), public domain.
- Live flights: [adsb.lol](https://adsb.lol), open data under the [ODbL](https://opendatacommons.org/licenses/odbl/).
- Routes: [OSRM](https://project-osrm.org) demo server, using © OpenStreetMap contributors data ([ODbL](https://www.openstreetmap.org/copyright)).

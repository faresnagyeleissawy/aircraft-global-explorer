# World 3D Explorer

A browser game for exploring the real world in 3D. Search for any place and fly a plane there, steering with the arrow keys, or type two airport codes such as DXB and LHR and ride the flight between them as a passenger. It started as a Dubai explorer, which is why the repository is called `dubai-3d-explorer` and Dubai is where you start. It is built on [CesiumJS](https://cesium.com/platform/cesiumjs/) (open source, Apache 2.0) and uses map data from a free [Cesium ion](https://ion.cesium.com) account.

## Run it

You need a Cesium ion access token. Sign in at [ion.cesium.com](https://ion.cesium.com), open **Access Tokens** and copy the **Default** token. The game asks for the token the first time it starts and keeps it only in your browser.

```bash
npm start          # runs server.js at http://localhost:8080 (Node 18+)
```

Any static web server also works, for example `python3 -m http.server 8080`, but then there are no live flights (see below). The page has to be served over http, because opening `index.html` as a file will not load the models.

### Hosting on GitHub Pages

Go to **Settings → Pages** in the repository and choose "Deploy from a branch", with branch `main` and folder `/ (root)`. The game is plain HTML and JavaScript, so there is no build step.

## Controls

| Key | Plane |
| --- | --- |
| ↑ / ↓ | Climb / dive |
| ← / → | Bank and turn |
| Shift | More throttle |
| Mouse wheel | Zoom in and out |
| Drag | Tilt and turn the view around the plane |
| Right-click | Put the view back behind the plane |
| Click | Show the name and address of that building or spot |
| Double-click | Fly to that spot on the map |

The arrow keys and Shift are all you need. W and S also work for throttle up and down. V changes the view, A turns the autopilot on and off during a trip, R takes you back to the start point, B flies to Burj Khalifa, and H shows or hides the controls. Zooming a long way out tilts the camera down to a map-like view.

## Search, routes and Burj Khalifa

- **Search** moves you to any address or place in the world. While you type, a list of matching places appears; pick one with the mouse or the arrow keys and Enter. You can also type coordinates as `lat, lon`.
- **Start screen**: the game opens by asking where to fly. Search for a place, type X (longitude) and Y (latitude), or pick a famous place, then press Start flying. "New start" in the panel brings the screen back.
- **Trips**: type two airport codes (DXB, LHR) or places on the start screen, or in "Trip from / to" in the panel. The plane flies the trip on autopilot along the path a real flight takes: it climbs to cruising height, cruises at about 900 km/h and comes down at the other end. A bar at the bottom shows how far you are and how much flying is left. The Speed menu makes the flight pass up to 60 times faster. Touch an arrow key to take the controls, and press A to give them back to the autopilot. Between two places that are not airports, "Trip from / to" still draws the road route.
- **Views**: V or the View menu switches between behind the plane, the pilot's seat, and a left or right window seat. Drag the mouse to look around from any of them.
- **Trip on the map**: "pick a trip on the map" on the start screen or in the panel shows the map from high above. Drag and zoom it, click where the trip starts and then where it ends, and press Start flying. The trip between them is then flown like any other.
- **Coordinates** in the panel takes you to an X (longitude) and Y (latitude).
- **Famous places** is a short list of cities and landmarks to jump to.
- **Live flights**: real aircraft within about 185 km are drawn as yellow planes with their callsign and type, at their real position and height, and they keep moving between reports. Click one for its height and speed. The positions come from [adsb.lol](https://adsb.lol) every 10 seconds. That service cannot be called from a web page, so `server.js` relays it: live flights work when you run the game with `npm start`, and not on a static host such as GitHub Pages.
- **Address as you go**: the display shows the nearest address or named place under the plane, refreshed every few seconds.
- **Route from / to** draws the road route between two places as a yellow line and shows the distance left. Leave "from" empty to start where you are. With a typed start you are taken there, heading along the route. Routes longer than 300 km are refused.
- **Building labels**: buildings that have a name or address in OpenStreetMap show it as a label when you are within 300 m. Click any building or spot to see its name and address; if the building has none of its own, the address of that point is looked up.
- Near Dubai the display shows the direction and distance to Burj Khalifa. **Fly to Burj Khalifa** (or B) starts a flight 3 km away with the tower straight ahead, and so does starting a flight from Downtown.

## Map data

Use the **Buildings** menu to choose the data:

- **3D buildings** (the default) uses Cesium OSM Buildings on Cesium World Terrain with Bing imagery. It covers the whole world: buildings are 3D blocks with their real footprint and height, and the game draws windows on them.
- **Photorealistic** uses Google Photorealistic 3D Tiles through Cesium ion. Where Google has a 3D mesh the city looks like a photo, but many cities, Dubai among them, only have a satellite photo on flat ground. The free plan allows 1,000 sessions a month, and each page load uses one.

The Cesium ion Community plan is free for personal and non-commercial use. Commercial use needs a paid plan.

## How it works

- `src/physics.js` holds the movement model for the plane. It is plain JavaScript with no Cesium code, and it is unit tested.
- `src/facade.js` is a shader that draws windows, glass and roofs on the plain OSM Buildings blocks, so the city looks built rather than like white boxes. The pattern is generated, not photographed, so it does not match each real building.
- `src/route.js` holds the distance, bearing and route-progress helpers. It is also plain JavaScript and unit tested.
- `src/trip.js` flies a trip on autopilot and looks up airports. It is plain JavaScript and unit tested. `data/airports.json` lists 3,244 airports with scheduled flights; `tools/airports.mjs` rebuilds it from [OurAirports](https://ourairports.com/data/).
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
- Map data: Google, Cesium, OpenStreetMap contributors and Microsoft Bing, credited on screen.
- Address search: [Nominatim](https://nominatim.org) and [Photon](https://photon.komoot.io) by Komoot, © OpenStreetMap contributors.
- Airports: [OurAirports](https://ourairports.com/data/), public domain.
- Live flights: [adsb.lol](https://adsb.lol), open data under the [ODbL](https://opendatacommons.org/licenses/odbl/).
- Routes: [OSRM](https://project-osrm.org) demo server, using © OpenStreetMap contributors data ([ODbL](https://www.openstreetmap.org/copyright)).

# World 3D Explorer

A browser game for exploring the real world in 3D. Search for any place, then walk, drive or fly there, steering with the arrow keys. It started as a Dubai explorer, which is why the repository is called `dubai-3d-explorer` and Dubai is where you start. It is built on [CesiumJS](https://cesium.com/platform/cesiumjs/) (open source, Apache 2.0) and uses map data from a free [Cesium ion](https://ion.cesium.com) account.

## Run it

You need a Cesium ion access token. Sign in at [ion.cesium.com](https://ion.cesium.com), open **Access Tokens** and copy the **Default** token. The game asks for the token the first time it starts and keeps it only in your browser.

```bash
npm start          # serves the folder at http://localhost:8080
```

Any static web server works, for example `python3 -m http.server 8080`. The page has to be served over http, because opening `index.html` as a file will not load the models.

### Hosting on GitHub Pages

Go to **Settings → Pages** in the repository and choose "Deploy from a branch", with branch `main` and folder `/ (root)`. The game is plain HTML and JavaScript, so there is no build step.

## Controls

| Key | Walk | Car | Plane |
| --- | --- | --- | --- |
| ↑ / ↓ | Forward / back | Accelerate / brake, then reverse | Climb / dive |
| ← / → | Turn | Steer | Bank and turn |
| Shift | Run | Boost | More throttle |
| W / S | | | Throttle up / down |
| Space | | Handbrake | |
| Mouse | Click the map to look around, Esc to release | | |

Press 1, 2 or 3 (or C to cycle) to switch mode. V switches between the chase and inside views, R takes you back to the start point, B flies to Burj Khalifa, and H shows or hides the controls.

## Search, routes and Burj Khalifa

- **Search** moves you to any address or place in the world. You can also type coordinates as `lat, lon`.
- **Famous places** is a short list of cities and landmarks to jump to.
- **Route from / to** draws the road route between two places as a yellow line and shows the distance left. Leave "from" empty to start where you are. With a typed start you are put on the road there, facing along the route. Routes longer than 300 km are refused.
- When you fly near Dubai the display shows the direction and distance to Burj Khalifa. **Fly to Burj Khalifa** (or B) starts a flight 3 km away with the tower straight ahead, and so does starting a flight from Downtown.

## Map data

Use the **Buildings** menu to choose the data:

- **3D buildings** (the default) uses Cesium OSM Buildings on Cesium World Terrain with Bing imagery. It covers the whole world: buildings are 3D blocks with their real footprint and height, and the game draws windows on them.
- **Photorealistic** uses Google Photorealistic 3D Tiles through Cesium ion. Where Google has a 3D mesh the city looks like a photo, but many cities, Dubai among them, only have a satellite photo on flat ground. The free plan allows 1,000 sessions a month, and each page load uses one.

The Cesium ion Community plan is free for personal and non-commercial use. Commercial use needs a paid plan.

## How it works

- `src/physics.js` holds the movement models for walking, driving and flying. It is plain JavaScript with no Cesium code, and it is unit tested.
- `src/facade.js` is a shader that draws windows, glass and roofs on the plain OSM Buildings blocks, so the city looks built rather than like white boxes. The pattern is generated, not photographed, so it does not match each real building.
- `src/route.js` holds the distance, bearing and route-progress helpers. It is also plain JavaScript and unit tested.
- Addresses are looked up with OpenStreetMap's [Nominatim](https://nominatim.org) geocoder, which is free and needs no key but allows at most one search a second. On Google's tiles the Google geocoder from Cesium ion is used instead, as Google's terms require. Routes come from the public [OSRM](https://project-osrm.org) demo server, which is free and needs no key but is best effort and meant for light use.
- `src/main.js` turns off Cesium's mouse navigation, runs the game loop and moves the camera every frame. It finds the height of whatever is under the player (terrain, a road or a rooftop) with `scene.sampleHeight`.
- Walls work by sampling the height just ahead of you. If the surface ahead is more than a step higher (0.6 m on foot, 1.2 m by car), you are blocked. A plane crashes when it drops below the surface.

## Known limits

- Driving under a bridge is treated as hitting a wall, because heights are sampled from above.
- The famous places are approximate. In walk or car mode you may land on a rooftop. You can walk off it, or press 3 to fly.

## Development

```bash
npm test           # physics and route unit tests (Node 18+)
```

Open `http://localhost:8080/?offline` to run the game on a plain globe with no ion data, which is useful for testing the controls. Search and routes work offline too, because they do not use Cesium ion.

## Credits

- CesiumJS © Cesium GS, Inc. ([Apache 2.0](https://github.com/CesiumGS/cesium/blob/main/LICENSE.md)), loaded from jsDelivr.
- The truck and plane models (`CesiumMilkTruck.glb`, `Cesium_Air.glb`) are CesiumJS sample models © Cesium GS, Inc. ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- Map data: Google, Cesium, OpenStreetMap contributors and Microsoft Bing, credited on screen.
- Address search: [Nominatim](https://nominatim.org), © OpenStreetMap contributors.
- Routes: [OSRM](https://project-osrm.org) demo server, using © OpenStreetMap contributors data ([ODbL](https://www.openstreetmap.org/copyright)).

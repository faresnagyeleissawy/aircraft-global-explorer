// Name and address labels on the buildings of a 3D Tiles tileset. Labels are
// made as each tile loads and removed when it unloads. describe(feature)
// returns { text, lon, lat, height } (degrees, meters above the ground) for a
// building worth labelling, or null.

const MAX_PER_TILE = 80;
const VISIBLE_WITHIN = 300; // meters from the camera

export function labelBuildings(Cesium, scene, tileset, describe) {
  const labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  const byTile = new Map();

  tileset.tileLoad.addEventListener((tile) => {
    const made = [];
    try {
      const content = tile.content;
      const count = content && content.featuresLength ? content.featuresLength : 0;
      for (let i = 0; i < count && made.length < MAX_PER_TILE; i++) {
        const found = describe(content.getFeature(i));
        if (!found) continue;
        made.push(
          labels.add({
            text: found.text,
            position: Cesium.Cartesian3.fromDegrees(found.lon, found.lat, found.height + 2),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            font: "600 13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: new Cesium.Color(0.07, 0.09, 0.11, 0.75),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, VISIBLE_WITHIN),
            // Readable from the street, where the roof would otherwise hide it.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          })
        );
      }
    } catch (err) {
      // Labels are a nicety: a tile with unexpected data must not stop the game.
      console.warn("Could not label a tile of buildings", err);
    }
    if (made.length) byTile.set(tile, made);
  });

  tileset.tileUnload.addEventListener((tile) => {
    for (const label of byTile.get(tile) || []) labels.remove(label);
    byTile.delete(tile);
  });

  return labels;
}

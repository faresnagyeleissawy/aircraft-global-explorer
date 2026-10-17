// A helicopter built from simple shapes, since there is no free helicopter
// model to load: a cabin, a tail, skids and a spinning main rotor. The shapes
// are laid out once in the helicopter's own frame (x forward, y left, z up,
// from the bottom of the skids); each frame only the whole is moved, which is
// cheap.

const BODY = "#c8102e";
const DARK = "#2a2f36";

// Parts that are solid, and parts seen through.
const SOLID = [
  { shape: "ellipsoid", at: [0, 0, 1.6], size: [2.3, 1.25, 1.15], color: BODY },
  { shape: "box", at: [-4.3, 0, 1.95], size: [5.2, 0.32, 0.38], color: BODY },
  { shape: "box", at: [-6.8, 0, 2.6], size: [0.9, 0.12, 1.3], color: BODY },
  { shape: "box", at: [0, 0, 3.0], size: [0.25, 0.25, 0.6], color: DARK },
  { shape: "box", at: [0, 1.0, 0.08], size: [3.6, 0.12, 0.12], color: DARK },
  { shape: "box", at: [0, -1.0, 0.08], size: [3.6, 0.12, 0.12], color: DARK },
  { shape: "box", at: [0.9, 0.85, 0.45], size: [0.1, 0.1, 0.75], color: DARK },
  { shape: "box", at: [0.9, -0.85, 0.45], size: [0.1, 0.1, 0.75], color: DARK },
  { shape: "box", at: [-0.9, 0.85, 0.45], size: [0.1, 0.1, 0.75], color: DARK },
  { shape: "box", at: [-0.9, -0.85, 0.45], size: [0.1, 0.1, 0.75], color: DARK },
];
const GLASS = [
  { shape: "ellipsoid", at: [1.5, 0, 1.75], size: [1.2, 1.05, 0.9], color: "#1d3557", alpha: 0.85 },
  { shape: "ellipsoid", at: [-6.9, 0.2, 2.75], size: [0.75, 0.04, 0.75], color: "#9aa3ad", alpha: 0.45 },
  // The blur of the spinning main rotor.
  { shape: "ellipsoid", at: [0, 0, 3.32], size: [5.3, 5.3, 0.02], color: "#cfd6de", alpha: 0.18 },
];
// The main rotor's two blades, around the rotor hub.
const BLADES = [
  { shape: "box", at: [0, 0, 0], size: [10.5, 0.32, 0.06], color: DARK },
  { shape: "box", at: [0, 0, 0], size: [0.32, 10.5, 0.06], color: DARK },
];
const HUB = [0, 0, 3.32];
const ROTOR_SPEED = 28; // radians per second

// getState() returns { lon, lat, height, heading, pitch, roll } in radians and
// meters, with heading 0 = north as in physics.js.
export function createHelicopter(Cesium, viewer, getState) {
  const vertexFormat = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;

  function instance(part) {
    const geometry =
      part.shape === "box"
        ? Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(...part.size), vertexFormat })
        : new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(...part.size), vertexFormat });
    const color = Cesium.Color.fromCssColorString(part.color).withAlpha(part.alpha ?? 1);
    return new Cesium.GeometryInstance({
      geometry,
      modelMatrix: Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(...part.at)),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
    });
  }

  function primitive(parts, translucent) {
    return viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: parts.map(instance),
        appearance: new Cesium.PerInstanceColorAppearance({ translucent, closed: !translucent }),
        asynchronous: false,
        shadows: translucent ? Cesium.ShadowMode.DISABLED : Cesium.ShadowMode.ENABLED,
        show: false,
      })
    );
  }

  const solid = primitive(SOLID, false);
  const glass = primitive(GLASS, true);
  const blades = primitive(BLADES, false);
  const primitives = [solid, glass, blades];

  const frame = new Cesium.Matrix4();
  const hub = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(...HUB));
  const spin = new Cesium.Matrix3();
  const spinning = new Cesium.Matrix4();
  const hpr = new Cesium.HeadingPitchRoll();
  let rotor = 0;
  let shown = false;

  return {
    // For leaving out of ground checks.
    primitives,
    // Moves the helicopter to the current state and turns the rotor.
    update(dt) {
      const s = getState();
      const origin = Cesium.Cartesian3.fromRadians(s.lon, s.lat, s.height);
      // Cesium's heading 0 points east and ours north, as for the plane model.
      hpr.heading = s.heading - Math.PI / 2;
      hpr.pitch = s.pitch;
      hpr.roll = s.roll;
      Cesium.Transforms.headingPitchRollToFixedFrame(origin, hpr, undefined, undefined, frame);
      Cesium.Matrix4.clone(frame, solid.modelMatrix);
      Cesium.Matrix4.clone(frame, glass.modelMatrix);
      rotor = (rotor + ROTOR_SPEED * dt) % (Math.PI * 2);
      Cesium.Matrix3.fromRotationZ(rotor, spin);
      Cesium.Matrix4.multiply(frame, hub, spinning);
      Cesium.Matrix4.multiplyByMatrix3(spinning, spin, blades.modelMatrix);
    },
    setShown(on) {
      if (on === shown) return;
      shown = on;
      for (const p of primitives) p.show = on;
    },
  };
}

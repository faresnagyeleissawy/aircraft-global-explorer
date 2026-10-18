// A stealth fighter in the style of the F-35, built from simple shapes since
// there is no free model of one to load: a long fuselage with a pointed nose,
// a gold-tinted canopy, side air intakes, trapezoid wings, swept tailplanes,
// twin outward-leaning fins and an engine nozzle. The shapes are laid out once
// in the jet's own frame (x forward, y left, z up, from its middle); each
// frame only the whole is moved, which is cheap.

const GREY = "#7a8088";
const DARK = "#555b63";
const NOZZLE = "#3d4148";
const CANOPY = "#8a7a3a";

const RAD = Math.PI / 180;

// A part: shape "box" (size = lengths), "ellipsoid" (size = radii) or
// "cylinder" (length along its own z, top and bottom radii); at = its centre;
// turns = [[axis, degrees], ...] applied in order to lay it in place.
const SOLID = [
  // Fuselage, nose cone and the flat top behind the cockpit.
  { shape: "ellipsoid", at: [0, 0, 0], size: [7.6, 1.3, 0.9], color: GREY },
  { shape: "cylinder", at: [8.3, 0, -0.05], length: 3.0, top: 0.05, bottom: 0.72, color: GREY, turns: [["y", 90]] },
  { shape: "box", at: [-1.5, 0, 0.55], size: [7.0, 1.6, 0.35], color: GREY },
  // Air intakes on both sides.
  { shape: "box", at: [2.4, 1.25, -0.1], size: [3.6, 0.7, 0.95], color: DARK, turns: [["z", -7]] },
  { shape: "box", at: [2.4, -1.25, -0.1], size: [3.6, 0.7, 0.95], color: DARK, turns: [["z", 7]] },
  // Wings: a broad inner part and a swept outer part on each side.
  { shape: "box", at: [-1.6, 2.4, -0.1], size: [5.2, 2.4, 0.16], color: GREY },
  { shape: "box", at: [-1.6, -2.4, -0.1], size: [5.2, 2.4, 0.16], color: GREY },
  { shape: "box", at: [-2.4, 4.4, -0.12], size: [3.0, 2.0, 0.12], color: GREY, turns: [["z", 30]] },
  { shape: "box", at: [-2.4, -4.4, -0.12], size: [3.0, 2.0, 0.12], color: GREY, turns: [["z", -30]] },
  // Tailplanes.
  { shape: "box", at: [-6.7, 2.1, 0], size: [2.4, 1.9, 0.1], color: GREY, turns: [["z", 28]] },
  { shape: "box", at: [-6.7, -2.1, 0], size: [2.4, 1.9, 0.1], color: GREY, turns: [["z", -28]] },
  // Twin fins, swept back and leaning outwards.
  { shape: "box", at: [-5.7, 1.15, 1.25], size: [2.4, 0.1, 2.0], color: GREY, turns: [["y", -30], ["x", -25]] },
  { shape: "box", at: [-5.7, -1.15, 1.25], size: [2.4, 0.1, 2.0], color: GREY, turns: [["y", -30], ["x", 25]] },
  // Engine nozzle.
  { shape: "cylinder", at: [-8.0, 0, 0], length: 1.4, top: 0.72, bottom: 0.55, color: NOZZLE, turns: [["y", 90]] },
];

const SEE_THROUGH = [{ shape: "ellipsoid", at: [4.4, 0, 0.72], size: [2.1, 0.55, 0.5], color: CANOPY, alpha: 0.88 }];

// getState() returns { lon, lat, height, heading, pitch, roll } in radians and
// meters, with heading 0 = north as in physics.js.
export function createJet(Cesium, viewer, getState) {
  const vertexFormat = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
  const rotation = {
    x: Cesium.Matrix3.fromRotationX,
    y: Cesium.Matrix3.fromRotationY,
    z: Cesium.Matrix3.fromRotationZ,
  };

  function geometry(part) {
    if (part.shape === "box") {
      return Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(...part.size), vertexFormat });
    }
    if (part.shape === "ellipsoid") {
      return new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(...part.size), vertexFormat });
    }
    return new Cesium.CylinderGeometry({
      length: part.length,
      topRadius: part.top,
      bottomRadius: part.bottom,
      slices: 24,
      vertexFormat,
    });
  }

  function instance(part) {
    let turn = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);
    for (const [axis, degrees] of part.turns || []) {
      turn = Cesium.Matrix3.multiply(rotation[axis](degrees * RAD), turn, new Cesium.Matrix3());
    }
    const color = Cesium.Color.fromCssColorString(part.color).withAlpha(part.alpha ?? 1);
    return new Cesium.GeometryInstance({
      geometry: geometry(part),
      modelMatrix: Cesium.Matrix4.fromRotationTranslation(turn, new Cesium.Cartesian3(...part.at)),
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
  const canopy = primitive(SEE_THROUGH, true);
  const primitives = [solid, canopy];
  const frame = new Cesium.Matrix4();
  const hpr = new Cesium.HeadingPitchRoll();
  let shown = false;

  return {
    // For leaving out of ground checks.
    primitives,
    // Moves the jet to the current state.
    update() {
      const s = getState();
      const origin = Cesium.Cartesian3.fromRadians(s.lon, s.lat, s.height);
      // Cesium's heading 0 points east and ours north, as for the plane model.
      hpr.heading = s.heading - Math.PI / 2;
      hpr.pitch = s.pitch;
      hpr.roll = s.roll;
      Cesium.Transforms.headingPitchRollToFixedFrame(origin, hpr, undefined, undefined, frame);
      Cesium.Matrix4.clone(frame, solid.modelMatrix);
      Cesium.Matrix4.clone(frame, canopy.modelMatrix);
    },
    setShown(on) {
      if (on === shown) return;
      shown = on;
      for (const p of primitives) p.show = on;
    },
  };
}

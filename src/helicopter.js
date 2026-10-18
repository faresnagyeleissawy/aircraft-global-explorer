// A light helicopter in the style of an Airbus H125 (AS350 Écureuil), built
// from simple shapes since there is no free helicopter model to load: a
// rounded cabin with a glass nose, an engine cowling, a tapering tail boom
// with stabilizer, fin and a spinning tail rotor, skids on cross tubes, and a
// three-blade main rotor. The shapes are laid out once in the helicopter's
// own frame (x forward, y left, z up, from the bottom of the skids); each
// frame only the whole is moved and the rotors are turned, which is cheap.

const WHITE = "#eef1f4";
const RED = "#c8102e";
const DARK = "#2a2f36";
const METAL = "#7d858f";
const GLASS = "#132235";

const RAD = Math.PI / 180;

// A part: shape "box" (size = lengths), "ellipsoid" (size = radii) or
// "cylinder" (length along its own z, top and bottom radii); at = its centre;
// turn = [axis, degrees] to lay it in place.
const SOLID = [
  // Cabin, nose and the fairing behind the cabin.
  { shape: "ellipsoid", at: [0.2, 0, 1.45], size: [1.95, 0.98, 0.98], color: WHITE },
  { shape: "ellipsoid", at: [1.1, 0, 1.05], size: [1.05, 0.86, 0.55], color: WHITE },
  { shape: "ellipsoid", at: [-1.35, 0, 1.72], size: [1.55, 0.74, 0.76], color: WHITE },
  // Engine cowling and exhaust.
  { shape: "ellipsoid", at: [-0.5, 0, 2.35], size: [1.45, 0.62, 0.38], color: WHITE },
  { shape: "cylinder", at: [-1.95, 0, 2.3], length: 0.5, top: 0.16, bottom: 0.2, color: DARK, turn: ["y", 90] },
  // Red stripe down each side.
  { shape: "box", at: [0.0, 0.97, 1.3], size: [3.4, 0.03, 0.2], color: RED },
  { shape: "box", at: [0.0, -0.97, 1.3], size: [3.4, 0.03, 0.2], color: RED },
  // Tail boom, thick end at the cabin.
  { shape: "cylinder", at: [-4.45, 0, 1.9], length: 5.4, top: 0.4, bottom: 0.15, color: WHITE, turn: ["y", 90] },
  { shape: "box", at: [-4.45, 0, 1.92], size: [5.0, 0.05, 0.12], color: RED },
  // Horizontal stabilizer with end plates.
  { shape: "box", at: [-5.7, 0, 1.95], size: [0.6, 2.5, 0.06], color: WHITE },
  { shape: "box", at: [-5.75, 1.25, 2.02], size: [0.5, 0.05, 0.42], color: RED },
  { shape: "box", at: [-5.75, -1.25, 2.02], size: [0.5, 0.05, 0.42], color: RED },
  // Swept fin above the tail, and a small one below.
  { shape: "box", at: [-7.05, 0, 2.6], size: [0.95, 0.08, 1.45], color: RED, turn: ["y", -25] },
  { shape: "box", at: [-6.95, 0, 1.4], size: [0.6, 0.08, 0.6], color: RED, turn: ["y", 25] },
  // Rotor mast.
  { shape: "cylinder", at: [0, 0, 2.85], length: 0.5, top: 0.09, bottom: 0.12, color: METAL },
  // Skids, turned up at the front.
  { shape: "cylinder", at: [0.1, 1.05, 0.06], length: 3.6, top: 0.06, bottom: 0.06, color: METAL, turn: ["y", 90] },
  { shape: "cylinder", at: [0.1, -1.05, 0.06], length: 3.6, top: 0.06, bottom: 0.06, color: METAL, turn: ["y", 90] },
  { shape: "cylinder", at: [2.05, 1.05, 0.2], length: 0.45, top: 0.06, bottom: 0.06, color: METAL, turn: ["y", 45] },
  { shape: "cylinder", at: [2.05, -1.05, 0.2], length: 0.45, top: 0.06, bottom: 0.06, color: METAL, turn: ["y", 45] },
  // Cross tubes from the cabin floor down to the skids.
  { shape: "cylinder", at: [0.95, 0.8, 0.5], length: 1.0, top: 0.05, bottom: 0.05, color: METAL, turn: ["x", 31] },
  { shape: "cylinder", at: [0.95, -0.8, 0.5], length: 1.0, top: 0.05, bottom: 0.05, color: METAL, turn: ["x", -31] },
  { shape: "cylinder", at: [-0.75, 0.8, 0.5], length: 1.0, top: 0.05, bottom: 0.05, color: METAL, turn: ["x", 31] },
  { shape: "cylinder", at: [-0.75, -0.8, 0.5], length: 1.0, top: 0.05, bottom: 0.05, color: METAL, turn: ["x", -31] },
];

const SEE_THROUGH = [
  // Glass nose and side windows.
  { shape: "ellipsoid", at: [1.3, 0, 1.6], size: [1.12, 0.9, 0.82], color: GLASS, alpha: 0.82 },
  { shape: "box", at: [0.35, 0.96, 1.72], size: [0.85, 0.03, 0.5], color: GLASS, alpha: 0.85 },
  { shape: "box", at: [0.35, -0.96, 1.72], size: [0.85, 0.03, 0.5], color: GLASS, alpha: 0.85 },
  { shape: "box", at: [-0.65, 0.92, 1.72], size: [0.75, 0.03, 0.45], color: GLASS, alpha: 0.85 },
  { shape: "box", at: [-0.65, -0.92, 1.72], size: [0.75, 0.03, 0.45], color: GLASS, alpha: 0.85 },
  // The blur of the spinning rotors.
  { shape: "ellipsoid", at: [0, 0, 3.12], size: [5.4, 5.4, 0.02], color: "#cfd6de", alpha: 0.16 },
  { shape: "ellipsoid", at: [-7.2, 0.2, 2.65], size: [0.85, 0.02, 0.85], color: "#cfd6de", alpha: 0.3 },
];

// Main rotor: three blades and a hub, around the top of the mast.
const MAIN_HUB = [0, 0, 3.12];
const MAIN_ROTOR = [0, 120, 240].map((angle) => ({
  shape: "box",
  at: [2.75, 0, 0],
  size: [5.3, 0.3, 0.05],
  color: DARK,
  around: angle,
}));
MAIN_ROTOR.push({ shape: "ellipsoid", at: [0, 0, 0], size: [0.32, 0.32, 0.14], color: METAL });

// Tail rotor: two blades on the left of the fin, turning about the y axis.
const TAIL_HUB = [-7.2, 0.2, 2.65];
const TAIL_ROTOR = [
  { shape: "box", at: [0, 0, 0], size: [0.14, 0.04, 1.7], color: DARK },
  { shape: "ellipsoid", at: [0, 0, 0], size: [0.1, 0.08, 0.1], color: METAL },
];

const MAIN_SPEED = 28; // radians per second
const TAIL_SPEED = 120;

// getState() returns { lon, lat, height, heading, pitch, roll } in radians and
// meters, with heading 0 = north as in physics.js.
export function createHelicopter(Cesium, viewer, getState) {
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
    // Turn the part into place about its own centre, then move it there;
    // rotor blades are also swung round the hub.
    const turn = part.turn ? rotation[part.turn[0]](part.turn[1] * RAD) : Cesium.Matrix3.IDENTITY;
    let matrix = Cesium.Matrix4.fromRotationTranslation(turn, new Cesium.Cartesian3(...part.at));
    if (part.around) {
      const swing = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(part.around * RAD));
      matrix = Cesium.Matrix4.multiply(swing, matrix, new Cesium.Matrix4());
    }
    const color = Cesium.Color.fromCssColorString(part.color).withAlpha(part.alpha ?? 1);
    return new Cesium.GeometryInstance({
      geometry: geometry(part),
      modelMatrix: matrix,
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
  const glass = primitive(SEE_THROUGH, true);
  const mainRotor = primitive(MAIN_ROTOR, false);
  const tailRotor = primitive(TAIL_ROTOR, false);
  const primitives = [solid, glass, mainRotor, tailRotor];

  const frame = new Cesium.Matrix4();
  const mainHub = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(...MAIN_HUB));
  const tailHub = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(...TAIL_HUB));
  const spin = new Cesium.Matrix3();
  const atHub = new Cesium.Matrix4();
  const hpr = new Cesium.HeadingPitchRoll();
  let main = 0;
  let tail = 0;
  let shown = false;

  return {
    // For leaving out of ground checks.
    primitives,
    // Moves the helicopter to the current state and turns the rotors.
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

      main = (main + MAIN_SPEED * dt) % (Math.PI * 2);
      Cesium.Matrix4.multiply(frame, mainHub, atHub);
      Cesium.Matrix4.multiplyByMatrix3(atHub, Cesium.Matrix3.fromRotationZ(main, spin), mainRotor.modelMatrix);

      tail = (tail + TAIL_SPEED * dt) % (Math.PI * 2);
      Cesium.Matrix4.multiply(frame, tailHub, atHub);
      Cesium.Matrix4.multiplyByMatrix3(atHub, Cesium.Matrix3.fromRotationY(tail, spin), tailRotor.modelMatrix);
    },
    setShown(on) {
      if (on === shown) return;
      shown = on;
      for (const p of primitives) p.show = on;
    },
  };
}

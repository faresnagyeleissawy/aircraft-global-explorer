// Procedural building fronts for the untextured OSM Buildings blocks: rows of
// windows on the walls, glass curtain walls higher up, plain roofs. The pattern
// is drawn by a shader from each fragment's position in a flat east/north/up
// frame fixed to the city, so it stays put on the walls as the camera moves.

const FRAGMENT_SHADER = `
const float AMBIENT = 0.55;

float facadeHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 positionEC = fsInput.attributes.positionEC;
  vec3 rel = positionEC - u_anchorEC;
  vec3 p = vec3(dot(rel, u_eastEC), dot(rel, u_northEC), dot(rel, u_upEC));
  vec3 normalEC = normalize(material.normalEC);
  vec3 n = vec3(dot(normalEC, u_eastEC), dot(normalEC, u_northEC), dot(normalEC, u_upEC));

  if (abs(n.z) > 0.6) {
    // Roof: flat concrete with a little variation from slab to slab.
    material.diffuse *= vec3(0.66, 0.65, 0.62) * (0.92 + 0.08 * facadeHash(floor(p.xy / 6.0)));
    material.roughness = 0.9;
    material.emissive = AMBIENT * material.diffuse;
    return;
  }

  // Low floors are masonry with separate windows; higher up turns to glass.
  // The change goes storey by storey so the window grid stays square.
  float bay = 2.4;
  float storey = 3.5;
  float glassy = smoothstep(30.0, 70.0, floor(p.z / storey) * storey);
  float frame = mix(0.16, 0.05, glassy);
  float sill = mix(0.30, 0.08, glassy);

  vec2 along = normalize(vec2(-n.y, n.x));
  vec2 cell = vec2(dot(p.xy, along) / bay, p.z / storey);
  vec2 f = fract(cell);
  vec2 w = fwidth(cell);
  float window =
    smoothstep(frame - w.x, frame + w.x, f.x) * (1.0 - smoothstep(1.0 - frame - w.x, 1.0 - frame + w.x, f.x)) *
    smoothstep(sill - w.y, sill + w.y, f.y) * (1.0 - smoothstep(0.88 - w.y, 0.88 + w.y, f.y));
  // Far away the windows are smaller than a pixel, so blend to their average.
  float detail = 1.0 - smoothstep(0.25, 0.6, max(w.x, w.y));
  float share = (1.0 - 2.0 * frame) * (0.88 - sill);
  window = mix(share, window, detail);

  vec3 toEye = normalize(-positionEC);
  float fresnel = pow(1.0 - clamp(dot(toEye, normalEC), 0.0, 1.0), 3.0);
  vec3 sky = vec3(0.55, 0.72, 0.92);
  float tone = mix(1.0, 0.8 + 0.4 * facadeHash(floor(cell)), detail);
  vec3 glass = mix(vec3(0.22, 0.32, 0.42), sky, 0.35 + 0.6 * fresnel) * tone;
  vec3 wall = mix(vec3(0.85, 0.80, 0.70), vec3(0.62, 0.66, 0.70), glassy);

  material.diffuse *= mix(wall, glass, window);
  material.roughness = mix(0.85, 0.2, window);
  material.specular = mix(vec3(0.04), vec3(0.5), window);
  // Stand-in for sky light, so walls facing away from the sun are not black.
  material.emissive = AMBIENT * material.diffuse;
}
`;

// Returns the shader for a tileset plus an update() to call before each
// render. lon/lat are degrees; groundHeight is the city's ground level in
// meters above the ellipsoid, where the first storey starts.
export function createFacade(Cesium, camera, lon, lat, groundHeight) {
  const anchor = Cesium.Cartesian3.fromDegrees(lon, lat, groundHeight);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
  const axes = [0, 1, 2].map((i) => {
    const c = Cesium.Matrix4.getColumn(frame, i, new Cesium.Cartesian4());
    return new Cesium.Cartesian3(c.x, c.y, c.z);
  });
  const vec3 = Cesium.UniformType.VEC3;
  const uniform = () => ({ type: vec3, value: new Cesium.Cartesian3() });
  const shader = new Cesium.CustomShader({
    uniforms: { u_anchorEC: uniform(), u_eastEC: uniform(), u_northEC: uniform(), u_upEC: uniform() },
    fragmentShaderText: FRAGMENT_SHADER,
  });
  const scratch = new Cesium.Cartesian3();

  // The frame is handed to the shader in eye coordinates, worked out here in
  // double precision, because world coordinates are too coarse in a shader.
  function update() {
    const view = camera.viewMatrix;
    shader.setUniform("u_anchorEC", Cesium.Matrix4.multiplyByPoint(view, anchor, scratch));
    shader.setUniform("u_eastEC", Cesium.Matrix4.multiplyByPointAsVector(view, axes[0], scratch));
    shader.setUniform("u_northEC", Cesium.Matrix4.multiplyByPointAsVector(view, axes[1], scratch));
    shader.setUniform("u_upEC", Cesium.Matrix4.multiplyByPointAsVector(view, axes[2], scratch));
  }
  update();
  return { shader, update };
}

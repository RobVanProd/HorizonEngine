// Procedural sky → cubemap compute shader
// Generates a 6-layer 2D array texture representing a HDR cubemap

struct SkyParams {
  sunDirection: vec3f,
  sunIntensity: f32,
  resolution: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: SkyParams;
@group(0) @binding(1) var outCube: texture_storage_2d_array<rgba16float, write>;

fn cubeDir(face: u32, uv: vec2f) -> vec3f {
  let u = uv.x * 2.0 - 1.0;
  let v = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f( 1, -v, -u)); }
    case 1u: { return normalize(vec3f(-1, -v,  u)); }
    case 2u: { return normalize(vec3f( u,  1,  v)); }
    case 3u: { return normalize(vec3f( u, -1, -v)); }
    case 4u: { return normalize(vec3f( u, -v,  1)); }
    default: { return normalize(vec3f(-u, -v, -1)); }
  }
}

fn hash2(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var total = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  for (var i = 0; i < 4; i = i + 1) {
    total += noise2(p * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

fn proceduralSky(dir: vec3f, sunDir: vec3f, sunIntensity: f32) -> vec3f {
  let up = dir.y;

  // Brighter stylized outdoor sky tuned for open meadow scenes.
  let zenith   = vec3f(0.18, 0.48, 0.92);
  let midSky   = vec3f(0.34, 0.64, 0.98);
  let horizon  = vec3f(0.72, 0.86, 1.0);
  let groundHi = vec3f(0.16, 0.17, 0.18);
  let groundLo = vec3f(0.08, 0.085, 0.09);

  var sky: vec3f;
  if (up > 0.0) {
    let t = pow(up, 0.55);
    let lower = mix(horizon, midSky, smoothstep(0.0, 0.35, t));
    sky = mix(lower, zenith, smoothstep(0.35, 1.0, t));
  } else {
    let t = pow(-up, 0.25);
    sky = mix(horizon * 0.5, mix(groundHi, groundLo, t), smoothstep(0.0, 1.0, t));
  }

  let skyDir = dir.xz / max(dir.y + 0.38, 0.2);
  let cloudDomain = skyDir * 1.8;
  let cloudBase = fbm(cloudDomain * 0.65 + vec2f(13.4, -7.2));
  let cloudDetail = fbm(cloudDomain * 1.6 - vec2f(2.7, 4.1));
  let cloudShape = cloudBase * 0.72 + cloudDetail * 0.38;
  let cloudBand = smoothstep(0.0, 0.22, up) * (1.0 - smoothstep(0.72, 1.0, up));
  let cloudMask = smoothstep(0.56, 0.78, cloudShape) * cloudBand;
  let cloudShadow = smoothstep(0.08, 0.5, up) * (1.0 - pow(max(dot(dir, sunDir), 0.0), 6.0) * 0.55);
  let cloudColor = mix(vec3f(0.8, 0.86, 0.94), vec3f(0.98, 0.99, 1.0), smoothstep(0.25, 0.95, up));
  sky = mix(sky, cloudColor * mix(0.82, 1.0, cloudShadow), cloudMask * 0.92);

  let sunDot = dot(dir, sunDir);
  let sunOcclusion = 1.0 - cloudMask * 0.88;
  let sunDisc = smoothstep(0.9995, 0.99995, sunDot);
  let sunCorona = pow(max(sunDot, 0.0), 512.0) * 15.0;
  let sunGlow = pow(max(sunDot, 0.0), 32.0) * 2.0;
  let sunScatter = pow(max(sunDot, 0.0), 6.0) * 0.3;
  sky += vec3f(1.0, 0.96, 0.88) * (sunDisc * sunIntensity + sunCorona + sunGlow + sunScatter) * sunOcclusion;

  let horizonGlow = pow(1.0 - abs(up), 6.0);
  sky += vec3f(0.82, 0.78, 0.72) * horizonGlow * 0.18;

  return sky;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = params.resolution;
  if (gid.x >= res || gid.y >= res || gid.z >= 6u) { return; }

  let uv = vec2f(
    (f32(gid.x) + 0.5) / f32(res),
    (f32(gid.y) + 0.5) / f32(res),
  );

  let dir = cubeDir(gid.z, uv);
  let color = proceduralSky(dir, normalize(params.sunDirection), params.sunIntensity);

  textureStore(outCube, vec2i(gid.xy), i32(gid.z), vec4f(color, 1.0));
}

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

fn proceduralSky(dir: vec3f, sunDir: vec3f, sunIntensity: f32) -> vec3f {
  let up = dir.y;

  // Studio-outdoor hybrid: gradient sky, ground bounce (not black), smooth horizon
  let zenith   = vec3f(0.08, 0.16, 0.55);
  let midSky   = vec3f(0.16, 0.28, 0.65);
  let horizon  = vec3f(0.42, 0.42, 0.48);
  let groundHi = vec3f(0.12, 0.10, 0.09);
  let groundLo = vec3f(0.04, 0.035, 0.03);

  var sky: vec3f;
  if (up > 0.0) {
    // Sky: three-stop gradient for smoother look
    let t = pow(up, 0.45);
    let lower = mix(horizon, midSky, smoothstep(0.0, 0.4, t));
    sky = mix(lower, zenith, smoothstep(0.4, 1.0, t));
  } else {
    // Ground gets sky bounce — NOT pitch black. Smooth falloff.
    let t = pow(-up, 0.3);
    sky = mix(horizon * 0.35, mix(groundHi, groundLo, t), smoothstep(0.0, 1.0, t));
  }

  // Sun: tight bright disk, softer corona, medium glow
  let sunDot = dot(dir, sunDir);
  let sunDisc = smoothstep(0.9995, 0.99995, sunDot);
  let sunCorona = pow(max(sunDot, 0.0), 512.0) * 15.0;
  let sunGlow = pow(max(sunDot, 0.0), 32.0) * 2.0;
  let sunScatter = pow(max(sunDot, 0.0), 6.0) * 0.3;
  sky += vec3f(1.0, 0.95, 0.85) * (sunDisc * sunIntensity + sunCorona + sunGlow + sunScatter);

  // Warm horizon band — visible in reflections as a feature
  let horizonGlow = pow(1.0 - abs(up), 8.0);
  sky += vec3f(0.7, 0.4, 0.18) * horizonGlow * 0.3;

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

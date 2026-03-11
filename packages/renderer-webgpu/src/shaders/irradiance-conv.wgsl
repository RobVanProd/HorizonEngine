// Diffuse irradiance convolution compute shader
// Convolves the environment cubemap over the hemisphere for each normal direction

@group(0) @binding(0) var envMap: texture_cube<f32>;
@group(0) @binding(1) var envSampler: sampler;
@group(0) @binding(2) var outIrradiance: texture_storage_2d_array<rgba16float, write>;

struct Params {
  resolution: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(3) var<uniform> params: Params;

const PI = 3.14159265359;
const SAMPLE_DELTA = 0.05;

fn clampHDR(color: vec3f, maxLum: f32) -> vec3f {
  let lum = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return select(color, color * (maxLum / lum), lum > maxLum);
}

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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = params.resolution;
  if (gid.x >= res || gid.y >= res || gid.z >= 6u) { return; }

  let uv = vec2f(
    (f32(gid.x) + 0.5) / f32(res),
    (f32(gid.y) + 0.5) / f32(res),
  );

  let normal = cubeDir(gid.z, uv);

  let upVec = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(normal.z) < 0.999);
  let right = normalize(cross(upVec, normal));
  let up = cross(normal, right);

  var irradiance = vec3f(0.0);
  var nrSamples = 0.0;

  // Uniform hemisphere sampling
  var phi = 0.0;
  loop {
    if (phi >= 2.0 * PI) { break; }
    var theta = 0.0;
    loop {
      if (theta >= 0.5 * PI) { break; }

      let tangentSample = vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      let sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal;

      let sampleColor = clampHDR(textureSampleLevel(envMap, envSampler, sampleVec, 0.0).rgb, 10.0);
      irradiance += sampleColor * cos(theta) * sin(theta);
      nrSamples += 1.0;

      theta += SAMPLE_DELTA;
    }
    phi += SAMPLE_DELTA;
  }

  irradiance = PI * irradiance / max(nrSamples, 1.0);
  textureStore(outIrradiance, vec2i(gid.xy), i32(gid.z), vec4f(irradiance, 1.0));
}

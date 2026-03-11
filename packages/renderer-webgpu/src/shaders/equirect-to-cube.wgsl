// Converts an equirectangular HDR panorama to a cubemap (6-layer 2D array).
// Each thread writes one texel of one cubemap face.

struct Params {
  resolution: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var equirect: texture_2d<f32>;
@group(0) @binding(1) var outCube: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;

const PI = 3.14159265359;

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

fn dirToEquirectUV(dir: vec3f) -> vec2f {
  let phi = atan2(dir.z, dir.x);
  let theta = asin(clamp(dir.y, -1.0, 1.0));
  return vec2f(
    phi / (2.0 * PI) + 0.5,
    0.5 - theta / PI,
  );
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
  let equirectUV = dirToEquirectUV(dir);

  // Manual bilinear sampling for rgba32float (not filterable)
  let texDims = textureDimensions(equirect, 0);
  let fx = equirectUV.x * f32(texDims.x) - 0.5;
  let fy = equirectUV.y * f32(texDims.y) - 0.5;
  let ix = i32(floor(fx));
  let iy = clamp(i32(floor(fy)), 0, i32(texDims.y) - 1);
  let fracX = fx - floor(fx);
  let fracY = fy - floor(fy);

  let ix0 = ((ix % i32(texDims.x)) + i32(texDims.x)) % i32(texDims.x);
  let ix1 = (ix0 + 1) % i32(texDims.x);
  let iy0 = clamp(iy, 0, i32(texDims.y) - 1);
  let iy1 = clamp(iy + 1, 0, i32(texDims.y) - 1);

  let c00 = textureLoad(equirect, vec2i(ix0, iy0), 0).rgb;
  let c10 = textureLoad(equirect, vec2i(ix1, iy0), 0).rgb;
  let c01 = textureLoad(equirect, vec2i(ix0, iy1), 0).rgb;
  let c11 = textureLoad(equirect, vec2i(ix1, iy1), 0).rgb;

  let color = mix(mix(c00, c10, fracX), mix(c01, c11, fracX), fracY);
  textureStore(outCube, vec2i(gid.xy), i32(gid.z), vec4f(color, 1.0));
}

// Specular pre-filter compute shader
// Importance-samples the environment cubemap for each roughness level

struct Params {
  roughness: f32,
  resolution: u32,
  sampleCount: u32,
  envResolution: u32,
};

@group(0) @binding(0) var envMap: texture_cube<f32>;
@group(0) @binding(1) var envSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var outMip: texture_storage_2d_array<rgba16float, write>;

const PI = 3.14159265359;

fn radicalInverseVdC(bits_in: u32) -> f32 {
  var bits = bits_in;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, N: u32) -> vec2f {
  return vec2f(f32(i) / f32(N), radicalInverseVdC(i));
}

fn clampHDR(color: vec3f, maxLum: f32) -> vec3f {
  let lum = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return select(color, color * (maxLum / lum), lum > maxLum);
}

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 0.0001);
}

fn importanceSampleGGX(Xi: vec2f, N: vec3f, roughness: f32) -> vec3f {
  let a = roughness * roughness;
  let phi = 2.0 * PI * Xi.x;
  let cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  let H = vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

  let upVec = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(N.z) < 0.999);
  let T = normalize(cross(upVec, N));
  let B = cross(N, T);

  return normalize(T * H.x + B * H.y + N * H.z);
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

  let N = cubeDir(gid.z, uv);
  let R = N;
  let V = R;

  var prefilteredColor = vec3f(0.0);
  var totalWeight = 0.0;

  let sampleCount = params.sampleCount;
  let roughness = params.roughness;
  let envRes = f32(params.envResolution);
  let saTexel = 4.0 * PI / (6.0 * envRes * envRes);

  for (var i = 0u; i < sampleCount; i++) {
    let Xi = hammersley(i, sampleCount);
    let H = importanceSampleGGX(Xi, N, roughness);
    let L = normalize(2.0 * dot(V, H) * H - V);

    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(V, H), 0.0);

    if (NdotL > 0.0) {
      // Filtered importance sampling: compute source mip from GGX PDF
      let D = distributionGGX(NdotH, roughness);
      let pdf = D * NdotH / (4.0 * HdotV + 0.0001);
      let saSample = 1.0 / (f32(sampleCount) * pdf + 0.0001);
      let mipLevel = select(0.5 * log2(saSample / saTexel), 0.0, roughness == 0.0);

      var sampleColor = textureSampleLevel(envMap, envSampler, L, max(mipLevel, 0.0)).rgb;
      if (roughness > 0.0) {
        sampleColor = clampHDR(sampleColor, 10.0);
      }
      prefilteredColor += sampleColor * NdotL;
      totalWeight += NdotL;
    }
  }

  prefilteredColor /= max(totalWeight, 0.001);
  textureStore(outMip, vec2i(gid.xy), i32(gid.z), vec4f(prefilteredColor, 1.0));
}

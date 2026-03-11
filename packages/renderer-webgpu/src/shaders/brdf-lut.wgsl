// BRDF integration LUT compute shader
// Pre-computes the split-sum BRDF lookup table for IBL specular

@group(0) @binding(0) var outLUT: texture_storage_2d<rgba16float, write>;

struct Params {
  resolution: u32,
  sampleCount: u32,
  _pad: vec2u,
};

@group(0) @binding(1) var<uniform> params: Params;

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

fn importanceSampleGGX(Xi: vec2f, N: vec3f, roughness: f32) -> vec3f {
  let a = roughness * roughness;
  let phi = 2.0 * PI * Xi.x;
  let cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  return vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
  let a = roughness;
  let k = (a * a) / 2.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = params.resolution;
  if (gid.x >= res || gid.y >= res) { return; }

  let NdotV = max((f32(gid.x) + 0.5) / f32(res), 0.001);
  let roughness = max((f32(gid.y) + 0.5) / f32(res), 0.001);

  let V = vec3f(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
  let N = vec3f(0.0, 0.0, 1.0);

  var A = 0.0;
  var B = 0.0;

  let sampleCount = params.sampleCount;
  for (var i = 0u; i < sampleCount; i++) {
    let Xi = hammersley(i, sampleCount);
    let H = importanceSampleGGX(Xi, N, roughness);
    let L = normalize(2.0 * dot(V, H) * H - V);

    let NdotL = max(L.z, 0.0);
    let NdotH = max(H.z, 0.0);
    let VdotH = max(dot(V, H), 0.0);

    if (NdotL > 0.0) {
      let G = geometrySmith(NdotV, NdotL, roughness);
      let G_Vis = (G * VdotH) / (NdotH * NdotV);
      let Fc = pow(1.0 - VdotH, 5.0);

      A += (1.0 - Fc) * G_Vis;
      B += Fc * G_Vis;
    }
  }

  A /= f32(sampleCount);
  B /= f32(sampleCount);

  textureStore(outLUT, vec2i(gid.xy), vec4f(A, B, 0.0, 1.0));
}

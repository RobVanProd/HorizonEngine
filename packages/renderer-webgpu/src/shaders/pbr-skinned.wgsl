// Skinned Cook-Torrance PBR with IBL + shadow mapping
// Same as pbr.wgsl but with GPU vertex skinning via joint matrices

struct CameraUniforms {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
  position: vec3f,
  _pad: f32,
};

struct LightUniforms {
  dirDirection: vec3f,
  _pad0: f32,
  dirColor: vec3f,
  dirIntensity: f32,
  ambient: vec3f,
  shadowEnabled: f32,
  lightViewProj: mat4x4f,
  envIntensity: f32,
  maxReflectionLod: f32,
  _pad2: vec2f,
};

struct MaterialUniforms {
  albedo: vec4f,
  emissive: vec3f,
  metallic: f32,
  roughnessAo: vec2f,
  hasAlbedoTex: f32,
  hasNormalTex: f32,
  hasMRTex: f32,
  hasEmissiveTex: f32,
  _pad: vec2f,
};

struct ModelUniforms {
  model: mat4x4f,
  normalMatrix: mat4x4f,
};

struct JointMatrices {
  matrices: array<mat4x4f, 256>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

@group(1) @binding(0) var<uniform> light: LightUniforms;
@group(1) @binding(1) var irradianceMap: texture_cube<f32>;
@group(1) @binding(2) var prefilteredMap: texture_cube<f32>;
@group(1) @binding(3) var brdfLUT: texture_2d<f32>;
@group(1) @binding(4) var shadowMap: texture_depth_2d;
@group(1) @binding(5) var envSampler: sampler;
@group(1) @binding(6) var shadowSampler: sampler_comparison;

@group(2) @binding(0) var<uniform> material: MaterialUniforms;
@group(2) @binding(1) var albedoTex: texture_2d<f32>;
@group(2) @binding(2) var normalTex: texture_2d<f32>;
@group(2) @binding(3) var mrTex: texture_2d<f32>;
@group(2) @binding(4) var emissiveTex: texture_2d<f32>;
@group(2) @binding(5) var texSampler: sampler;

@group(3) @binding(0) var<uniform> object: ModelUniforms;
@group(3) @binding(1) var<storage, read> joints: JointMatrices;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec4f,
  @location(4) jointIndices: vec4u,
  @location(5) jointWeights: vec4f,
};

struct VertexOutput {
  @builtin(position) clipPos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) uv: vec2f,
  @location(3) worldTangent: vec3f,
  @location(4) bitangentSign: f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  // Blend skin matrices from 4 joints
  let w = in.jointWeights;
  let skinMat = joints.matrices[in.jointIndices.x] * w.x
              + joints.matrices[in.jointIndices.y] * w.y
              + joints.matrices[in.jointIndices.z] * w.z
              + joints.matrices[in.jointIndices.w] * w.w;

  let skinnedPos = skinMat * vec4f(in.position, 1.0);
  let skinnedNormal = (skinMat * vec4f(in.normal, 0.0)).xyz;
  let skinnedTangent = (skinMat * vec4f(in.tangent.xyz, 0.0)).xyz;

  let worldPos = object.model * skinnedPos;
  var out: VertexOutput;
  out.clipPos = camera.viewProjection * worldPos;
  out.worldPos = worldPos.xyz;
  out.worldNormal = normalize((object.normalMatrix * vec4f(skinnedNormal, 0.0)).xyz);
  out.uv = in.uv;
  out.worldTangent = normalize((object.model * vec4f(skinnedTangent, 0.0)).xyz);
  out.bitangentSign = in.tangent.w;
  return out;
}

// ─── Fragment shader (identical to static PBR) ──────────────────

const PI = 3.14159265359;

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

fn geometrySchlickGGX(cosTheta: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return cosTheta / (cosTheta * (1.0 - k) + k);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn fresnelSchlickRoughness(cosTheta: f32, F0: vec3f, roughness: f32) -> vec3f {
  return F0 + (max(vec3f(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn computeShadow(worldPos: vec3f) -> f32 {
  if (light.shadowEnabled < 0.5) { return 1.0; }
  let lightClip = light.lightViewProj * vec4f(worldPos, 1.0);
  let ndc = lightClip.xyz / lightClip.w;
  let shadowUV = ndc.xy * vec2f(0.5, -0.5) + 0.5;
  let currentDepth = ndc.z;
  var shadow = 0.0;
  let texelSize = 1.0 / 2048.0;
  for (var x = -1i; x <= 1i; x++) {
    for (var y = -1i; y <= 1i; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize;
      let uv = shadowUV + offset;
      shadow += textureSampleCompareLevel(shadowMap, shadowSampler, uv, currentDepth - 0.003);
    }
  }
  let inBounds = step(0.0, shadowUV.x) * step(shadowUV.x, 1.0) *
                 step(0.0, shadowUV.y) * step(shadowUV.y, 1.0);
  return mix(1.0, shadow / 9.0, inBounds);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  var N = normalize(in.worldNormal);
  if (material.hasNormalTex > 0.5) {
    let T = normalize(in.worldTangent);
    let B = cross(N, T) * in.bitangentSign;
    let TBN = mat3x3f(T, B, N);
    let ns = textureSample(normalTex, texSampler, in.uv).xyz * 2.0 - 1.0;
    N = normalize(TBN * ns);
  }

  var albedo = material.albedo.rgb;
  if (material.hasAlbedoTex > 0.5) {
    albedo *= textureSample(albedoTex, texSampler, in.uv).rgb;
  }

  var metallic = material.metallic;
  var roughness = material.roughnessAo.x;
  if (material.hasMRTex > 0.5) {
    let mr = textureSample(mrTex, texSampler, in.uv);
    roughness *= mr.g;
    metallic *= mr.b;
  }

  var emissive = material.emissive;
  if (material.hasEmissiveTex > 0.5) {
    emissive *= textureSample(emissiveTex, texSampler, in.uv).rgb;
  }

  let dNdx = dpdx(N);
  let dNdy = dpdy(N);
  let normalVariance = dot(dNdx, dNdx) + dot(dNdy, dNdy);
  let kernelRoughness2 = min(2.0 * normalVariance, 0.18);
  roughness = sqrt(clamp(roughness * roughness + kernelRoughness2, 0.0, 1.0));

  roughness = clamp(roughness, 0.04, 1.0);
  let ao = material.roughnessAo.y;

  let V = normalize(camera.position - in.worldPos);
  let NdotV = max(dot(N, V), 0.001);
  let F0 = mix(vec3f(0.04), albedo, metallic);

  let L = normalize(-light.dirDirection);
  let H = normalize(V + L);
  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let HdotV = max(dot(H, V), 0.0);

  let D = distributionGGX(NdotH, roughness);
  let G = geometrySmith(NdotV, NdotL, roughness);
  let F = fresnelSchlick(HdotV, F0);

  let spec = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
  let kD = (1.0 - F) * (1.0 - metallic);
  let diffuse = kD * albedo / PI;

  let radiance = light.dirColor * light.dirIntensity;
  let shadow = computeShadow(in.worldPos);
  var Lo = (diffuse + spec) * radiance * NdotL * shadow;

  var iblColor = vec3f(0.0);
  if (light.envIntensity > 0.0) {
    let F_ibl = fresnelSchlickRoughness(NdotV, F0, roughness);
    let kD_ibl = (1.0 - F_ibl) * (1.0 - metallic);
    let irradiance = textureSample(irradianceMap, envSampler, N).rgb;
    let diffuseIBL = irradiance * albedo * kD_ibl;
    let R = reflect(-V, N);
    let prefilteredColor = textureSampleLevel(prefilteredMap, envSampler, R, roughness * light.maxReflectionLod).rgb;
    let brdf = textureSample(brdfLUT, envSampler, vec2f(NdotV, roughness)).rg;
    let specularIBL = prefilteredColor * (F_ibl * brdf.x + brdf.y);
    iblColor = (diffuseIBL + specularIBL) * light.envIntensity * ao;
  } else {
    iblColor = light.ambient * albedo * ao;
  }

  var color = Lo + iblColor + emissive;
  color = aces(color);
  color = pow(color, vec3f(1.0 / 2.2));
  return vec4f(color, material.albedo.a);
}

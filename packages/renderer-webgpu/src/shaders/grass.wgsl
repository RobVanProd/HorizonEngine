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
  shadowBias: f32,
  debugView: f32,
  pointPositionRange: array<vec4f, 4>,
  pointColorIntensity: array<vec4f, 4>,
};

struct GrassUniforms {
  baseColor: vec4f,
  tipColor: vec4f,
  wind: vec4f,
  shading: vec4f,
};

struct ModelUniforms {
  model: mat4x4f,
  normalMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> light: LightUniforms;
@group(2) @binding(0) var<uniform> grass: GrassUniforms;
@group(3) @binding(0) var<uniform> object: ModelUniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) tangent: vec4f,
};

struct VertexOutput {
  @builtin(position) clipPos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) fieldUv: vec2f,
  @location(3) bladeData: vec3f,
};

fn fieldPattern(uv: vec2f) -> f32 {
  let fieldFreq = 4.0 + grass.shading.z * 80.0;
  let broad = sin(uv.x * fieldFreq * 1.15 + uv.y * fieldFreq * 0.28);
  let streak = cos(uv.y * fieldFreq * 2.1 - uv.x * fieldFreq * 0.48);
  let patch = sin((uv.x + uv.y * 0.62) * fieldFreq * 0.52);
  return clamp(broad * 0.24 + streak * 0.18 + patch * 0.12 + 0.5, 0.0, 1.0);
}

fn cloudShadow(uv: vec2f) -> f32 {
  let t = grass.wind.w * 0.02;
  let cloudFreq = 1.0 + grass.shading.z * 18.0;
  let drift = sin((uv.x + t) * cloudFreq * 1.2) * cos((uv.y - t * 0.6) * cloudFreq);
  return clamp(drift * 0.5 + 0.5, 0.0, 1.0);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  var localPos = in.position;
  let swayWeight = clamp(in.tangent.x, 0.0, 1.0);
  let phase = in.tangent.y;
  let bladeRandom = in.tangent.z;
  let time = grass.wind.w * grass.wind.z;
  let windFreq = 6.0 + grass.wind.y * 120.0;
  let waveA = sin((in.uv.x * windFreq * 1.6 + in.uv.y * windFreq) + phase * 6.28318 + time);
  let waveB = cos((in.uv.x * windFreq * 0.72 - in.uv.y * windFreq * 1.14) + bladeRandom * 5.0 + time * 0.72);
  let displacement = (waveA * 0.72 + waveB * 0.28) * grass.wind.x * swayWeight;
  localPos.x += displacement;
  localPos.z += displacement * 0.32;
  localPos.y -= abs(displacement) * 0.04 * swayWeight;

  let worldPos = object.model * vec4f(localPos, 1.0);
  out.clipPos = camera.viewProjection * worldPos;
  out.worldPos = worldPos.xyz;
  out.worldNormal = normalize((object.normalMatrix * vec4f(in.normal, 0.0)).xyz);
  out.fieldUv = in.uv;
  out.bladeData = vec3f(swayWeight, phase, bladeRandom);
  return out;
}

@fragment
fn fs_main(in: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  let N = normalize(select(-in.worldNormal, in.worldNormal, frontFacing));
  let L = normalize(-light.dirDirection);
  let heightT = clamp(in.bladeData.x, 0.0, 1.0);
  let halfLambert = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  let translucency = max(dot(-N, L), 0.0) * grass.shading.y;
  let patchMask = fieldPattern(in.fieldUv);
  let shadowMask = cloudShadow(in.fieldUv);
  let clarity = mix(0.58, 1.0, heightT);
  let fieldTint = mix(vec3f(0.84, 0.98, 0.88), vec3f(1.1, 1.08, 0.94), patchMask);
  let cloudTint = mix(0.88, 1.06, shadowMask);
  let base = mix(grass.baseColor.rgb, grass.tipColor.rgb, heightT);
  var color = base * fieldTint * cloudTint;
  color *= mix(0.92, 1.06, in.bladeData.z);
  let lighting = grass.shading.x + halfLambert * 0.44 + translucency * 0.18;
  return vec4f(color * clarity * lighting * light.dirColor * light.dirIntensity * 0.16 + color * light.ambient, 1.0);
}

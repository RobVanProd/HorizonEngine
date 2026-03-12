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
  @location(2) bladeUv: vec2f,
};

fn bladeWind(worldXZ: vec2f, phase: f32, heightFactor: f32) -> vec2f {
  let time = grass.wind.w * grass.wind.z;
  let gustA = sin(worldXZ.x * grass.wind.y + phase * 7.0 + time);
  let gustB = cos(worldXZ.y * grass.wind.y * 0.78 - phase * 5.0 + time * 0.82);
  let gustC = sin((worldXZ.x + worldXZ.y) * grass.shading.z * 0.45 + time * 0.55);
  let bend = grass.wind.x * heightFactor * heightFactor * (gustA * 0.55 + gustB * 0.3 + gustC * 0.15);
  return vec2f(bend, bend * 0.45);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  var localPos = in.position;
  let rootWorld = object.model * vec4f(vec3f(in.position.x, 0.0, in.position.z), 1.0);
  let offset = bladeWind(rootWorld.xz, in.uv.x, clamp(in.uv.y, 0.0, 1.0));
  localPos.x += offset.x;
  localPos.z += offset.y;
  localPos.y -= length(offset) * 0.06 * in.uv.y;

  let worldPos = object.model * vec4f(localPos, 1.0);
  out.clipPos = camera.viewProjection * worldPos;
  out.worldPos = worldPos.xyz;
  out.worldNormal = normalize((object.normalMatrix * vec4f(in.normal, 0.0)).xyz);
  out.bladeUv = in.uv;
  return out;
}

fn patchNoise(pos: vec2f) -> f32 {
  let n = sin(pos.x * grass.shading.z + pos.y * grass.shading.z * 0.73 + grass.wind.w * 0.09);
  let m = cos(pos.y * grass.shading.z * 0.61 - pos.x * grass.shading.z * 0.37);
  return n * m * 0.5 + 0.5;
}

@fragment
fn fs_main(in: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  let N = normalize(select(-in.worldNormal, in.worldNormal, frontFacing));
  let L = normalize(-light.dirDirection);
  let V = normalize(camera.position - in.worldPos);
  let halfLambert = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  let rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
  let translucency = max(dot(-N, L), 0.0) * grass.shading.y;
  let patch = mix(0.82, 1.14, patchNoise(in.worldPos.xz));
  let heightT = smoothstep(0.0, 1.0, in.bladeUv.y);
  let base = grass.baseColor.rgb * mix(0.76, 0.92, heightT);
  let tip = grass.tipColor.rgb * mix(0.94, 1.1, patch);
  var color = mix(base, tip, heightT);
  color *= mix(0.72, 1.0, patch);
  let lighting = grass.shading.x + halfLambert * 0.82 + translucency * 0.45 + rim * 0.08;
  return vec4f(color * lighting * light.dirColor * light.dirIntensity * 0.16 + color * light.ambient, 1.0);
}

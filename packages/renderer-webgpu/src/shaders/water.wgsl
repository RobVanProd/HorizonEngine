// Water shader inspired by Three.js ocean example
// Gerstner waves for vertex displacement + Fresnel + environment reflection

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
};

struct WaterUniforms {
  time: f32,
  waveScale: f32,
  waveStrength: f32,
  waveSpeed: f32,
  shallowColor: vec3f,
  edgeFade: f32,
  deepColor: vec3f,
  clarity: f32,
  foamColor: vec3f,
  foamAmount: f32,
};

struct ModelUniforms {
  model: mat4x4f,
  normalMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> light: LightUniforms;
@group(1) @binding(1) var prefilteredMap: texture_cube<f32>;
@group(1) @binding(2) var envSampler: sampler;
@group(2) @binding(0) var<uniform> water: WaterUniforms;
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
  @location(2) uv: vec2f,
  @location(3) waveHeight: f32,
};

// Single wave: returns (height, dHeight/dx, dHeight/dz)
fn wave(pos: vec2f, direction: vec2f, wavelength: f32, amplitude: f32, time: f32) -> vec3f {
  let k = 6.28318530718 / max(wavelength, 0.001);
  let c = sqrt(9.8 / k);
  let d = normalize(direction);
  let f = k * (dot(d, pos) - c * time);
  let cosF = cos(f);
  let sinF = sin(f);
  let height = amplitude * sinF;
  let dHeight = amplitude * k * cosF;
  return vec3f(height, d * dHeight);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  let scale = water.waveScale;
  let strength = water.waveStrength;
  let t = water.time * max(water.waveSpeed, 0.01);
  let pos2 = vec2f(in.position.x, in.position.z) * scale;

  var height = 0.0;
  var dHeightDx = 0.0;
  var dHeightDz = 0.0;

  let w1 = wave(pos2, vec2f(1.0, 0.3), 8.0, 0.15 * strength, t);
  height += w1.x;
  dHeightDx += w1.y;
  dHeightDz += w1.z;

  let w2 = wave(pos2, vec2f(-0.5, 0.8), 6.0, 0.1 * strength, t * 1.1);
  height += w2.x;
  dHeightDx += w2.y;
  dHeightDz += w2.z;

  let w3 = wave(pos2, vec2f(0.7, -0.4), 10.0, 0.08 * strength, t * 0.9);
  height += w3.x;
  dHeightDx += w3.y;
  dHeightDz += w3.z;

  let displacedPos = in.position + vec3f(0.0, height, 0.0);
  let worldPos = object.model * vec4f(displacedPos, 1.0);

  let tangent = vec3f(1.0, dHeightDx, 0.0);
  let binormal = vec3f(0.0, dHeightDz, 1.0);
  let localNormal = normalize(cross(binormal, tangent));
  let worldNormal = normalize((object.normalMatrix * vec4f(localNormal, 0.0)).xyz);

  var out: VertexOutput;
  out.clipPos = camera.viewProjection * worldPos;
  out.worldPos = worldPos.xyz;
  out.worldNormal = worldNormal;
  out.uv = in.uv;
  out.waveHeight = height;
  return out;
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (1.0 - F0) * pow(max(1.0 - cosTheta, 0.0), 5.0);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn hash12(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn edgeMask(uv: vec2f, edgeFade: f32, worldPos: vec3f, time: f32) -> f32 {
  let edgeDistance = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let jitter = hash12(floor(worldPos.xz * 0.12) + vec2f(time * 0.15, -time * 0.11));
  let fadeWidth = max(0.015, edgeFade * mix(0.65, 1.15, jitter));
  return smoothstep(0.0, fadeWidth, edgeDistance);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let V = normalize(camera.position - in.worldPos);
  let N = in.worldNormal;

  let NdotV = max(dot(N, V), 0.001);
  let R = reflect(-V, N);
  let shoreMask = edgeMask(in.uv, water.edgeFade, in.worldPos, water.time);

  let F0 = vec3f(0.02, 0.02, 0.02);
  let F = fresnelSchlick(NdotV, F0);
  let reflection = textureSampleLevel(prefilteredMap, envSampler, R, 0.0).rgb;
  let shallowMix = clamp((1.0 - NdotV) * water.clarity + in.waveHeight * 0.45 + (1.0 - shoreMask) * 0.8, 0.0, 1.0);
  let waterColor = mix(water.shallowColor, water.deepColor, clamp(shallowMix, 0.0, 1.0));

  let L = normalize(-light.dirDirection);
  let H = normalize(V + L);
  let NdotH = max(dot(N, H), 0.0);
  let specular = pow(NdotH, 128.0) * light.dirColor * light.dirIntensity * 2.0;
  let foamNoise = hash12(in.worldPos.xz * 0.35 + vec2f(water.time * 0.6, -water.time * 0.45));
  let foam = (1.0 - shoreMask) * water.foamAmount * mix(0.55, 1.0, foamNoise);
  let glint = pow(max(dot(normalize(L + V), N), 0.0), 220.0) * 0.8;

  var color = mix(waterColor, reflection, F) + specular + water.foamColor * foam + glint;

  color = aces(color);
  color = pow(color, vec3f(1.0 / 2.2));

  let alpha = clamp(0.42 + F.x * 0.38 + shoreMask * 0.12, 0.35, 0.9);
  return vec4f(color, alpha * shoreMask);
}

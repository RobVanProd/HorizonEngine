struct CameraUniforms {
  viewProjection: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

struct InstanceData {
  @location(3) model0: vec4<f32>,
  @location(4) model1: vec4<f32>,
  @location(5) model2: vec4<f32>,
  @location(6) model3: vec4<f32>,
  @location(7) color: vec4<f32>,
};

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(vert: VertexInput, inst: InstanceData) -> VertexOutput {
  let model = mat4x4<f32>(inst.model0, inst.model1, inst.model2, inst.model3);
  let worldPos = model * vec4<f32>(vert.position, 1.0);
  let worldNorm = normalize((model * vec4<f32>(vert.normal, 0.0)).xyz);

  var out: VertexOutput;
  out.clipPosition = camera.viewProjection * worldPos;
  out.worldNormal = worldNorm;
  out.worldPosition = worldPos.xyz;
  out.color = inst.color;
  return out;
}

const LIGHT_DIR: vec3<f32> = vec3<f32>(0.4, 0.8, 0.3);
const AMBIENT: f32 = 0.15;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let L = normalize(LIGHT_DIR);
  let NdotL = max(dot(N, L), 0.0);
  let diffuse = NdotL * 0.85 + AMBIENT;
  return vec4<f32>(in.color.rgb * diffuse, in.color.a);
}

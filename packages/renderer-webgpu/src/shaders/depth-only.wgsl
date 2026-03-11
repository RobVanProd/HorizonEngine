// Depth-only pre-pass shader for HZB generation.
// Same vertex transform as the main shader but no color output.

struct CameraUniforms {
  viewProjection: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  _pad: f32,
};

struct InstanceData {
  model_0: vec4<f32>,
  model_1: vec4<f32>,
  model_2: vec4<f32>,
  model_3: vec4<f32>,
  bound_center: vec3<f32>,
  bound_radius: f32,
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> instances: array<InstanceData>;
@group(1) @binding(1) var<storage, read> visible_indices: array<u32>;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(
  vert: VertexInput,
  @builtin(instance_index) instanceIdx: u32,
) -> @builtin(position) vec4<f32> {
  let realIdx = visible_indices[instanceIdx];
  let inst = instances[realIdx];
  let model = mat4x4<f32>(inst.model_0, inst.model_1, inst.model_2, inst.model_3);
  let worldPos = model * vec4<f32>(vert.position, 1.0);
  return camera.viewProjection * worldPos;
}

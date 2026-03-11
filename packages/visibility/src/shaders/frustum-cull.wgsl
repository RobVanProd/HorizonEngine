// GPU frustum culling compute shader.
// Tests each instance's world-space bounding sphere against 6 frustum planes.
// Visible instances are compacted into an output buffer via atomic append.

struct InstanceBounds {
  model_0: vec4<f32>,
  model_1: vec4<f32>,
  model_2: vec4<f32>,
  model_3: vec4<f32>,
  bound_center: vec3<f32>,
  bound_radius: f32,
  color: vec4<f32>,
};

struct FrustumUniforms {
  planes: array<vec4<f32>, 6>,
  instance_count: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct DrawIndirectArgs {
  index_count: atomic<u32>,
  instance_count: atomic<u32>,
  first_index: u32,
  base_vertex: u32,
  first_instance: u32,
};

@group(0) @binding(0) var<storage, read> instances: array<InstanceBounds>;
@group(0) @binding(1) var<uniform> frustum: FrustumUniforms;
@group(0) @binding(2) var<storage, read_write> visible_indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> draw_args: DrawIndirectArgs;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= frustum.instance_count) {
    return;
  }

  let inst = instances[idx];

  // Transform bounding sphere center to world space
  let model = mat4x4<f32>(inst.model_0, inst.model_1, inst.model_2, inst.model_3);
  let world_center = (model * vec4<f32>(inst.bound_center, 1.0)).xyz;

  // Approximate max scale factor for radius scaling
  let sx = length(inst.model_0.xyz);
  let sy = length(inst.model_1.xyz);
  let sz = length(inst.model_2.xyz);
  let max_scale = max(sx, max(sy, sz));
  let world_radius = inst.bound_radius * max_scale;

  // Test against all 6 frustum planes
  var visible = true;
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = frustum.planes[p];
    let dist = dot(plane.xyz, world_center) + plane.w;
    if (dist < -world_radius) {
      visible = false;
      break;
    }
  }

  if (visible) {
    let slot = atomicAdd(&draw_args.instance_count, 1u);
    visible_indices[slot] = idx;
  }
}

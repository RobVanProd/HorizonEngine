// Occlusion culling using hierarchical Z-buffer.
// Tests each instance's projected bounding sphere against the depth pyramid.
// Only instances that passed frustum culling are tested.

struct InstanceBounds {
  model_0: vec4<f32>,
  model_1: vec4<f32>,
  model_2: vec4<f32>,
  model_3: vec4<f32>,
  bound_center: vec3<f32>,
  bound_radius: f32,
  color: vec4<f32>,
};

struct OcclusionUniforms {
  view_projection: mat4x4<f32>,
  screen_size: vec2<f32>,
  near_plane: f32,
  hzb_mip_count: u32,
  visible_count: u32,
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
@group(0) @binding(1) var<uniform> params: OcclusionUniforms;
@group(0) @binding(2) var<storage, read> input_visible: array<u32>;
@group(0) @binding(3) var<storage, read_write> output_visible: array<u32>;
@group(0) @binding(4) var<storage, read_write> draw_args: DrawIndirectArgs;
@group(0) @binding(5) var hzb: texture_2d<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.visible_count) {
    return;
  }

  let inst_idx = input_visible[gid.x];
  let inst = instances[inst_idx];

  let model = mat4x4<f32>(inst.model_0, inst.model_1, inst.model_2, inst.model_3);
  let world_center = (model * vec4<f32>(inst.bound_center, 1.0)).xyz;

  let sx = length(inst.model_0.xyz);
  let sy = length(inst.model_1.xyz);
  let sz = length(inst.model_2.xyz);
  let max_scale = max(sx, max(sy, sz));
  let world_radius = inst.bound_radius * max_scale;

  // Project sphere center to clip space
  let clip = params.view_projection * vec4<f32>(world_center, 1.0);

  // Skip objects behind the camera
  if (clip.w <= 0.0) {
    let slot = atomicAdd(&draw_args.instance_count, 1u);
    output_visible[slot] = inst_idx;
    return;
  }

  let ndc = clip.xyz / clip.w;

  // Compute projected radius in screen pixels
  let proj_radius = (world_radius * params.screen_size.y * 0.5) / clip.w;

  // Determine which HZB mip level to sample (covers the projected extent)
  let diameter_pixels = proj_radius * 2.0;
  let mip_f = max(0.0, log2(max(1.0, diameter_pixels)));
  let mip = min(u32(mip_f), params.hzb_mip_count - 1u);

  // Convert NDC to UV [0,1]
  let uv = ndc.xy * 0.5 + 0.5;
  let screen_uv = vec2<f32>(uv.x, 1.0 - uv.y);

  // Sample HZB at the computed mip level
  let mip_size = textureDimensions(hzb, mip);
  let texel = vec2<i32>(screen_uv * vec2<f32>(mip_size));
  let clamped = clamp(texel, vec2<i32>(0), vec2<i32>(mip_size) - vec2<i32>(1));
  let hzb_depth = textureLoad(hzb, clamped, mip).r;

  // Compute the nearest depth of the bounding sphere
  // In reverse-Z: closer objects have larger depth values
  // In standard Z (which we use): closer objects have smaller depth values
  let sphere_near_depth = ndc.z - (world_radius * params.near_plane / clip.w);

  // If the sphere's nearest depth is farther than the HZB depth, it's occluded
  // Standard Z: smaller = closer. Object occluded if sphere_near_depth > hzb_depth.
  let occluded = sphere_near_depth > hzb_depth;

  if (!occluded) {
    let slot = atomicAdd(&draw_args.instance_count, 1u);
    output_visible[slot] = inst_idx;
  }
}

// Hierarchical Z-Buffer mip chain generation.
// Each invocation reads a 2x2 block from the source mip and writes
// the maximum depth to the destination mip (conservative occlusion).

@group(0) @binding(0) var src_mip: texture_2d<f32>;
@group(0) @binding(1) var dst_mip: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dst_size = textureDimensions(dst_mip);
  if (gid.x >= dst_size.x || gid.y >= dst_size.y) {
    return;
  }

  let src_coord = vec2<i32>(gid.xy) * 2;

  let d00 = textureLoad(src_mip, src_coord + vec2<i32>(0, 0), 0).r;
  let d10 = textureLoad(src_mip, src_coord + vec2<i32>(1, 0), 0).r;
  let d01 = textureLoad(src_mip, src_coord + vec2<i32>(0, 1), 0).r;
  let d11 = textureLoad(src_mip, src_coord + vec2<i32>(1, 1), 0).r;

  let max_depth = max(max(d00, d10), max(d01, d11));

  textureStore(dst_mip, vec2<i32>(gid.xy), vec4<f32>(max_depth, 0.0, 0.0, 1.0));
}

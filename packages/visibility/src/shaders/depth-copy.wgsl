// Copy depth texture to r32float texture for HZB mip 0.
// Depth textures can't be used as storage, so we sample and write to a float texture.

@group(0) @binding(0) var depth_tex: texture_depth_2d;
@group(0) @binding(1) var dst_tex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(dst_tex);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let depth = textureLoad(depth_tex, vec2<i32>(gid.xy), 0);
  textureStore(dst_tex, vec2<i32>(gid.xy), vec4<f32>(depth, 0.0, 0.0, 1.0));
}

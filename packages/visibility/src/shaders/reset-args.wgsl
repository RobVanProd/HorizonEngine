// Reset indirect draw args before culling pass.
// Sets instanceCount to 0, preserves indexCount and other fields.

struct DrawIndirectArgs {
  index_count: u32,
  instance_count: atomic<u32>,
  first_index: u32,
  base_vertex: u32,
  first_instance: u32,
};

@group(0) @binding(0) var<storage, read_write> draw_args: DrawIndirectArgs;

@compute @workgroup_size(1)
fn main() {
  atomicStore(&draw_args.instance_count, 0u);
}

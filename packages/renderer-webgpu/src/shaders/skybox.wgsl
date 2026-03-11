// Skybox shader: renders environment cubemap as background

struct CameraUniforms {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
  position: vec3f,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var envMap: texture_cube<f32>;
@group(0) @binding(2) var envSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) dir: vec3f,
};

@vertex
fn vs_skybox(@builtin(vertex_index) idx: u32) -> VertexOutput {
  // Fullscreen triangle
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );

  var out: VertexOutput;
  let pos = positions[idx];
  out.position = vec4f(pos, 1.0, 1.0);

  // Reconstruct world direction from clip-space position
  let clipPos = vec4f(pos, 1.0, 1.0);
  let worldPos = camera.inverseViewProjection * clipPos;
  out.dir = worldPos.xyz / worldPos.w - camera.position;

  return out;
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_skybox(in: VertexOutput) -> @location(0) vec4f {
  let dir = normalize(in.dir);
  var color = textureSample(envMap, envSampler, dir).rgb;

  // Tone map + gamma (skybox renders directly to swap chain during HDR pass)
  color = aces(color);
  color = pow(color, vec3f(1.0 / 2.2));

  return vec4f(color, 1.0);
}

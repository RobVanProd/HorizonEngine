// Shadow map depth-only pass
// Renders scene from the light's perspective

struct LightVP {
  lightViewProj: mat4x4f,
};

struct ModelMatrix {
  model: mat4x4f,
};

@group(0) @binding(0) var<uniform> lightVP: LightVP;
@group(1) @binding(0) var<uniform> object: ModelMatrix;

@vertex
fn vs_shadow(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return lightVP.lightViewProj * object.model * vec4f(position, 1.0);
}

export { Renderer } from './renderer.js';
export { GpuDrivenRenderer } from './gpu-driven-renderer.js';
export { createCubeGeometry, type Geometry } from './geometry.js';
export {
  mat4Identity,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Multiply,
  mat4Translation,
  mat4Scale,
  mat4RotationY,
} from './math.js';

// Phase 3+4: PBR pipeline with IBL, shadows, skybox
export { PBRRenderer, type SceneLighting, type PointLight, type LightingDebugView } from './pbr-pipeline.js';
export { PBRMaterial, type PBRMaterialParams } from './pbr-material.js';
export {
  GPUMesh,
  PBR_VERTEX_LAYOUT,
  PBR_SKINNED_VERTEX_LAYOUT,
  PBR_VERTEX_STRIDE,
  PBR_SKINNED_VERTEX_STRIDE,
  type MeshData,
} from './mesh.js';
export { LightingState, type DirectionalLight } from './lighting.js';
export { Environment, type EnvironmentConfig } from './environment.js';
export { ShadowMap, type ShadowConfig } from './shadow-map.js';
export { createSphere, createTorus, createPlane } from './procedural.js';
export { createRenderSystem, type RenderRegistries, type RenderSystemContext } from './render-system.js';

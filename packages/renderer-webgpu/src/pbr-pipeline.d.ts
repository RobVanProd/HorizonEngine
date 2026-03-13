/**
 * PBR render pipeline with IBL, shadows, and skybox.
 *
 * Rendering flow per frame:
 *   1. Shadow depth pass (from light perspective)
 *   2. Skybox (environment cubemap at depth=1)
 *   3. PBR objects (IBL + analytical light + shadows)
 *
 * Bind group layout:
 *   Group 0: Camera (VP + inverseVP + position)
 *   Group 1: Lighting (uniform + IBL textures + shadow map + samplers)
 *   Group 2: Material (uniform + textures + sampler)
 *   Group 3: Object transform (model + normalMatrix)
 */
import type { GPUContext } from '@engine/platform';
import { PBRMaterial, type PBRMaterialParams } from './pbr-material.js';
import { GPUMesh } from './mesh.js';
import { Environment, type EnvironmentConfig } from './environment.js';
import { ShadowMap, type ShadowConfig } from './shadow-map.js';
import { GpuProfiler } from '@engine/profiler';
import { WaterMaterial } from './water-material.js';
export type LightingDebugView = 'lit' | 'normals' | 'shadow' | 'lightComplexity';
export interface FogSettings {
    color: [number, number, number];
    density: number;
    heightFalloff: number;
    startDistance: number;
    maxOpacity: number;
}
export interface PointLight {
    position: [number, number, number];
    color: [number, number, number];
    intensity: number;
    range: number;
}
export interface SceneLighting {
    direction: [number, number, number];
    color: [number, number, number];
    intensity: number;
    ambient: [number, number, number];
    envIntensity: number;
    pointLights?: PointLight[];
    shadowBias?: number;
    shadowNormalBias?: number;
    exposure?: number;
    fog?: FogSettings;
    debugView?: LightingDebugView;
}
export interface GeometryFrameStats {
    drawCount: number;
    triangleCount: number;
    meshletCount: number;
    culledObjects: number;
    culledTriangles: number;
}
export declare class PBRRenderer {
    private _gpu;
    private _pipeline;
    private _skyboxPipeline;
    private _depthTexture;
    private _depthView;
    private _cameraBuffer;
    private _cameraBindGroup;
    private _lightBuffer;
    private _lightBindGroup;
    private _materialLayout;
    private _objectBuffers;
    private _objectBindGroups;
    private _environment;
    private _shadowMap;
    private _skyboxBindGroup;
    private _skinnedPipeline;
    private _skinnedObjectLayout;
    private _jointBuffers;
    private _skinnedObjectBindGroups;
    private _draws;
    private _waterDraws;
    private _waterPipeline;
    private _waterLightBindGroup;
    private _waterObjectBuffers;
    private _waterObjectBindGroups;
    private _waterMaterialLayout;
    private _frameStats;
    private _initialized;
    private _gpuProfiler;
    private _profilingEnabled;
    constructor(gpu: GPUContext);
    get materialLayout(): GPUBindGroupLayout;
    get waterMaterialLayout(): GPUBindGroupLayout;
    get device(): GPUDevice;
    get environment(): Environment | null;
    get shadowMap(): ShadowMap | null;
    get gpuProfiler(): GpuProfiler | null;
    get frameStats(): GeometryFrameStats;
    /** Enable GPU timestamp profiling (requires 'timestamp-query' device feature). */
    enableProfiling(): void;
    disableProfiling(): void;
    initialize(envConfig?: EnvironmentConfig, shadowConfig?: ShadowConfig): Promise<void>;
    createMaterial(params?: PBRMaterialParams): PBRMaterial;
    createWaterMaterial(params?: {
        waveScale?: number;
        waveStrength?: number;
    }): WaterMaterial;
    drawWaterMesh(mesh: GPUMesh, material: WaterMaterial, modelMatrix: Float32Array): void;
    setCamera(viewProjection: Float32Array, position: [number, number, number]): void;
    setLighting(lighting: SceneLighting): void;
    beginFrame(): void;
    drawMesh(mesh: GPUMesh, material: PBRMaterial, modelMatrix: Float32Array): void;
    /**
     * Draw a skinned mesh with joint matrices.
     * jointMatrices: flat Float32Array of mat4x4f per joint (joint_count * 16 floats).
     */
    drawSkinnedMesh(mesh: GPUMesh, material: PBRMaterial, modelMatrix: Float32Array, jointMatrices: Float32Array): void;
    recordCulledMesh(mesh: GPUMesh): void;
    endFrame(afterMainPass?: (pass: GPURenderPassEncoder) => void): void;
    handleResize(): void;
    destroy(): void;
    private _createDepthTexture;
    private _ensureDepthSize;
}
//# sourceMappingURL=pbr-pipeline.d.ts.map

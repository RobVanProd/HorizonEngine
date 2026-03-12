/**
 * Directional shadow mapping.
 * Renders scene depth from the light's orthographic perspective.
 */
import { GPUMesh } from './mesh.js';
export interface ShadowConfig {
    resolution?: number;
    frustumSize?: number;
    near?: number;
    far?: number;
    followCamera?: boolean;
    stabilize?: boolean;
}
export declare class ShadowMap {
    readonly texture: GPUTexture;
    readonly textureView: GPUTextureView;
    readonly sampler: GPUSampler;
    readonly resolution: number;
    readonly lightViewProj: Float32Array;
    private _device;
    private _pipeline;
    private _lightVPBuffer;
    private _lightVPBindGroup;
    private _lightVPLayout;
    private _objectLayout;
    private _objectBuffers;
    private _objectBindGroups;
    private _frustumSize;
    private _near;
    private _far;
    constructor(device: GPUDevice, config?: ShadowConfig);
    private _initPipeline;
    /**
     * Update the light view-projection matrix from light direction.
     * The light looks toward either the active camera focus or the supplied target.
     */
    updateLightDirection(direction: [number, number, number], target?: [number, number, number], cameraPosition?: [number, number, number]): void;
    /**
     * Render shadow map. Call before the main PBR pass.
     */
    render(encoder: GPUCommandEncoder, meshes: {
        mesh: GPUMesh;
        modelMatrix: Float32Array;
    }[]): void;
    destroy(): void;
}
//# sourceMappingURL=shadow-map.d.ts.map

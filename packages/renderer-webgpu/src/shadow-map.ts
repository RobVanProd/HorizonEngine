/**
 * Directional shadow mapping.
 * Renders scene depth from the light's orthographic perspective.
 */

import { mat4LookAt, mat4Ortho, mat4Multiply } from './math.js';
import { GPUMesh, PBR_VERTEX_LAYOUT } from './mesh.js';
import shadowDepthSource from './shaders/shadow-depth.wgsl?raw';

export interface ShadowConfig {
  resolution?: number;
  frustumSize?: number;
  near?: number;
  far?: number;
  followCamera?: boolean;
  stabilize?: boolean;
}

export class ShadowMap {
  readonly texture: GPUTexture;
  readonly textureView: GPUTextureView;
  readonly sampler: GPUSampler;
  readonly resolution: number;
  readonly lightViewProj: Float32Array = new Float32Array(16);

  private _device: GPUDevice;
  private _pipeline!: GPURenderPipeline;
  private _lightVPBuffer: GPUBuffer;
  private _lightVPBindGroup!: GPUBindGroup;
  private _lightVPLayout!: GPUBindGroupLayout;
  private _objectLayout!: GPUBindGroupLayout;
  private _objectBuffers: GPUBuffer[] = [];
  private _objectBindGroups: GPUBindGroup[] = [];
  private _frustumSize: number;
  private _near: number;
  private _far: number;
  private _followCamera: boolean;
  private _stabilize: boolean;

  constructor(device: GPUDevice, config: ShadowConfig = {}) {
    this._device = device;
    this.resolution = config.resolution ?? 2048;
    this._frustumSize = config.frustumSize ?? 60;
    this._near = config.near ?? 0.1;
    this._far = config.far ?? 150;
    this._followCamera = config.followCamera ?? true;
    this._stabilize = config.stabilize ?? true;

    this.texture = device.createTexture({
      size: [this.resolution, this.resolution],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.textureView = this.texture.createView();

    this.sampler = device.createSampler({
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this._lightVPBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._initPipeline();
  }

  private _initPipeline(): void {
    const device = this._device;
    const module = device.createShaderModule({ code: shadowDepthSource });

    this._lightVPLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    this._lightVPBindGroup = device.createBindGroup({
      layout: this._lightVPLayout,
      entries: [{ binding: 0, resource: { buffer: this._lightVPBuffer } }],
    });

    this._objectLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    // Pre-allocate object buffers
    const MAX = 256;
    for (let i = 0; i < MAX; i++) {
      const buf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this._objectBuffers.push(buf);
      this._objectBindGroups.push(device.createBindGroup({
        layout: this._objectLayout,
        entries: [{ binding: 0, resource: { buffer: buf } }],
      }));
    }

    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this._lightVPLayout, this._objectLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vs_shadow',
        buffers: [PBR_VERTEX_LAYOUT],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'front', // front-face culling reduces shadow acne
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 1.5,
      },
    });
  }

  /**
   * Update the light view-projection matrix from light direction.
   * The light looks toward either the active camera focus or the supplied target.
   */
  updateLightDirection(
    direction: [number, number, number],
    target: [number, number, number] = [0, 0, 0],
    cameraPosition?: [number, number, number],
  ): void {
    const len = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2) || 1;
    const nx = direction[0] / len;
    const ny = direction[1] / len;
    const nz = direction[2] / len;

    const focus = this._resolveTarget(target, cameraPosition);

    const dist = this._far * 0.5;
    const eye: [number, number, number] = [
      focus[0] - nx * dist,
      focus[1] - ny * dist,
      focus[2] - nz * dist,
    ];

    const s = this._frustumSize;
    const proj = mat4Ortho(-s, s, -s, s, this._near, this._far);
    const view = mat4LookAt(eye, focus, [0, 1, 0]);
    const vp = mat4Multiply(proj, view);

    this.lightViewProj.set(vp);
    this._device.queue.writeBuffer(this._lightVPBuffer, 0, vp as Float32Array<ArrayBuffer>);
  }

  private _resolveTarget(
    fallbackTarget: [number, number, number],
    cameraPosition?: [number, number, number],
  ): [number, number, number] {
    const base: [number, number, number] =
      this._followCamera && cameraPosition
        ? [cameraPosition[0], Math.max(0, cameraPosition[1] - 1.5), cameraPosition[2]]
        : [fallbackTarget[0], fallbackTarget[1], fallbackTarget[2]];

    if (!this._stabilize) {
      return base;
    }

    const texelWorldSize = (this._frustumSize * 2) / this.resolution;
    const snap = (value: number) => Math.round(value / texelWorldSize) * texelWorldSize;
    return [snap(base[0]), snap(base[1]), snap(base[2])];
  }

  /**
   * Render shadow map. Call before the main PBR pass.
   */
  render(encoder: GPUCommandEncoder, meshes: { mesh: GPUMesh; modelMatrix: Float32Array }[]): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.textureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._lightVPBindGroup);

    const count = Math.min(meshes.length, this._objectBuffers.length);
    for (let i = 0; i < count; i++) {
      const { mesh, modelMatrix } = meshes[i]!;
      this._device.queue.writeBuffer(this._objectBuffers[i]!, 0, modelMatrix as Float32Array<ArrayBuffer>);
      pass.setBindGroup(1, this._objectBindGroups[i]!);
      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
      pass.drawIndexed(mesh.indexCount);
    }

    pass.end();
  }

  destroy(): void {
    this.texture.destroy();
    this._lightVPBuffer.destroy();
    for (const b of this._objectBuffers) b.destroy();
  }
}

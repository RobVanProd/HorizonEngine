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
import { GPUMesh, PBR_VERTEX_LAYOUT, PBR_SKINNED_VERTEX_LAYOUT } from './mesh.js';
import { Environment, type EnvironmentConfig } from './environment.js';
import { ShadowMap, type ShadowConfig } from './shadow-map.js';
import { mat4Inverse } from './math.js';
import { GpuProfiler } from '@engine/profiler';

import pbrShaderSource from './shaders/pbr.wgsl?raw';
import pbrSkinnedShaderSource from './shaders/pbr-skinned.wgsl?raw';
import skyboxShaderSource from './shaders/skybox.wgsl?raw';

const CAMERA_BUFFER_SIZE = 160;
const LIGHT_BUFFER_SIZE = 128;
const OBJECT_BUFFER_SIZE = 128;
const MAX_OBJECTS = 1024;
const MAX_JOINTS = 256;
const JOINT_BUFFER_SIZE = MAX_JOINTS * 64; // 256 * mat4x4f

export interface SceneLighting {
  direction: [number, number, number];
  color: [number, number, number];
  intensity: number;
  ambient: [number, number, number];
  envIntensity: number;
}

interface DrawEntry {
  mesh: GPUMesh;
  material: PBRMaterial;
  modelMatrix: Float32Array;
  skinned: boolean;
}

export class PBRRenderer {
  private _gpu: GPUContext;
  private _pipeline!: GPURenderPipeline;
  private _skyboxPipeline!: GPURenderPipeline;
  private _depthTexture!: GPUTexture;
  private _depthView!: GPUTextureView;

  private _cameraBuffer!: GPUBuffer;
  private _cameraBindGroup!: GPUBindGroup;
  private _lightBuffer!: GPUBuffer;
  private _lightBindGroup!: GPUBindGroup;
  private _materialLayout!: GPUBindGroupLayout;

  private _objectBuffers: GPUBuffer[] = [];
  private _objectBindGroups: GPUBindGroup[] = [];

  private _environment: Environment | null = null;
  private _shadowMap: ShadowMap | null = null;
  private _skyboxBindGroup: GPUBindGroup | null = null;

  private _skinnedPipeline!: GPURenderPipeline;
  private _skinnedObjectLayout!: GPUBindGroupLayout;
  private _jointBuffers: GPUBuffer[] = [];
  private _skinnedObjectBindGroups: GPUBindGroup[] = [];

  private _draws: DrawEntry[] = [];
  private _initialized = false;
  private _gpuProfiler: GpuProfiler | null = null;
  private _profilingEnabled = false;

  constructor(gpu: GPUContext) {
    this._gpu = gpu;
  }

  get materialLayout(): GPUBindGroupLayout { return this._materialLayout; }
  get device(): GPUDevice { return this._gpu.device; }
  get environment(): Environment | null { return this._environment; }
  get shadowMap(): ShadowMap | null { return this._shadowMap; }
  get gpuProfiler(): GpuProfiler | null { return this._gpuProfiler; }

  /** Enable GPU timestamp profiling (requires 'timestamp-query' device feature). */
  enableProfiling(): void {
    if (!this._gpuProfiler) {
      this._gpuProfiler = new GpuProfiler(this._gpu.device);
    }
    this._profilingEnabled = this._gpuProfiler.supported;
    if (!this._profilingEnabled) {
      console.warn('[PBR] GPU profiling unavailable — device lacks timestamp-query feature');
    }
  }

  disableProfiling(): void {
    this._profilingEnabled = false;
  }

  async initialize(envConfig?: EnvironmentConfig, shadowConfig?: ShadowConfig): Promise<void> {
    if (this._initialized) return;
    const device = this._gpu.device;
    const format = this._gpu.format;

    this._createDepthTexture();

    console.log('[PBR] Generating IBL environment...');
    this._environment = await Environment.generate(device, envConfig);
    console.log('[PBR] IBL ready');

    this._shadowMap = new ShadowMap(device, shadowConfig);

    // --- Bind group layouts ---

    const cameraLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    const lightLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });

    this._materialLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const objectLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    // --- Buffers ---

    this._cameraBuffer = device.createBuffer({
      size: CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._cameraBindGroup = device.createBindGroup({
      layout: cameraLayout,
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });

    this._lightBuffer = device.createBuffer({
      size: LIGHT_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._lightBindGroup = device.createBindGroup({
      layout: lightLayout,
      entries: [
        { binding: 0, resource: { buffer: this._lightBuffer } },
        { binding: 1, resource: this._environment.irradianceView },
        { binding: 2, resource: this._environment.prefilteredView },
        { binding: 3, resource: this._environment.brdfLUTView },
        { binding: 4, resource: this._shadowMap.textureView },
        { binding: 5, resource: this._environment.sampler },
        { binding: 6, resource: this._shadowMap.sampler },
      ],
    });

    for (let i = 0; i < MAX_OBJECTS; i++) {
      const buf = device.createBuffer({ size: OBJECT_BUFFER_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this._objectBuffers.push(buf);
      this._objectBindGroups.push(device.createBindGroup({
        layout: objectLayout,
        entries: [{ binding: 0, resource: { buffer: buf } }],
      }));
    }

    // --- Pipelines ---

    const pbrModule = device.createShaderModule({ code: pbrShaderSource });
    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [cameraLayout, lightLayout, this._materialLayout, objectLayout],
      }),
      vertex: { module: pbrModule, entryPoint: 'vs_main', buffers: [PBR_VERTEX_LAYOUT] },
      fragment: { module: pbrModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const skyboxModule = device.createShaderModule({ code: skyboxShaderSource });
    const skyboxCameraLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    this._skyboxBindGroup = device.createBindGroup({
      layout: skyboxCameraLayout,
      entries: [
        { binding: 0, resource: { buffer: this._cameraBuffer } },
        { binding: 1, resource: this._environment.envCubemapView },
        { binding: 2, resource: this._environment.sampler },
      ],
    });

    this._skyboxPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skyboxCameraLayout] }),
      vertex: { module: skyboxModule, entryPoint: 'vs_skybox', buffers: [] },
      fragment: { module: skyboxModule, entryPoint: 'fs_skybox', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    // --- Skinned pipeline ---
    this._skinnedObjectLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const skinnedModule = device.createShaderModule({ code: pbrSkinnedShaderSource });
    this._skinnedPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [cameraLayout, lightLayout, this._materialLayout, this._skinnedObjectLayout],
      }),
      vertex: { module: skinnedModule, entryPoint: 'vs_main', buffers: [PBR_SKINNED_VERTEX_LAYOUT] },
      fragment: { module: skinnedModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    for (let i = 0; i < MAX_OBJECTS; i++) {
      const jBuf = device.createBuffer({ size: JOINT_BUFFER_SIZE, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this._jointBuffers.push(jBuf);
      this._skinnedObjectBindGroups.push(device.createBindGroup({
        layout: this._skinnedObjectLayout,
        entries: [
          { binding: 0, resource: { buffer: this._objectBuffers[i]! } },
          { binding: 1, resource: { buffer: jBuf } },
        ],
      }));
    }

    this._initialized = true;
    console.log('[PBR] Pipeline ready: IBL + shadows + skybox + skinning');
  }

  createMaterial(params?: PBRMaterialParams): PBRMaterial {
    return new PBRMaterial(this._gpu.device, this._materialLayout, params);
  }

  setCamera(viewProjection: Float32Array, position: [number, number, number]): void {
    const data = new Float32Array(40);
    data.set(viewProjection, 0);
    data.set(mat4Inverse(viewProjection), 16);
    data[32] = position[0];
    data[33] = position[1];
    data[34] = position[2];
    this._gpu.device.queue.writeBuffer(this._cameraBuffer, 0, data as Float32Array<ArrayBuffer>);
  }

  setLighting(lighting: SceneLighting): void {
    const d = new Float32Array(32);
    const dx = lighting.direction[0], dy = lighting.direction[1], dz = lighting.direction[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    d[0] = dx / len; d[1] = dy / len; d[2] = dz / len; d[3] = 0;
    d[4] = lighting.color[0]; d[5] = lighting.color[1]; d[6] = lighting.color[2];
    d[7] = lighting.intensity;
    d[8] = lighting.ambient[0]; d[9] = lighting.ambient[1]; d[10] = lighting.ambient[2];
    d[11] = this._shadowMap ? 1.0 : 0.0;
    if (this._shadowMap) {
      this._shadowMap.updateLightDirection(lighting.direction);
      d.set(this._shadowMap.lightViewProj, 12);
    }
    d[28] = lighting.envIntensity;
    d[29] = this._environment?.maxMipLevel ?? 4;
    this._gpu.device.queue.writeBuffer(this._lightBuffer, 0, d as Float32Array<ArrayBuffer>);
  }

  beginFrame(): void {
    this._ensureDepthSize();
    this._draws.length = 0;
    if (this._profilingEnabled && this._gpuProfiler) {
      this._gpuProfiler.beginFrame();
    }
  }

  drawMesh(mesh: GPUMesh, material: PBRMaterial, modelMatrix: Float32Array): void {
    if (this._draws.length >= MAX_OBJECTS) return;
    this._draws.push({ mesh, material, modelMatrix, skinned: false });

    const idx = this._draws.length - 1;
    const data = new Float32Array(32);
    data.set(modelMatrix, 0);
    computeNormalMatrix(modelMatrix, data, 16);
    this._gpu.device.queue.writeBuffer(this._objectBuffers[idx]!, 0, data as Float32Array<ArrayBuffer>);
  }

  /**
   * Draw a skinned mesh with joint matrices.
   * jointMatrices: flat Float32Array of mat4x4f per joint (joint_count * 16 floats).
   */
  drawSkinnedMesh(
    mesh: GPUMesh, material: PBRMaterial, modelMatrix: Float32Array,
    jointMatrices: Float32Array,
  ): void {
    if (this._draws.length >= MAX_OBJECTS) return;
    this._draws.push({ mesh, material, modelMatrix, skinned: true });

    const idx = this._draws.length - 1;
    const data = new Float32Array(32);
    data.set(modelMatrix, 0);
    computeNormalMatrix(modelMatrix, data, 16);
    this._gpu.device.queue.writeBuffer(this._objectBuffers[idx]!, 0, data as Float32Array<ArrayBuffer>);
    const len = Math.min(jointMatrices.length, MAX_JOINTS * 16);
    this._gpu.device.queue.writeBuffer(
      this._jointBuffers[idx]!, 0,
      jointMatrices.buffer as ArrayBuffer, jointMatrices.byteOffset, len * 4,
    );
  }

  endFrame(): void {
    const encoder = this._gpu.device.createCommandEncoder();

    // Pass 1: Shadow depth
    if (this._shadowMap) {
      this._shadowMap.render(encoder, this._draws);
    }

    // Pass 2: Main color (skybox + PBR)
    const colorView = this._gpu.getCurrentTexture().createView();
    const mainPassDesc: GPURenderPassDescriptor = {
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
    if (this._profilingEnabled && this._gpuProfiler) {
      const tw = this._gpuProfiler.timestampWrites('main-pass');
      if (tw) mainPassDesc.timestampWrites = tw;
    }
    const pass = encoder.beginRenderPass(mainPassDesc);

    // Skybox (renders at depth=1, depth test <=)
    if (this._skyboxBindGroup) {
      pass.setPipeline(this._skyboxPipeline);
      pass.setBindGroup(0, this._skyboxBindGroup);
      pass.draw(3);
    }

    // PBR objects — batch static and skinned draws separately to minimize pipeline switches
    pass.setBindGroup(0, this._cameraBindGroup);
    pass.setBindGroup(1, this._lightBindGroup);

    // Static objects
    let hasStatic = false;
    for (let i = 0; i < this._draws.length; i++) {
      const dc = this._draws[i]!;
      if (dc.skinned) continue;
      if (!hasStatic) { pass.setPipeline(this._pipeline); hasStatic = true; }
      pass.setBindGroup(2, dc.material.bindGroup);
      pass.setBindGroup(3, this._objectBindGroups[i]!);
      pass.setVertexBuffer(0, dc.mesh.vertexBuffer);
      pass.setIndexBuffer(dc.mesh.indexBuffer, 'uint32');
      pass.drawIndexed(dc.mesh.indexCount);
    }

    // Skinned objects
    let hasSkinned = false;
    for (let i = 0; i < this._draws.length; i++) {
      const dc = this._draws[i]!;
      if (!dc.skinned) continue;
      if (!hasSkinned) { pass.setPipeline(this._skinnedPipeline); hasSkinned = true; }
      pass.setBindGroup(2, dc.material.bindGroup);
      pass.setBindGroup(3, this._skinnedObjectBindGroups[i]!);
      pass.setVertexBuffer(0, dc.mesh.vertexBuffer);
      pass.setIndexBuffer(dc.mesh.indexBuffer, 'uint32');
      pass.drawIndexed(dc.mesh.indexCount);
    }

    pass.end();

    if (this._profilingEnabled && this._gpuProfiler) {
      this._gpuProfiler.resolve(encoder);
    }

    this._gpu.device.queue.submit([encoder.finish()]);

    if (this._profilingEnabled && this._gpuProfiler) {
      void this._gpuProfiler.readResults();
    }
  }

  handleResize(): void { this._createDepthTexture(); }

  destroy(): void {
    this._gpuProfiler?.destroy();
    this._depthTexture?.destroy();
    this._cameraBuffer?.destroy();
    this._lightBuffer?.destroy();
    this._environment?.destroy();
    this._shadowMap?.destroy();
    for (const b of this._objectBuffers) b.destroy();
    for (const b of this._jointBuffers) b.destroy();
  }

  private _createDepthTexture(): void {
    this._depthTexture?.destroy();
    this._depthTexture = this._gpu.device.createTexture({
      size: { width: this._gpu.canvas.width, height: this._gpu.canvas.height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._depthView = this._depthTexture.createView();
  }

  private _ensureDepthSize(): void {
    if (this._depthTexture.width !== this._gpu.canvas.width || this._depthTexture.height !== this._gpu.canvas.height) {
      this._createDepthTexture();
    }
  }
}

function computeNormalMatrix(m: Float32Array, out: Float32Array, offset: number): void {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10;
  const b02 = a00*a13 - a03*a10, b03 = a01*a12 - a02*a11;
  const b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
  const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30;
  const b08 = a20*a33 - a23*a30, b09 = a21*a32 - a22*a31;
  const b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;
  let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
  if (Math.abs(det) < 1e-8) det = 1;
  const id = 1/det;
  out[offset+0]=(a11*b11-a12*b10+a13*b09)*id; out[offset+1]=(a12*b08-a10*b11-a13*b07)*id;
  out[offset+2]=(a10*b10-a11*b08+a13*b06)*id; out[offset+3]=0;
  out[offset+4]=(a02*b10-a01*b11-a03*b09)*id; out[offset+5]=(a00*b11-a02*b08+a03*b07)*id;
  out[offset+6]=(a01*b08-a00*b10-a03*b06)*id; out[offset+7]=0;
  out[offset+8]=(a31*b05-a32*b04+a33*b03)*id; out[offset+9]=(a32*b02-a30*b05-a33*b01)*id;
  out[offset+10]=(a30*b04-a31*b02+a33*b00)*id; out[offset+11]=0;
  out[offset+12]=0; out[offset+13]=0; out[offset+14]=0; out[offset+15]=1;
}

import type { GPUContext } from '@engine/platform';
import { CpuTimer } from '@engine/profiler';
import { extractFrustumPlanes } from './frustum.js';

import frustumCullSource from './shaders/frustum-cull.wgsl?raw';
import resetArgsSource from './shaders/reset-args.wgsl?raw';
import depthCopySource from './shaders/depth-copy.wgsl?raw';
import hzbReduceSource from './shaders/hzb-reduce.wgsl?raw';
import occlusionCullSource from './shaders/occlusion-cull.wgsl?raw';

const INSTANCE_BOUNDS_STRIDE = 48 * 4;

export interface CullStats {
  totalInstances: number;
  afterFrustum: number;
  afterOcclusion: number;
}

/**
 * GPU-driven visibility pipeline.
 *
 * Frame flow:
 *   1. resetArgs()           — zero the indirect draw counters
 *   2. frustumCull()         — compute pass: frustum test all instances
 *   3. (depth pre-pass)      — caller renders visible instances to depth
 *   4. buildHZB()            — compute: generate depth mip pyramid
 *   5. occlusionCull()       — compute: test frustum-survivors against HZB
 *   6. (main draw)           — caller renders final visible set via indirect draw
 */
export class GpuCullPipeline {
  private _gpu: GPUContext;
  readonly timer = new CpuTimer();

  // Buffers
  private _instanceBuffer!: GPUBuffer;
  private _frustumUniformBuffer!: GPUBuffer;
  private _visibleIndicesA!: GPUBuffer;
  private _visibleIndicesB!: GPUBuffer;
  private _drawArgsBuffer!: GPUBuffer;
  private _drawArgsBufferB!: GPUBuffer;
  private _occlusionUniformBuffer!: GPUBuffer;
  private _statsReadBuffer!: GPUBuffer;

  // HZB textures
  private _hzbTexture!: GPUTexture;
  private _hzbMipCount = 0;
  private _hzbWidth = 0;
  private _hzbHeight = 0;

  // Pipelines
  private _resetPipeline!: GPUComputePipeline;
  private _frustumCullPipeline!: GPUComputePipeline;
  private _depthCopyPipeline!: GPUComputePipeline;
  private _hzbReducePipeline!: GPUComputePipeline;
  private _occlusionCullPipeline!: GPUComputePipeline;

  // Bind group layouts
  private _resetBGL!: GPUBindGroupLayout;
  private _frustumBGL!: GPUBindGroupLayout;
  private _depthCopyBGL!: GPUBindGroupLayout;
  private _hzbReduceBGL!: GPUBindGroupLayout;
  private _occlusionBGL!: GPUBindGroupLayout;

  // Bind groups (recreated per-frame or on resize)
  private _resetBG_A!: GPUBindGroup;
  private _resetBG_B!: GPUBindGroup;
  private _frustumBG!: GPUBindGroup;
  private _occlusionBG!: GPUBindGroup;

  private _maxInstances = 0;
  private _instanceCount = 0;
  private _initialized = false;

  private _lastFrustumCount = 0;

  constructor(gpu: GPUContext) {
    this._gpu = gpu;
  }

  get drawArgsBuffer(): GPUBuffer {
    return this._drawArgsBufferB;
  }

  get visibleIndicesBuffer(): GPUBuffer {
    return this._visibleIndicesB;
  }

  get instanceBuffer(): GPUBuffer {
    return this._instanceBuffer;
  }

  get frustumVisibleBuffer(): GPUBuffer {
    return this._visibleIndicesA;
  }

  get frustumDrawArgsBuffer(): GPUBuffer {
    return this._drawArgsBuffer;
  }

  get instanceCount(): number {
    return this._instanceCount;
  }

  async initialize(maxInstances: number): Promise<void> {
    if (this._initialized) return;
    const device = this._gpu.device;
    this._maxInstances = maxInstances;

    // Instance storage buffer (uploaded each frame or once if static)
    this._instanceBuffer = device.createBuffer({
      size: maxInstances * INSTANCE_BOUNDS_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Visible index output buffers (A = frustum output, B = occlusion output)
    const indexBufSize = maxInstances * 4;
    this._visibleIndicesA = device.createBuffer({
      size: indexBufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._visibleIndicesB = device.createBuffer({
      size: indexBufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Indirect draw args buffers (5 u32s = 20 bytes)
    const argsBufUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this._drawArgsBuffer = device.createBuffer({ size: 20, usage: argsBufUsage });
    this._drawArgsBufferB = device.createBuffer({ size: 20, usage: argsBufUsage });

    // Stats readback buffer
    this._statsReadBuffer = device.createBuffer({
      size: 20,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Frustum uniform buffer: 6 planes * vec4 (96) + instance_count + 3 pad (16) = 112 bytes
    this._frustumUniformBuffer = device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Occlusion uniform buffer: mat4 (64) + vec2 screen (8) + near (4) + mipCount (4) + visibleCount (4) + 3 pad (12) = 96
    this._occlusionUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    await this._createPipelines();
    this._createBindGroups();
    this._initialized = true;
  }

  uploadInstances(data: Float32Array, count: number): void {
    this._instanceCount = count;
    this._gpu.device.queue.writeBuffer(
      this._instanceBuffer, 0,
      data as Float32Array<ArrayBuffer>, 0,
      count * (INSTANCE_BOUNDS_STRIDE / 4),
    );
  }

  /**
   * Encode the full GPU culling pipeline into the command encoder.
   */
  encodeCulling(
    encoder: GPUCommandEncoder,
    viewProjection: Float32Array,
    indexCountPerInstance: number,
    screenWidth: number,
    screenHeight: number,
    nearPlane: number,
    depthTexture: GPUTexture | null,
    enableOcclusion: boolean,
  ): void {
    // Upload frustum uniforms
    const frustum = extractFrustumPlanes(viewProjection);
    const frustumData = new Float32Array(28);
    frustumData.set(frustum.planes, 0);
    const u32 = new Uint32Array(frustumData.buffer);
    u32[24] = this._instanceCount;
    this._gpu.device.queue.writeBuffer(this._frustumUniformBuffer, 0, frustumData as Float32Array<ArrayBuffer>);

    // Write initial draw args (indexCount, 0, 0, 0, 0)
    const initArgs = new Uint32Array([indexCountPerInstance, 0, 0, 0, 0]);
    this._gpu.device.queue.writeBuffer(this._drawArgsBuffer, 0, initArgs as Uint32Array<ArrayBuffer>);
    this._gpu.device.queue.writeBuffer(this._drawArgsBufferB, 0, initArgs as Uint32Array<ArrayBuffer>);

    // Pass 1: Frustum cull
    const frustumPass = encoder.beginComputePass();
    frustumPass.setPipeline(this._frustumCullPipeline);
    frustumPass.setBindGroup(0, this._frustumBG);
    frustumPass.dispatchWorkgroups(Math.ceil(this._instanceCount / 64));
    frustumPass.end();

    // If no occlusion or no depth texture, we're done
    if (!enableOcclusion || !depthTexture) {
      // Copy frustum results to B for the final draw
      encoder.copyBufferToBuffer(this._drawArgsBuffer, 0, this._drawArgsBufferB, 0, 20);
      encoder.copyBufferToBuffer(this._visibleIndicesA, 0, this._visibleIndicesB, 0, this._instanceCount * 4);
      return;
    }

    // Build HZB from depth texture
    this._buildHZB(encoder, depthTexture, screenWidth, screenHeight);

    // Read frustum visible count (for occlusion uniform)
    // We pass the max possible since the GPU wrote the actual count atomically.
    // The occlusion shader uses params.visible_count to bound iteration.
    // We need to know the frustum count — we'll use the max (instanceCount) as upper bound
    // and the shader will early-out for indices beyond what was written.
    // Alternatively, copy the count. For now, use instance count as safe upper bound.
    this._lastFrustumCount = this._instanceCount;

    // Upload occlusion uniforms
    const occUniformData = new Float32Array(24);
    occUniformData.set(viewProjection, 0);
    occUniformData[16] = screenWidth;
    occUniformData[17] = screenHeight;
    occUniformData[18] = nearPlane;
    const occU32 = new Uint32Array(occUniformData.buffer);
    occU32[19] = this._hzbMipCount;
    occU32[20] = this._lastFrustumCount;
    this._gpu.device.queue.writeBuffer(this._occlusionUniformBuffer, 0, occUniformData as Float32Array<ArrayBuffer>);

    // Recreate occlusion bind group with current HZB
    this._recreateOcclusionBindGroup();

    // Pass 3: Occlusion cull
    const occPass = encoder.beginComputePass();
    occPass.setPipeline(this._occlusionCullPipeline);
    occPass.setBindGroup(0, this._occlusionBG);
    occPass.dispatchWorkgroups(Math.ceil(this._lastFrustumCount / 64));
    occPass.end();
  }

  /**
   * Read back cull stats (requires GPU sync — use sparingly).
   */
  async readStats(encoder: GPUCommandEncoder): Promise<CullStats> {
    encoder.copyBufferToBuffer(this._drawArgsBufferB, 0, this._statsReadBuffer, 0, 20);
    this._gpu.device.queue.submit([encoder.finish()]);

    await this._statsReadBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this._statsReadBuffer.getMappedRange());
    const afterOcclusion = data[1]!;
    this._statsReadBuffer.unmap();

    return {
      totalInstances: this._instanceCount,
      afterFrustum: this._lastFrustumCount,
      afterOcclusion,
    };
  }

  private _buildHZB(
    encoder: GPUCommandEncoder,
    depthTexture: GPUTexture,
    width: number,
    height: number,
  ): void {
    this._ensureHZBTexture(width, height);

    // Step 1: Copy depth to HZB mip 0
    const depthCopyBG = this._gpu.device.createBindGroup({
      layout: this._depthCopyBGL,
      entries: [
        { binding: 0, resource: depthTexture.createView() },
        { binding: 1, resource: this._hzbTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    });

    const copyPass = encoder.beginComputePass();
    copyPass.setPipeline(this._depthCopyPipeline);
    copyPass.setBindGroup(0, depthCopyBG);
    copyPass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    copyPass.end();

    // Step 2: Downsample mip chain
    let mipWidth = width >> 1;
    let mipHeight = height >> 1;

    for (let mip = 1; mip < this._hzbMipCount; mip++) {
      const srcView = this._hzbTexture.createView({
        baseMipLevel: mip - 1,
        mipLevelCount: 1,
      });
      const dstView = this._hzbTexture.createView({
        baseMipLevel: mip,
        mipLevelCount: 1,
      });

      const bg = this._gpu.device.createBindGroup({
        layout: this._hzbReduceBGL,
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: dstView },
        ],
      });

      const pass = encoder.beginComputePass();
      pass.setPipeline(this._hzbReducePipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(
        Math.max(1, Math.ceil(mipWidth / 8)),
        Math.max(1, Math.ceil(mipHeight / 8)),
      );
      pass.end();

      mipWidth = Math.max(1, mipWidth >> 1);
      mipHeight = Math.max(1, mipHeight >> 1);
    }
  }

  private _ensureHZBTexture(width: number, height: number): void {
    if (this._hzbWidth === width && this._hzbHeight === height) return;

    this._hzbTexture?.destroy();
    this._hzbWidth = width;
    this._hzbHeight = height;
    this._hzbMipCount = Math.floor(Math.log2(Math.max(width, height))) + 1;

    this._hzbTexture = this._gpu.device.createTexture({
      size: { width, height },
      mipLevelCount: this._hzbMipCount,
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
  }

  private async _createPipelines(): Promise<void> {
    const device = this._gpu.device;

    // Reset pipeline
    const resetModule = device.createShaderModule({ code: resetArgsSource });
    this._resetBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._resetPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._resetBGL] }),
      compute: { module: resetModule, entryPoint: 'main' },
    });

    // Frustum cull pipeline
    const frustumModule = device.createShaderModule({ code: frustumCullSource });
    this._frustumBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._frustumCullPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._frustumBGL] }),
      compute: { module: frustumModule, entryPoint: 'main' },
    });

    // Depth copy pipeline
    const depthCopyModule = device.createShaderModule({ code: depthCopySource });
    this._depthCopyBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this._depthCopyPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._depthCopyBGL] }),
      compute: { module: depthCopyModule, entryPoint: 'main' },
    });

    // HZB reduce pipeline
    const hzbModule = device.createShaderModule({ code: hzbReduceSource });
    this._hzbReduceBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this._hzbReducePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._hzbReduceBGL] }),
      compute: { module: hzbModule, entryPoint: 'main' },
    });

    // Occlusion cull pipeline
    const occModule = device.createShaderModule({ code: occlusionCullSource });
    this._occlusionBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this._occlusionCullPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._occlusionBGL] }),
      compute: { module: occModule, entryPoint: 'main' },
    });
  }

  private _createBindGroups(): void {
    const device = this._gpu.device;

    this._resetBG_A = device.createBindGroup({
      layout: this._resetBGL,
      entries: [{ binding: 0, resource: { buffer: this._drawArgsBuffer } }],
    });
    this._resetBG_B = device.createBindGroup({
      layout: this._resetBGL,
      entries: [{ binding: 0, resource: { buffer: this._drawArgsBufferB } }],
    });

    this._frustumBG = device.createBindGroup({
      layout: this._frustumBGL,
      entries: [
        { binding: 0, resource: { buffer: this._instanceBuffer } },
        { binding: 1, resource: { buffer: this._frustumUniformBuffer } },
        { binding: 2, resource: { buffer: this._visibleIndicesA } },
        { binding: 3, resource: { buffer: this._drawArgsBuffer } },
      ],
    });
  }

  private _recreateOcclusionBindGroup(): void {
    if (!this._hzbTexture) return;

    this._occlusionBG = this._gpu.device.createBindGroup({
      layout: this._occlusionBGL,
      entries: [
        { binding: 0, resource: { buffer: this._instanceBuffer } },
        { binding: 1, resource: { buffer: this._occlusionUniformBuffer } },
        { binding: 2, resource: { buffer: this._visibleIndicesA } },
        { binding: 3, resource: { buffer: this._visibleIndicesB } },
        { binding: 4, resource: { buffer: this._drawArgsBufferB } },
        { binding: 5, resource: this._hzbTexture.createView() },
      ],
    });
  }

  destroy(): void {
    this._instanceBuffer?.destroy();
    this._frustumUniformBuffer?.destroy();
    this._visibleIndicesA?.destroy();
    this._visibleIndicesB?.destroy();
    this._drawArgsBuffer?.destroy();
    this._drawArgsBufferB?.destroy();
    this._occlusionUniformBuffer?.destroy();
    this._statsReadBuffer?.destroy();
    this._hzbTexture?.destroy();
  }
}

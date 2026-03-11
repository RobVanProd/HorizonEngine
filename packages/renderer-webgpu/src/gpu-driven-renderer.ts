import type { GPUContext } from '@engine/platform';
import { createCubeGeometry, type Geometry } from './geometry.js';

import gpuDrivenSource from './shaders/gpu-driven.wgsl?raw';
import depthOnlySource from './shaders/depth-only.wgsl?raw';
import gridShaderSource from './shaders/grid.wgsl?raw';

/**
 * GPU-driven renderer that uses indirect draw calls with compute-culled visibility.
 *
 * Instead of CPU-side instance buffer uploads per frame, this renderer:
 *   1. Stores all instance data in a GPU storage buffer
 *   2. Uses a visibility pipeline (GpuCullPipeline) to cull instances
 *   3. Reads compacted visible indices from a storage buffer in the vertex shader
 *   4. Draws via drawIndexedIndirect where the GPU wrote the instance count
 *
 * Supports two-pass rendering:
 *   - Depth pre-pass (for HZB generation)
 *   - Main color pass
 */
export class GpuDrivenRenderer {
  private _gpu: GPUContext;
  private _depthTexture!: GPUTexture;
  private _depthView!: GPUTextureView;

  // Camera
  private _cameraBuffer!: GPUBuffer;
  private _cameraBGL!: GPUBindGroupLayout;
  private _cameraBG!: GPUBindGroup;

  // Instance bind group layout (shared between depth-only and color passes)
  private _instanceBGL!: GPUBindGroupLayout;

  // Geometry
  private _vertexBuffer!: GPUBuffer;
  private _indexBuffer!: GPUBuffer;
  private _geometry!: Geometry;

  // Pipelines
  private _colorPipeline!: GPURenderPipeline;
  private _depthOnlyPipeline!: GPURenderPipeline;
  private _gridPipeline!: GPURenderPipeline;

  private _initialized = false;

  constructor(gpu: GPUContext) {
    this._gpu = gpu;
  }

  get depthTexture(): GPUTexture {
    return this._depthTexture;
  }

  get cameraBGL(): GPUBindGroupLayout {
    return this._cameraBGL;
  }

  get instanceBGL(): GPUBindGroupLayout {
    return this._instanceBGL;
  }

  get geometry(): Geometry {
    return this._geometry;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    const device = this._gpu.device;
    const format = this._gpu.format;

    this._createDepthTexture();

    // Camera uniform buffer
    this._cameraBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._cameraBGL = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this._cameraBG = device.createBindGroup({
      layout: this._cameraBGL,
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });

    // Instance bind group layout: instances storage + visible_indices storage
    this._instanceBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    // Geometry
    this._geometry = createCubeGeometry();
    this._vertexBuffer = device.createBuffer({
      size: this._geometry.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._vertexBuffer, 0, this._geometry.vertices as Float32Array<ArrayBuffer>);

    this._indexBuffer = device.createBuffer({
      size: this._geometry.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._indexBuffer, 0, this._geometry.indices as Uint32Array<ArrayBuffer>);

    // Vertex buffer layout (shared)
    const vertexBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 8 * 4,
      stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
      ],
    };

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this._cameraBGL, this._instanceBGL],
    });

    // Color pipeline
    const colorModule = device.createShaderModule({ code: gpuDrivenSource });
    this._colorPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: colorModule,
        entryPoint: 'vs_main',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: colorModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // Depth-only pipeline
    const depthModule = device.createShaderModule({ code: depthOnlySource });
    this._depthOnlyPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: depthModule,
        entryPoint: 'vs_main',
        buffers: [vertexBufferLayout],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // Grid pipeline
    const gridModule = device.createShaderModule({ code: gridShaderSource });
    const gridLayout = device.createPipelineLayout({ bindGroupLayouts: [this._cameraBGL] });
    this._gridPipeline = device.createRenderPipeline({
      layout: gridLayout,
      vertex: { module: gridModule, entryPoint: 'vs_main', buffers: [] },
      fragment: {
        module: gridModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    this._initialized = true;
  }

  updateCamera(viewProjection: Float32Array, cameraPosition: [number, number, number]): void {
    const data = new Float32Array(20);
    data.set(viewProjection, 0);
    data[16] = cameraPosition[0];
    data[17] = cameraPosition[1];
    data[18] = cameraPosition[2];
    data[19] = 0;
    this._gpu.device.queue.writeBuffer(this._cameraBuffer, 0, data as Float32Array<ArrayBuffer>);
  }

  /**
   * Create a bind group for instance data + visible indices.
   */
  createInstanceBindGroup(instanceBuffer: GPUBuffer, visibleIndicesBuffer: GPUBuffer): GPUBindGroup {
    return this._gpu.device.createBindGroup({
      layout: this._instanceBGL,
      entries: [
        { binding: 0, resource: { buffer: instanceBuffer } },
        { binding: 1, resource: { buffer: visibleIndicesBuffer } },
      ],
    });
  }

  /**
   * Encode a depth-only pre-pass using indirect draw.
   */
  encodeDepthPrePass(
    encoder: GPUCommandEncoder,
    instanceBindGroup: GPUBindGroup,
    indirectBuffer: GPUBuffer,
  ): void {
    this._ensureDepthTextureSize();

    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this._depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._depthOnlyPipeline);
    pass.setBindGroup(0, this._cameraBG);
    pass.setBindGroup(1, instanceBindGroup);
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexedIndirect(indirectBuffer, 0);
    pass.end();
  }

  /**
   * Encode the main color pass using indirect draw.
   */
  encodeColorPass(
    encoder: GPUCommandEncoder,
    instanceBindGroup: GPUBindGroup,
    indirectBuffer: GPUBuffer,
    drawGrid = true,
  ): void {
    this._ensureDepthTextureSize();
    const colorTexture = this._gpu.getCurrentTexture();
    const colorView = colorTexture.createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._colorPipeline);
    pass.setBindGroup(0, this._cameraBG);
    pass.setBindGroup(1, instanceBindGroup);
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexedIndirect(indirectBuffer, 0);

    if (drawGrid) {
      pass.setPipeline(this._gridPipeline);
      pass.setBindGroup(0, this._cameraBG);
      pass.draw(6);
    }

    pass.end();
  }

  handleResize(): void {
    this._createDepthTexture();
  }

  destroy(): void {
    this._depthTexture?.destroy();
    this._cameraBuffer?.destroy();
    this._vertexBuffer?.destroy();
    this._indexBuffer?.destroy();
  }

  private _createDepthTexture(): void {
    this._depthTexture?.destroy();
    const w = this._gpu.canvas.width;
    const h = this._gpu.canvas.height;
    this._depthTexture = this._gpu.device.createTexture({
      size: { width: w, height: h },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._depthView = this._depthTexture.createView();
  }

  private _ensureDepthTextureSize(): void {
    const w = this._gpu.canvas.width;
    const h = this._gpu.canvas.height;
    if (this._depthTexture.width !== w || this._depthTexture.height !== h) {
      this._createDepthTexture();
    }
  }
}

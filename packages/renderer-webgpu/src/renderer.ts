import type { GPUContext } from '@engine/platform';
import { createCubeGeometry, type Geometry } from './geometry.js';

import instanceShaderSource from './shaders/instance.wgsl?raw';
import gridShaderSource from './shaders/grid.wgsl?raw';

const INSTANCE_STRIDE = (16 + 4) * 4;
const MAX_INSTANCES = 100_000;

/**
 * The core WebGPU renderer. Manages pipelines, buffers, and draw submission.
 * Phase 0 focuses on instanced rendering of simple geometry with a debug grid.
 */
export class Renderer {
  private _gpu: GPUContext;
  private _depthTexture!: GPUTexture;
  private _depthView!: GPUTextureView;

  // Camera uniform
  private _cameraBuffer!: GPUBuffer;
  private _cameraBindGroup!: GPUBindGroup;
  private _cameraBindGroupLayout!: GPUBindGroupLayout;

  // Instance pipeline
  private _instancePipeline!: GPURenderPipeline;
  private _instanceBuffer!: GPUBuffer;
  private _vertexBuffer!: GPUBuffer;
  private _indexBuffer!: GPUBuffer;
  private _cubeGeometry!: Geometry;

  // Grid pipeline
  private _gridPipeline!: GPURenderPipeline;

  private _instanceCount = 0;
  private _instanceData: Float32Array;
  private _initialized = false;

  constructor(gpu: GPUContext) {
    this._gpu = gpu;
    this._instanceData = new Float32Array(MAX_INSTANCES * (16 + 4));
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    const device = this._gpu.device;
    const format = this._gpu.format;

    this._createDepthTexture();

    // Camera uniform buffer: mat4x4 (64) + vec3 + pad (16) = 80 bytes
    this._cameraBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._cameraBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this._cameraBindGroup = device.createBindGroup({
      layout: this._cameraBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this._cameraBuffer },
      }],
    });

    // Geometry
    this._cubeGeometry = createCubeGeometry();

    this._vertexBuffer = device.createBuffer({
      size: this._cubeGeometry.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._vertexBuffer, 0, this._cubeGeometry.vertices as Float32Array<ArrayBuffer>);

    this._indexBuffer = device.createBuffer({
      size: this._cubeGeometry.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._indexBuffer, 0, this._cubeGeometry.indices as Uint32Array<ArrayBuffer>);

    // Instance buffer
    this._instanceBuffer = device.createBuffer({
      size: MAX_INSTANCES * INSTANCE_STRIDE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Instance pipeline
    const instanceModule = device.createShaderModule({ code: instanceShaderSource });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this._cameraBindGroupLayout],
    });

    this._instancePipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: instanceModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            // Vertex data: position(3) + normal(3) + uv(2) = 8 floats
            arrayStride: 8 * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
            ],
          },
          {
            // Instance data: model matrix (4 x vec4) + color (vec4) = 20 floats
            arrayStride: INSTANCE_STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x4' },  // model col 0
              { shaderLocation: 4, offset: 16, format: 'float32x4' }, // model col 1
              { shaderLocation: 5, offset: 32, format: 'float32x4' }, // model col 2
              { shaderLocation: 6, offset: 48, format: 'float32x4' }, // model col 3
              { shaderLocation: 7, offset: 64, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: instanceModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Grid pipeline
    const gridModule = device.createShaderModule({ code: gridShaderSource });

    this._gridPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: gridModule,
        entryPoint: 'vs_main',
        buffers: [],
      },
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
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });

    this._initialized = true;
  }

  /**
   * Upload camera matrices to the GPU.
   * viewProjection: 4x4 column-major matrix
   * cameraPosition: [x, y, z]
   */
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
   * Begin building instance data for the current frame.
   */
  beginInstances(): void {
    this._instanceCount = 0;
  }

  /**
   * Push an instance for rendering. modelMatrix is a 16-float column-major matrix.
   * color is [r, g, b, a].
   */
  pushInstance(modelMatrix: Float32Array, color: [number, number, number, number]): void {
    if (this._instanceCount >= MAX_INSTANCES) return;
    const offset = this._instanceCount * 20;
    this._instanceData.set(modelMatrix, offset);
    this._instanceData[offset + 16] = color[0];
    this._instanceData[offset + 17] = color[1];
    this._instanceData[offset + 18] = color[2];
    this._instanceData[offset + 19] = color[3];
    this._instanceCount++;
  }

  /**
   * Render the current frame.
   */
  render(): void {
    if (!this._initialized) return;
    const device = this._gpu.device;

    this._ensureDepthTextureSize();

    // Upload instance data
    if (this._instanceCount > 0) {
      device.queue.writeBuffer(
        this._instanceBuffer, 0,
        this._instanceData as Float32Array<ArrayBuffer>, 0,
        this._instanceCount * 20,
      );
    }

    const colorTexture = this._gpu.getCurrentTexture();
    const colorView = colorTexture.createView();

    const encoder = device.createCommandEncoder();
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

    // Draw instances
    if (this._instanceCount > 0) {
      pass.setPipeline(this._instancePipeline);
      pass.setBindGroup(0, this._cameraBindGroup);
      pass.setVertexBuffer(0, this._vertexBuffer);
      pass.setVertexBuffer(1, this._instanceBuffer);
      pass.setIndexBuffer(this._indexBuffer, 'uint32');
      pass.drawIndexed(this._cubeGeometry.indexCount, this._instanceCount);
    }

    // Draw grid
    pass.setPipeline(this._gridPipeline);
    pass.setBindGroup(0, this._cameraBindGroup);
    pass.draw(6);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  handleResize(): void {
    this._createDepthTexture();
  }

  get instanceCount(): number {
    return this._instanceCount;
  }

  destroy(): void {
    this._depthTexture?.destroy();
    this._cameraBuffer?.destroy();
    this._instanceBuffer?.destroy();
    this._vertexBuffer?.destroy();
    this._indexBuffer?.destroy();
  }

  private _createDepthTexture(): void {
    this._depthTexture?.destroy();
    this._depthTexture = this._gpu.device.createTexture({
      size: {
        width: this._gpu.canvas.width,
        height: this._gpu.canvas.height,
      },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
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

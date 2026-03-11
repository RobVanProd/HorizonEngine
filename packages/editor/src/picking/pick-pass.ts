/**
 * GPU object picking via a color-ID render pass.
 * Each entity is rendered with a unique color encoding its ID.
 * On click, the pixel under the cursor is read back to determine the entity.
 */

const PICK_SHADER = /* wgsl */`
struct Camera { viewProj: mat4x4f }
struct Object { model: mat4x4f, entityId: u32, _pad0: u32, _pad1: u32, _pad2: u32 }

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<uniform> obj: Object;

struct VOut {
  @builtin(position) pos: vec4f,
}

@vertex fn vs(@location(0) pos: vec3f) -> VOut {
  var o: VOut;
  o.pos = cam.viewProj * obj.model * vec4f(pos, 1.0);
  return o;
}

@fragment fn fs() -> @location(0) vec4u {
  return vec4u(obj.entityId, 0u, 0u, 255u);
}
`;

export class PickPass {
  private _device: GPUDevice;
  private _pipeline: GPURenderPipeline | null = null;
  private _camBuffer: GPUBuffer;
  private _camBG: GPUBindGroup | null = null;
  private _objLayout: GPUBindGroupLayout | null = null;
  private _pickTexture: GPUTexture | null = null;
  private _pickDepth: GPUTexture | null = null;
  private _readBuffer: GPUBuffer;
  private _width = 0;
  private _height = 0;

  constructor(device: GPUDevice) {
    this._device = device;

    this._camBuffer = device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'pick-camera',
    });
    this._readBuffer = device.createBuffer({
      size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      label: 'pick-readback',
    });
  }

  private _ensurePipeline(): void {
    if (this._pipeline) return;
    const d = this._device;

    const shader = d.createShaderModule({ code: PICK_SHADER, label: 'pick-shader' });

    const camLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this._camBG = d.createBindGroup({
      layout: camLayout,
      entries: [{ binding: 0, resource: { buffer: this._camBuffer } }],
    });

    this._objLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    this._pipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [camLayout, this._objLayout] }),
      vertex: {
        module: shader, entryPoint: 'vs',
        buffers: [{
          arrayStride: 56, // PBR vertex: pos(12) + normal(12) + uv(8) + tangent(16) + padding to stride
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: shader, entryPoint: 'fs',
        targets: [{ format: 'r32uint' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  private _ensureTextures(w: number, h: number): void {
    if (this._width === w && this._height === h) return;
    this._pickTexture?.destroy();
    this._pickDepth?.destroy();

    this._width = w;
    this._height = h;

    this._pickTexture = this._device.createTexture({
      size: [w, h],
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      label: 'pick-color',
    });
    this._pickDepth = this._device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'pick-depth',
    });
  }

  createObjectBindGroup(buffer: GPUBuffer): GPUBindGroup {
    this._ensurePipeline();
    return this._device.createBindGroup({
      layout: this._objLayout!,
      entries: [{ binding: 0, resource: { buffer } }],
    });
  }

  /**
   * Render the pick pass. Caller supplies a callback that receives the encoder
   * to set vertex buffers and issue draw calls.
   */
  render(
    w: number, h: number,
    viewProj: Float32Array,
    drawCallback: (pass: GPURenderPassEncoder, objLayout: GPUBindGroupLayout) => void,
  ): void {
    this._ensurePipeline();
    this._ensureTextures(w, h);

    this._device.queue.writeBuffer(this._camBuffer, 0, viewProj.buffer as ArrayBuffer, viewProj.byteOffset, 64);

    const enc = this._device.createCommandEncoder({ label: 'pick-encoder' });
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this._pickTexture!.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._pickDepth!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    pass.setPipeline(this._pipeline!);
    pass.setBindGroup(0, this._camBG!);

    drawCallback(pass, this._objLayout!);

    pass.end();
    this._device.queue.submit([enc.finish()]);
  }

  async readPixel(x: number, y: number): Promise<number> {
    if (!this._pickTexture || x < 0 || y < 0 || x >= this._width || y >= this._height) return 0;

    const enc = this._device.createCommandEncoder({ label: 'pick-read' });
    enc.copyTextureToBuffer(
      { texture: this._pickTexture, origin: { x: Math.floor(x), y: Math.floor(y) } },
      { buffer: this._readBuffer, bytesPerRow: 256 },
      { width: 1, height: 1 },
    );
    this._device.queue.submit([enc.finish()]);

    await this._readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this._readBuffer.getMappedRange().slice(0));
    this._readBuffer.unmap();
    return data[0]!;
  }

  destroy(): void {
    this._camBuffer.destroy();
    this._readBuffer.destroy();
    this._pickTexture?.destroy();
    this._pickDepth?.destroy();
  }
}

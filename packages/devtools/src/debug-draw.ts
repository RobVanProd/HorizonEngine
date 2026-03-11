/**
 * Immediate-mode debug line renderer for skeleton visualization, wireframes, and AABB drawing.
 * Accumulates line segments each frame and renders them in a single draw call.
 */

const MAX_LINES = 65536;
const FLOATS_PER_VERTEX = 7; // xyz + rgba
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4;

const DEBUG_LINE_SHADER = /* wgsl */`
struct Uniforms { viewProj: mat4x4f }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) col: vec4f,
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
}

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(v.pos, 1.0);
  o.col = v.col;
  return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return v.col;
}
`;

export class DebugDraw {
  private _device: GPUDevice;
  private _pipeline: GPURenderPipeline | null = null;
  private _uniformBuf: GPUBuffer;
  private _uniformBG: GPUBindGroup | null = null;
  private _vertexBuf: GPUBuffer;
  private _data: Float32Array;
  private _count = 0;
  private _format: GPUTextureFormat;

  constructor(device: GPUDevice, format: GPUTextureFormat = 'bgra8unorm') {
    this._device = device;
    this._format = format;

    this._data = new Float32Array(MAX_LINES * 2 * FLOATS_PER_VERTEX);

    this._vertexBuf = device.createBuffer({
      size: this._data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'debug-lines-vertex',
    });

    this._uniformBuf = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'debug-lines-uniform',
    });
  }

  private _ensurePipeline(): void {
    if (this._pipeline) return;
    const device = this._device;

    const shaderModule = device.createShaderModule({
      code: DEBUG_LINE_SHADER,
      label: 'debug-lines-shader',
    });

    const bgLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });

    this._uniformBG = device.createBindGroup({
      layout: bgLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
    });

    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: BYTES_PER_VERTEX,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{ format: this._format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        }}],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }

  /** Clear accumulated lines for this frame. */
  begin(): void {
    this._count = 0;
  }

  /** Add a line segment with a single color. */
  line(
    p0: [number, number, number],
    p1: [number, number, number],
    color: [number, number, number, number] = [1, 1, 0, 1],
  ): void {
    if (this._count >= MAX_LINES) return;
    const offset = this._count * 2 * FLOATS_PER_VERTEX;
    this._data[offset] = p0[0]; this._data[offset + 1] = p0[1]; this._data[offset + 2] = p0[2];
    this._data[offset + 3] = color[0]; this._data[offset + 4] = color[1];
    this._data[offset + 5] = color[2]; this._data[offset + 6] = color[3];

    this._data[offset + 7] = p1[0]; this._data[offset + 8] = p1[1]; this._data[offset + 9] = p1[2];
    this._data[offset + 10] = color[0]; this._data[offset + 11] = color[1];
    this._data[offset + 12] = color[2]; this._data[offset + 13] = color[3];

    this._count++;
  }

  /** Draw an axis-aligned bounding box. */
  aabb(
    min: [number, number, number],
    max: [number, number, number],
    color: [number, number, number, number] = [0, 1, 0, 0.6],
  ): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    // Bottom face
    this.line([x0, y0, z0], [x1, y0, z0], color);
    this.line([x1, y0, z0], [x1, y0, z1], color);
    this.line([x1, y0, z1], [x0, y0, z1], color);
    this.line([x0, y0, z1], [x0, y0, z0], color);
    // Top face
    this.line([x0, y1, z0], [x1, y1, z0], color);
    this.line([x1, y1, z0], [x1, y1, z1], color);
    this.line([x1, y1, z1], [x0, y1, z1], color);
    this.line([x0, y1, z1], [x0, y1, z0], color);
    // Verticals
    this.line([x0, y0, z0], [x0, y1, z0], color);
    this.line([x1, y0, z0], [x1, y1, z0], color);
    this.line([x1, y0, z1], [x1, y1, z1], color);
    this.line([x0, y0, z1], [x0, y1, z1], color);
  }

  /** Draw a skeleton from joint world positions and parent indices. */
  skeleton(
    jointPositions: Float32Array,
    parentIndices: Int32Array | number[],
    color: [number, number, number, number] = [0, 1, 1, 0.8],
    pointColor: [number, number, number, number] = [1, 0.3, 0.1, 1],
  ): void {
    const jointCount = parentIndices.length;
    for (let j = 0; j < jointCount; j++) {
      const px = jointPositions[j * 3]!;
      const py = jointPositions[j * 3 + 1]!;
      const pz = jointPositions[j * 3 + 2]!;

      // Draw small cross at joint position
      const s = 0.02;
      this.line([px - s, py, pz], [px + s, py, pz], pointColor);
      this.line([px, py - s, pz], [px, py + s, pz], pointColor);
      this.line([px, py, pz - s], [px, py, pz + s], pointColor);

      const parent = parentIndices[j]!;
      if (parent >= 0) {
        const ppx = jointPositions[parent * 3]!;
        const ppy = jointPositions[parent * 3 + 1]!;
        const ppz = jointPositions[parent * 3 + 2]!;
        this.line([px, py, pz], [ppx, ppy, ppz], color);
      }
    }
  }

  /** Draw a wireframe grid on the XZ plane. */
  grid(size: number, divisions: number, color: [number, number, number, number] = [0.3, 0.3, 0.3, 0.4]): void {
    const half = size / 2;
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const t = -half + i * step;
      this.line([t, 0, -half], [t, 0, half], color);
      this.line([-half, 0, t], [half, 0, t], color);
    }
  }

  /** Flush accumulated lines to the GPU and render into the given pass. */
  flush(pass: GPURenderPassEncoder, viewProj: Float32Array): void {
    if (this._count === 0) return;
    this._ensurePipeline();

    const byteLen = this._count * 2 * BYTES_PER_VERTEX;
    this._device.queue.writeBuffer(this._vertexBuf, 0, this._data.buffer as ArrayBuffer, 0, byteLen);
    this._device.queue.writeBuffer(this._uniformBuf, 0, viewProj.buffer as ArrayBuffer, viewProj.byteOffset, 64);

    pass.setPipeline(this._pipeline!);
    pass.setBindGroup(0, this._uniformBG!);
    pass.setVertexBuffer(0, this._vertexBuf);
    pass.drawIndexed?.(this._count * 2) ?? pass.draw(this._count * 2);
  }

  get lineCount(): number { return this._count; }

  destroy(): void {
    this._vertexBuf.destroy();
    this._uniformBuf.destroy();
  }
}

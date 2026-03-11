/**
 * GPU infinite grid renderer for the editor viewport.
 * Renders an XZ plane grid that fades with distance, with colored axis lines.
 */

const GRID_SHADER = /* wgsl */`
struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  gridScale: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) nearFrac: f32,
}

const EXTENT = 100.0;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // Fullscreen-ish XZ quad centered on camera (snapped to grid)
  var corners = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1),
    vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1),
  );
  let uv = corners[vi];
  let snap = floor(u.cameraPos.xz / u.gridScale) * u.gridScale;
  let worldXZ = snap + uv * EXTENT * u.gridScale;

  var o: VOut;
  o.worldPos = vec3f(worldXZ.x, 0.0, worldXZ.y);
  o.clip = u.viewProj * vec4f(o.worldPos, 1.0);
  let dist = length(o.worldPos.xz - u.cameraPos.xz);
  o.nearFrac = 1.0 - smoothstep(EXTENT * u.gridScale * 0.3, EXTENT * u.gridScale * 0.9, dist);
  return o;
}

fn gridLine(coord: f32, lineWidth: f32) -> f32 {
  let d = abs(fract(coord - 0.5) - 0.5);
  let ddx = fwidth(coord);
  return 1.0 - smoothstep(lineWidth * ddx, (lineWidth + 1.0) * ddx, d);
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let scale = u.gridScale;
  let gx = gridLine(v.worldPos.x / scale, 1.0);
  let gz = gridLine(v.worldPos.z / scale, 1.0);
  var alpha = max(gx, gz) * 0.35 * v.nearFrac;

  var color = vec3f(0.5, 0.5, 0.5);

  // Major lines every 10 units
  let mx = gridLine(v.worldPos.x / (scale * 10.0), 1.5);
  let mz = gridLine(v.worldPos.z / (scale * 10.0), 1.5);
  let major = max(mx, mz);
  alpha = max(alpha, major * 0.5 * v.nearFrac);

  // X axis (red)
  if (abs(v.worldPos.z) < scale * 0.1) {
    color = vec3f(0.9, 0.2, 0.2);
    alpha = max(alpha, 0.8 * v.nearFrac);
  }
  // Z axis (blue)
  if (abs(v.worldPos.x) < scale * 0.1) {
    color = vec3f(0.2, 0.4, 0.9);
    alpha = max(alpha, 0.8 * v.nearFrac);
  }

  if (alpha < 0.005) { discard; }
  return vec4f(color, alpha);
}
`;

export class GridRenderer {
  private _device: GPUDevice;
  private _pipeline: GPURenderPipeline | null = null;
  private _uniformBuf: GPUBuffer;
  private _uniformBG: GPUBindGroup | null = null;
  private _bgLayout: GPUBindGroupLayout | null = null;
  private _format: GPUTextureFormat;

  gridScale = 1.0;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this._device = device;
    this._format = format;

    this._uniformBuf = device.createBuffer({
      size: 80, // mat4 + vec3 + f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'grid-uniform',
    });
  }

  private _ensurePipeline(): void {
    if (this._pipeline) return;
    const device = this._device;

    const shader = device.createShaderModule({ code: GRID_SHADER, label: 'grid-shader' });

    this._bgLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    this._uniformBG = device.createBindGroup({
      layout: this._bgLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
    });

    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._bgLayout] }),
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: {
        module: shader, entryPoint: 'fs',
        targets: [{
          format: this._format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
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
  }

  render(pass: GPURenderPassEncoder, viewProj: Float32Array, cameraPos: [number, number, number]): void {
    this._ensurePipeline();

    const data = new Float32Array(20);
    data.set(viewProj, 0);
    data[16] = cameraPos[0];
    data[17] = cameraPos[1];
    data[18] = cameraPos[2];
    data[19] = this.gridScale;

    this._device.queue.writeBuffer(this._uniformBuf, 0, data.buffer as ArrayBuffer, 0, 80);

    pass.setPipeline(this._pipeline!);
    pass.setBindGroup(0, this._uniformBG!);
    pass.draw(6);
  }

  destroy(): void {
    this._uniformBuf.destroy();
  }
}

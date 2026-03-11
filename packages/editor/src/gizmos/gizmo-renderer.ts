/**
 * Transform gizmo renderer — draws translate/rotate/scale handles.
 * Uses the debug line renderer pattern (immediate mode lines rendered each frame).
 */

import { COLORS } from '../ui/theme.js';

const GIZMO_SHADER = /* wgsl */`
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
  // Push gizmo slightly forward in depth
  o.pos.z = o.pos.z * 0.999;
  o.col = v.col;
  return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return v.col;
}
`;

const MAX_VERTS = 8192;
const FLOATS_PER_VERT = 7; // xyz + rgba
const THICKNESS_RATIO = 0.012;

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz' | null;

const AXIS_COLORS: Record<string, [number, number, number, number]> = {
  x:  [0.93, 0.27, 0.27, 1],
  y:  [0.13, 0.77, 0.22, 1],
  z:  [0.23, 0.51, 0.96, 1],
  xy: [0.93, 0.91, 0.15, 0.5],
  xz: [0.93, 0.91, 0.15, 0.5],
  yz: [0.93, 0.91, 0.15, 0.5],
};

function hexToRgba(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1];
}

const HOVER_COLOR = hexToRgba(COLORS.gizmoHover);

export class GizmoRenderer {
  private _device: GPUDevice;
  private _pipeline: GPURenderPipeline | null = null;
  private _uniformBuf: GPUBuffer;
  private _uniformBG: GPUBindGroup | null = null;
  private _vertexBuf: GPUBuffer;
  private _data: Float32Array;
  private _lineCount = 0;
  private _triVerts = 0;
  private _format: GPUTextureFormat;

  hoveredAxis: GizmoAxis = null;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this._device = device;
    this._format = format;
    this._data = new Float32Array(MAX_VERTS * FLOATS_PER_VERT);

    this._vertexBuf = device.createBuffer({
      size: this._data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'gizmo-verts',
    });
    this._uniformBuf = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'gizmo-uniform',
    });
  }

  private _ensurePipeline(): void {
    if (this._pipeline) return;
    const d = this._device;

    const shader = d.createShaderModule({ code: GIZMO_SHADER, label: 'gizmo-shader' });
    const bgLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this._uniformBG = d.createBindGroup({
      layout: bgLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
    });

    this._pipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [bgLayout] }),
      vertex: {
        module: shader, entryPoint: 'vs',
        buffers: [{
          arrayStride: FLOATS_PER_VERT * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
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
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    });
  }

  begin(): void {
    this._lineCount = 0;
    this._triVerts = 0;
  }

  private _pushLine(
    p0: [number, number, number], p1: [number, number, number],
    color: [number, number, number, number],
  ): void {
    const o = this._lineCount * 2 * FLOATS_PER_VERT;
    if (o + 14 > this._data.length) return;
    this._data[o]     = p0[0]; this._data[o + 1] = p0[1]; this._data[o + 2] = p0[2];
    this._data[o + 3] = color[0]; this._data[o + 4] = color[1]; this._data[o + 5] = color[2]; this._data[o + 6] = color[3];
    this._data[o + 7] = p1[0]; this._data[o + 8] = p1[1]; this._data[o + 9] = p1[2];
    this._data[o + 10] = color[0]; this._data[o + 11] = color[1]; this._data[o + 12] = color[2]; this._data[o + 13] = color[3];
    this._lineCount++;
  }

  private _pushThickLine(
    p0: [number, number, number],
    p1: [number, number, number],
    color: [number, number, number, number],
    axisHint: GizmoAxis | 'free',
    scale: number,
  ): void {
    const thickness = Math.max(scale * THICKNESS_RATIO, 0.01);
    this._pushLine(p0, p1, color);

    if (axisHint === 'x') {
      this._pushLine(
        [p0[0], p0[1] + thickness, p0[2]],
        [p1[0], p1[1] + thickness, p1[2]],
        color,
      );
      this._pushLine(
        [p0[0], p0[1], p0[2] + thickness],
        [p1[0], p1[1], p1[2] + thickness],
        color,
      );
      return;
    }

    if (axisHint === 'y') {
      this._pushLine(
        [p0[0] + thickness, p0[1], p0[2]],
        [p1[0] + thickness, p1[1], p1[2]],
        color,
      );
      this._pushLine(
        [p0[0], p0[1], p0[2] + thickness],
        [p1[0], p1[1], p1[2] + thickness],
        color,
      );
      return;
    }

    if (axisHint === 'z') {
      this._pushLine(
        [p0[0] + thickness, p0[1], p0[2]],
        [p1[0] + thickness, p1[1], p1[2]],
        color,
      );
      this._pushLine(
        [p0[0], p0[1] + thickness, p0[2]],
        [p1[0], p1[1] + thickness, p1[2]],
        color,
      );
      return;
    }

    this._pushLine(
      [p0[0] + thickness, p0[1], p0[2]],
      [p1[0] + thickness, p1[1], p1[2]],
      color,
    );
    this._pushLine(
      [p0[0], p0[1] + thickness, p0[2]],
      [p1[0], p1[1] + thickness, p1[2]],
      color,
    );
  }

  drawTranslate(center: [number, number, number], scale: number): void {
    const s = scale;
    const cx = center[0], cy = center[1], cz = center[2];

    const axes: Array<{ axis: GizmoAxis; dir: [number, number, number] }> = [
      { axis: 'x', dir: [s, 0, 0] },
      { axis: 'y', dir: [0, s, 0] },
      { axis: 'z', dir: [0, 0, s] },
    ];

    for (const { axis, dir } of axes) {
      const col = this.hoveredAxis === axis ? HOVER_COLOR : AXIS_COLORS[axis!]!;
      const end: [number, number, number] = [cx + dir[0], cy + dir[1], cz + dir[2]];
      this._pushThickLine(center, end, col, axis, s);

      // Arrow head (two lines forming a V)
      const headLen = s * 0.15;
      for (let i = 0; i < 3; i++) {
        if (dir[i] !== 0) continue;
        const offset = [0, 0, 0];
        offset[i] = headLen;
        const tip = end;
        const base1: [number, number, number] = [
          end[0] - dir[0] * 0.15 + offset[0],
          end[1] - dir[1] * 0.15 + offset[1],
          end[2] - dir[2] * 0.15 + offset[2],
        ];
        const base2: [number, number, number] = [
          end[0] - dir[0] * 0.15 - offset[0],
          end[1] - dir[1] * 0.15 - offset[1],
          end[2] - dir[2] * 0.15 - offset[2],
        ];
        this._pushThickLine(tip, base1, col, 'free', s);
        this._pushThickLine(tip, base2, col, 'free', s);
      }
    }
  }

  drawRotate(center: [number, number, number], scale: number): void {
    const s = scale;
    const segs = 48;

    // LocalTransform currently supports yaw only, so expose a single Y rotation ring.
    const ringAxes: Array<{ axis: GizmoAxis; genPoint: (t: number) => [number, number, number] }> = [
      { axis: 'y', genPoint: (t) => [center[0] + Math.cos(t) * s, center[1], center[2] + Math.sin(t) * s] },
    ];

    for (const { axis, genPoint } of ringAxes) {
      const col = this.hoveredAxis === axis ? HOVER_COLOR : AXIS_COLORS[axis!]!;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI * 2;
        const t1 = ((i + 1) / segs) * Math.PI * 2;
        this._pushThickLine(genPoint(t0), genPoint(t1), col, axis, s);
      }
    }
  }

  drawScale(center: [number, number, number], scale: number): void {
    const s = scale;
    const cx = center[0], cy = center[1], cz = center[2];
    const boxSize = s * 0.08;

    const axes: Array<{ axis: GizmoAxis; dir: [number, number, number] }> = [
      { axis: 'x', dir: [s, 0, 0] },
      { axis: 'y', dir: [0, s, 0] },
      { axis: 'z', dir: [0, 0, s] },
    ];

    for (const { axis, dir } of axes) {
      const col = this.hoveredAxis === axis ? HOVER_COLOR : AXIS_COLORS[axis!]!;
      const end: [number, number, number] = [cx + dir[0], cy + dir[1], cz + dir[2]];
      this._pushThickLine(center, end, col, axis, s);

      // Box at end (4 lines forming a square cross)
      for (let i = 0; i < 3; i++) {
        if (dir[i] !== 0) continue;
        const off: [number, number, number] = [0, 0, 0];
        off[i] = boxSize;
        const a: [number, number, number] = [end[0] + off[0], end[1] + off[1], end[2] + off[2]];
        const b: [number, number, number] = [end[0] - off[0], end[1] - off[1], end[2] - off[2]];
        this._pushThickLine(a, b, col, 'free', s);
      }
    }
  }

  flush(pass: GPURenderPassEncoder, viewProj: Float32Array): void {
    if (this._lineCount === 0) return;
    this._ensurePipeline();

    const byteLen = this._lineCount * 2 * FLOATS_PER_VERT * 4;
    this._device.queue.writeBuffer(this._vertexBuf, 0, this._data.buffer as ArrayBuffer, 0, byteLen);
    this._device.queue.writeBuffer(this._uniformBuf, 0, viewProj.buffer as ArrayBuffer, viewProj.byteOffset, 64);

    pass.setPipeline(this._pipeline!);
    pass.setBindGroup(0, this._uniformBG!);
    pass.setVertexBuffer(0, this._vertexBuf);
    pass.draw(this._lineCount * 2);
  }

  destroy(): void {
    this._vertexBuf.destroy();
    this._uniformBuf.destroy();
  }
}

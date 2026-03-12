export interface GrassMaterialParams {
  baseColor?: [number, number, number];
  tipColor?: [number, number, number];
  windStrength?: number;
  windScale?: number;
  windSpeed?: number;
  ambientStrength?: number;
  translucency?: number;
  patchScale?: number;
}

const GRASS_BUFFER_SIZE = 64;

export class GrassMaterial {
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private readonly _device: GPUDevice;
  private readonly _data = new Float32Array(16);

  baseColor: [number, number, number];
  tipColor: [number, number, number];
  windStrength: number;
  windScale: number;
  windSpeed: number;
  ambientStrength: number;
  translucency: number;
  patchScale: number;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, params: GrassMaterialParams = {}) {
    this._device = device;
    this.baseColor = params.baseColor ?? [0.2, 0.42, 0.15];
    this.tipColor = params.tipColor ?? [0.72, 0.9, 0.42];
    this.windStrength = params.windStrength ?? 0.18;
    this.windScale = params.windScale ?? 0.06;
    this.windSpeed = params.windSpeed ?? 0.9;
    this.ambientStrength = params.ambientStrength ?? 0.42;
    this.translucency = params.translucency ?? 0.24;
    this.patchScale = params.patchScale ?? 0.08;

    this.uniformBuffer = device.createBuffer({
      size: GRASS_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.upload(0);
  }

  updateParams(params: Partial<GrassMaterialParams>): void {
    if (params.baseColor) this.baseColor = params.baseColor;
    if (params.tipColor) this.tipColor = params.tipColor;
    if (params.windStrength !== undefined) this.windStrength = params.windStrength;
    if (params.windScale !== undefined) this.windScale = params.windScale;
    if (params.windSpeed !== undefined) this.windSpeed = params.windSpeed;
    if (params.ambientStrength !== undefined) this.ambientStrength = params.ambientStrength;
    if (params.translucency !== undefined) this.translucency = params.translucency;
    if (params.patchScale !== undefined) this.patchScale = params.patchScale;
  }

  upload(time: number): void {
    const d = this._data;
    d[0] = this.baseColor[0];
    d[1] = this.baseColor[1];
    d[2] = this.baseColor[2];
    d[3] = 1;
    d[4] = this.tipColor[0];
    d[5] = this.tipColor[1];
    d[6] = this.tipColor[2];
    d[7] = 1;
    d[8] = this.windStrength;
    d[9] = this.windScale;
    d[10] = this.windSpeed;
    d[11] = time;
    d[12] = this.ambientStrength;
    d[13] = this.translucency;
    d[14] = this.patchScale;
    d[15] = 1;
    this._device.queue.writeBuffer(this.uniformBuffer, 0, d as Float32Array<ArrayBuffer>);
  }

  destroy(): void {
    this.uniformBuffer.destroy();
  }
}

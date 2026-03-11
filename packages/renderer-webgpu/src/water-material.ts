/**
 * Water material: animated waves (Gerstner-style), Fresnel reflection, environment sampling.
 * Uses the same bind group layout as PBR for camera/light, plus water-specific params.
 */

export interface WaterMaterialParams {
  waveScale?: number;
  waveStrength?: number;
  waveSpeed?: number;
  shallowColor?: [number, number, number];
  deepColor?: [number, number, number];
  foamColor?: [number, number, number];
  edgeFade?: number;
  clarity?: number;
  foamAmount?: number;
}

const WATER_BUFFER_SIZE = 64;

export class WaterMaterial {
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private _data = new Float32Array(16);
  private _device: GPUDevice;
  waveScale: number;
  waveStrength: number;
  waveSpeed: number;
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  foamColor: [number, number, number];
  edgeFade: number;
  clarity: number;
  foamAmount: number;

  constructor(
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    params: WaterMaterialParams = {},
  ) {
    this._device = device;
    this.waveScale = params.waveScale ?? 0.08;
    this.waveStrength = params.waveStrength ?? 1.0;
    this.waveSpeed = params.waveSpeed ?? 0.9;
    this.shallowColor = params.shallowColor ?? [0.17, 0.46, 0.43];
    this.deepColor = params.deepColor ?? [0.02, 0.17, 0.26];
    this.foamColor = params.foamColor ?? [0.84, 0.94, 0.97];
    this.edgeFade = params.edgeFade ?? 0.16;
    this.clarity = params.clarity ?? 0.72;
    this.foamAmount = params.foamAmount ?? 0.65;

    this.uniformBuffer = device.createBuffer({
      size: WATER_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.upload(0);
  }

  /** Upload params to GPU. Call each frame with current time. */
  upload(time: number): void {
    const d = this._data;
    d[0] = time;
    d[1] = this.waveScale;
    d[2] = this.waveStrength;
    d[3] = this.waveSpeed;
    d[4] = this.shallowColor[0];
    d[5] = this.shallowColor[1];
    d[6] = this.shallowColor[2];
    d[7] = this.edgeFade;
    d[8] = this.deepColor[0];
    d[9] = this.deepColor[1];
    d[10] = this.deepColor[2];
    d[11] = this.clarity;
    d[12] = this.foamColor[0];
    d[13] = this.foamColor[1];
    d[14] = this.foamColor[2];
    d[15] = this.foamAmount;
    this._device.queue.writeBuffer(this.uniformBuffer, 0, d as Float32Array<ArrayBuffer>);
  }

  destroy(): void {
    this.uniformBuffer.destroy();
  }
}

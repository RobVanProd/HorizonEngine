/**
 * Scene lighting state: directional light + ambient.
 * Serialized to a GPU uniform buffer matching LightUniforms in pbr.wgsl.
 *
 * Buffer layout (48 bytes):
 *   vec3f dirDirection + pad   (16 bytes)
 *   vec3f dirColor + f32 dirIntensity  (16 bytes)
 *   vec3f ambient + pad        (16 bytes)
 */

export interface DirectionalLight {
  direction: [number, number, number];
  color: [number, number, number];
  intensity: number;
}

export interface SceneLighting {
  directional: DirectionalLight;
  ambient: [number, number, number];
}

const LIGHT_BUFFER_SIZE = 48;

export class LightingState {
  readonly buffer: GPUBuffer;
  private _data = new Float32Array(12);
  private _device: GPUDevice;

  constructor(device: GPUDevice) {
    this._device = device;
    this.buffer = device.createBuffer({
      size: LIGHT_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  update(lighting: SceneLighting): void {
    const d = this._data;
    const dir = lighting.directional;

    // Normalize direction
    const dx = dir.direction[0], dy = dir.direction[1], dz = dir.direction[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    d[0] = dx / len;
    d[1] = dy / len;
    d[2] = dz / len;
    d[3] = 0; // pad

    d[4] = dir.color[0];
    d[5] = dir.color[1];
    d[6] = dir.color[2];
    d[7] = dir.intensity;

    d[8] = lighting.ambient[0];
    d[9] = lighting.ambient[1];
    d[10] = lighting.ambient[2];
    d[11] = 0; // pad

    this._device.queue.writeBuffer(this.buffer, 0, d as Float32Array<ArrayBuffer>);
  }

  destroy(): void {
    this.buffer.destroy();
  }
}

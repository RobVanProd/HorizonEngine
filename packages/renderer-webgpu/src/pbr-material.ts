/**
 * PBR material: metallic-roughness workflow.
 *
 * Each material owns a GPU uniform buffer and bind group containing
 * its parameters and texture bindings. Default 1x1 textures are used
 * when no texture is provided.
 *
 * Uniform buffer layout (64 bytes, matches MaterialUniforms in pbr.wgsl):
 *   vec4f  albedo               (16 bytes)
 *   vec3f  emissive + f32 metallic  (16 bytes)
 *   vec2f  roughness,ao + f32 hasAlbedoTex + f32 hasNormalTex  (16 bytes)
 *   f32 hasMRTex + f32 hasEmissiveTex + vec2f pad  (16 bytes)
 *   Total: 64 bytes
 */

export interface PBRMaterialParams {
  albedo?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  ao?: number;
  albedoTexture?: GPUTexture;
  normalTexture?: GPUTexture;
  mrTexture?: GPUTexture;
  emissiveTexture?: GPUTexture;
}

const MATERIAL_BUFFER_SIZE = 64;

let _defaultWhiteTex: GPUTexture | null = null;
let _defaultNormalTex: GPUTexture | null = null;
let _defaultBlackTex: GPUTexture | null = null;
let _defaultSampler: GPUSampler | null = null;

function getDefaultTextures(device: GPUDevice) {
  if (!_defaultWhiteTex) {
    _defaultWhiteTex = createSolidTexture(device, [255, 255, 255, 255]);
    _defaultNormalTex = createSolidTexture(device, [128, 128, 255, 255]);
    _defaultBlackTex = createSolidTexture(device, [0, 0, 0, 255]);
    _defaultSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
  }
  return {
    white: _defaultWhiteTex,
    normal: _defaultNormalTex!,
    black: _defaultBlackTex!,
    sampler: _defaultSampler!,
  };
}

function createSolidTexture(device: GPUDevice, rgba: [number, number, number, number]): GPUTexture {
  const tex = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: tex },
    new Uint8Array(rgba),
    { bytesPerRow: 4 },
    [1, 1, 1],
  );
  return tex;
}

export class PBRMaterial {
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private _data = new Float32Array(16);
  private _device: GPUDevice;

  albedo: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  ao: number;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, params: PBRMaterialParams = {}) {
    this._device = device;
    this.albedo = params.albedo ?? [1, 1, 1, 1];
    this.metallic = params.metallic ?? 0;
    this.roughness = params.roughness ?? 0.5;
    this.emissive = params.emissive ?? [0, 0, 0];
    this.ao = params.ao ?? 1;

    this.uniformBuffer = device.createBuffer({
      size: MATERIAL_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const defaults = getDefaultTextures(device);

    const albedoTex = params.albedoTexture ?? defaults.white;
    const normalTex = params.normalTexture ?? defaults.normal;
    const mrTex = params.mrTexture ?? defaults.white;
    const emissiveTex = params.emissiveTexture ?? defaults.black;

    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: albedoTex.createView() },
        { binding: 2, resource: normalTex.createView() },
        { binding: 3, resource: mrTex.createView() },
        { binding: 4, resource: emissiveTex.createView() },
        { binding: 5, resource: defaults.sampler },
      ],
    });

    this._writeUniforms(
      !!params.albedoTexture,
      !!params.normalTexture,
      !!params.mrTexture,
      !!params.emissiveTexture,
    );
  }

  /**
   * Upload current parameter values to the GPU.
   */
  upload(): void {
    this._writeUniforms(false, false, false, false);
  }

  updateParams(params: Partial<PBRMaterialParams>): void {
    if (params.albedo) this.albedo = params.albedo;
    if (params.metallic !== undefined) this.metallic = params.metallic;
    if (params.roughness !== undefined) this.roughness = params.roughness;
    if (params.emissive) this.emissive = params.emissive;
    if (params.ao !== undefined) this.ao = params.ao;
    this.upload();
  }

  private _writeUniforms(hasAlbedo: boolean, hasNormal: boolean, hasMR: boolean, hasEmissive: boolean): void {
    const d = this._data;
    d[0] = this.albedo[0];
    d[1] = this.albedo[1];
    d[2] = this.albedo[2];
    d[3] = this.albedo[3];
    d[4] = this.emissive[0];
    d[5] = this.emissive[1];
    d[6] = this.emissive[2];
    d[7] = this.metallic;
    d[8] = this.roughness;
    d[9] = this.ao;
    d[10] = hasAlbedo ? 1 : 0;
    d[11] = hasNormal ? 1 : 0;
    d[12] = hasMR ? 1 : 0;
    d[13] = hasEmissive ? 1 : 0;
    d[14] = 0;
    d[15] = 0;
    this._device.queue.writeBuffer(this.uniformBuffer, 0, d as Float32Array<ArrayBuffer>);
  }

  destroy(): void {
    this.uniformBuffer.destroy();
  }
}

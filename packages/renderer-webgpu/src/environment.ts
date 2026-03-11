/**
 * IBL environment pipeline.
 *
 * Generates all textures needed for image-based lighting:
 * 1. Procedural sky → cubemap (or load from equirectangular HDR)
 * 2. Specular pre-filtered cubemap (roughness mip chain)
 * 3. Diffuse irradiance cubemap
 * 4. BRDF integration LUT
 */

import genCubemapSource from './shaders/gen-cubemap.wgsl?raw';
import equirectToCubeSource from './shaders/equirect-to-cube.wgsl?raw';
import prefilterSource from './shaders/prefilter-specular.wgsl?raw';
import irradianceSource from './shaders/irradiance-conv.wgsl?raw';
import brdfLutSource from './shaders/brdf-lut.wgsl?raw';

export interface EnvironmentConfig {
  cubemapSize?: number;
  irradianceSize?: number;
  brdfLutSize?: number;
  prefilterSamples?: number;
  brdfSamples?: number;
  sunDirection?: [number, number, number];
  sunIntensity?: number;
  /** Provide HDR float RGB data to use a real environment map instead of procedural sky */
  hdrData?: { width: number; height: number; data: Float32Array };
  /** Choose whether the visible skybox uses the environment probe or a procedural sky. */
  backgroundSource?: 'environment' | 'procedural';
}

export class Environment {
  readonly envCubemap: GPUTexture;
  readonly envCubemapView: GPUTextureView;
  readonly skyboxCubemap: GPUTexture;
  readonly skyboxCubemapView: GPUTextureView;
  readonly prefilteredMap: GPUTexture;
  readonly prefilteredView: GPUTextureView;
  readonly irradianceMap: GPUTexture;
  readonly irradianceView: GPUTextureView;
  readonly brdfLUT: GPUTexture;
  readonly brdfLUTView: GPUTextureView;
  readonly maxMipLevel: number;
  readonly sampler: GPUSampler;

  private constructor(
    envCubemap: GPUTexture,
    skyboxCubemap: GPUTexture,
    prefilteredMap: GPUTexture,
    irradianceMap: GPUTexture,
    brdfLUT: GPUTexture,
    maxMipLevel: number,
    sampler: GPUSampler,
  ) {
    this.envCubemap = envCubemap;
    this.envCubemapView = envCubemap.createView({ dimension: 'cube' });
    this.skyboxCubemap = skyboxCubemap;
    this.skyboxCubemapView = skyboxCubemap.createView({ dimension: 'cube' });
    this.prefilteredMap = prefilteredMap;
    this.prefilteredView = prefilteredMap.createView({ dimension: 'cube' });
    this.irradianceMap = irradianceMap;
    this.irradianceView = irradianceMap.createView({ dimension: 'cube' });
    this.brdfLUT = brdfLUT;
    this.brdfLUTView = brdfLUT.createView();
    this.maxMipLevel = maxMipLevel;
    this.sampler = sampler;
  }

  static async generate(device: GPUDevice, config: EnvironmentConfig = {}): Promise<Environment> {
    const cubemapSize = config.cubemapSize ?? 512;
    const irradianceSize = config.irradianceSize ?? 32;
    const brdfLutSize = config.brdfLutSize ?? 512;
    const prefilterSamples = config.prefilterSamples ?? 512;
    const brdfSamples = config.brdfSamples ?? 512;
    const sunDir = config.sunDirection ?? [0.5, 0.7, 0.3];
    const sunIntensity = config.sunIntensity ?? 40.0;
    const backgroundSource = config.backgroundSource ?? (config.hdrData ? 'environment' : 'procedural');

    const mipLevels = 5;

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    // Step 1: Generate cubemap from HDRI or procedural sky
    const envCubemap = device.createTexture({
      label: 'env-cubemap',
      size: [cubemapSize, cubemapSize, 6],
      format: 'rgba16float',
      mipLevelCount: mipLevels,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    if (config.hdrData) {
      console.log(`[IBL] Converting equirectangular HDR (${config.hdrData.width}x${config.hdrData.height}) → cubemap ${cubemapSize}...`);
      await convertEquirectToCubemap(device, config.hdrData, envCubemap, cubemapSize, sampler);
    } else {
      await generateProceduralSky(device, envCubemap, cubemapSize, sunDir, sunIntensity);
    }
    await verifyTexture(device, envCubemap, cubemapSize, 'envCubemap');

    // Generate source cubemap mipmaps (needed for filtered importance sampling in prefilter)
    await generateCubemapMipmaps(device, envCubemap, cubemapSize, mipLevels);

    let skyboxCubemap = envCubemap;
    if (config.hdrData && backgroundSource === 'procedural') {
      skyboxCubemap = device.createTexture({
        label: 'skybox-cubemap',
        size: [cubemapSize, cubemapSize, 6],
        format: 'rgba16float',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
      await generateProceduralSky(device, skyboxCubemap, cubemapSize, sunDir, sunIntensity);
      await verifyTexture(device, skyboxCubemap, cubemapSize, 'skyboxCubemap');
    }

    // Step 2: Pre-filter specular cubemap
    const prefilteredMap = device.createTexture({
      label: 'prefiltered-specular',
      size: [cubemapSize, cubemapSize, 6],
      format: 'rgba16float',
      mipLevelCount: mipLevels,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    await prefilterSpecular(device, envCubemap, prefilteredMap, cubemapSize, mipLevels, prefilterSamples, sampler);
    await verifyTexture(device, prefilteredMap, cubemapSize, 'prefilteredMap');

    // Step 3: Irradiance convolution
    const irradianceMap = device.createTexture({
      label: 'irradiance-map',
      size: [irradianceSize, irradianceSize, 6],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    await computeIrradiance(device, envCubemap, irradianceMap, irradianceSize, sampler);
    await verifyTexture(device, irradianceMap, irradianceSize, 'irradianceMap');

    // Step 4: BRDF LUT
    const brdfLUT = device.createTexture({
      label: 'brdf-lut',
      size: [brdfLutSize, brdfLutSize],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    await computeBrdfLUT(device, brdfLUT, brdfLutSize, brdfSamples);
    await verifyTexture2D(device, brdfLUT, brdfLutSize, 'brdfLUT');

    return new Environment(envCubemap, skyboxCubemap, prefilteredMap, irradianceMap, brdfLUT, mipLevels - 1, sampler);
  }

  destroy(): void {
    this.envCubemap.destroy();
    if (this.skyboxCubemap !== this.envCubemap) this.skyboxCubemap.destroy();
    this.prefilteredMap.destroy();
    this.irradianceMap.destroy();
    this.brdfLUT.destroy();
  }
}

async function verifyTexture(
  device: GPUDevice,
  texture: GPUTexture,
  size: number,
  label: string,
): Promise<void> {
  const bytesPerPixel = 8; // rgba16float
  const rowBytes = size * bytesPerPixel;
  const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const bufferSize = alignedRowBytes; // 1 row

  const staging = device.createBuffer({ size: bufferSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, origin: { x: 0, y: size >> 1, z: 0 } },
    { buffer: staging, bytesPerRow: alignedRowBytes },
    { width: size, height: 1, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Uint16Array(staging.getMappedRange());
  const samples = [];
  for (let i = 0; i < Math.min(8, size); i++) {
    const r = float16ToFloat32(data[i * 4]!);
    const g = float16ToFloat32(data[i * 4 + 1]!);
    const b = float16ToFloat32(data[i * 4 + 2]!);
    samples.push(`(${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)})`);
  }
  console.log(`[IBL] ${label} face0 row${size >> 1}: ${samples.join(' ')}`);
  staging.unmap();
  staging.destroy();
}

async function verifyTexture2D(
  device: GPUDevice,
  texture: GPUTexture,
  size: number,
  label: string,
): Promise<void> {
  const bytesPerPixel = 8;
  const rowBytes = size * bytesPerPixel;
  const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const staging = device.createBuffer({ size: alignedRowBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, origin: { x: 0, y: size >> 1, z: 0 } },
    { buffer: staging, bytesPerRow: alignedRowBytes },
    { width: size, height: 1, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Uint16Array(staging.getMappedRange());
  const samples = [];
  for (let i = 0; i < Math.min(8, size); i++) {
    const r = float16ToFloat32(data[i * 4]!);
    const g = float16ToFloat32(data[i * 4 + 1]!);
    samples.push(`(${r.toFixed(3)},${g.toFixed(3)})`);
  }
  console.log(`[IBL] ${label} row${size >> 1}: ${samples.join(' ')}`);
  staging.unmap();
  staging.destroy();
}

function float16ToFloat32(h: number): number {
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1f) return frac ? NaN : (sign ? -Infinity : Infinity);
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

async function runComputeWithErrorCheck(
  device: GPUDevice,
  label: string,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: [number, number, number?],
): Promise<void> {
  device.pushErrorScope('validation');
  const encoder = device.createCommandEncoder({ label: `${label}-encoder` });
  const pass = encoder.beginComputePass({ label: `${label}-pass` });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  if (workgroups[2] != null) {
    pass.dispatchWorkgroups(workgroups[0], workgroups[1], workgroups[2]);
  } else {
    pass.dispatchWorkgroups(workgroups[0], workgroups[1]);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const err = await device.popErrorScope();
  if (err) console.error(`[IBL] ${label} GPU ERROR:`, err.message);
  else console.log(`[IBL] ${label} OK`);
}

async function generateProceduralSky(
  device: GPUDevice,
  target: GPUTexture,
  size: number,
  sunDir: [number, number, number],
  sunIntensity: number,
): Promise<void> {
  const module = device.createShaderModule({ code: genCubemapSource, label: 'gen-cubemap' });

  const paramsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramsData = new Float32Array([sunDir[0], sunDir[1], sunDir[2], sunIntensity]);
  const paramsU32 = new Uint32Array([size, 0, 0, 0]);
  device.queue.writeBuffer(paramsBuffer, 0, paramsData as Float32Array<ArrayBuffer>);
  device.queue.writeBuffer(paramsBuffer, 16, paramsU32 as Uint32Array<ArrayBuffer>);

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: target.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
    ],
  });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });

  await runComputeWithErrorCheck(device, 'genCubemap', pipeline, bindGroup,
    [Math.ceil(size / 8), Math.ceil(size / 8), 6]);

  paramsBuffer.destroy();
}

async function generateCubemapMipmaps(
  device: GPUDevice,
  cubemap: GPUTexture,
  size: number,
  mipLevels: number,
): Promise<void> {
  const module = device.createShaderModule({
    label: 'cubemap-mipgen',
    code: /* wgsl */`
      var<private> pos: array<vec2f, 3> = array(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0),
      );
      struct VertOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VertOut {
        var out: VertOut;
        out.position = vec4f(pos[i], 0.0, 1.0);
        out.uv = pos[i] * vec2f(0.5, -0.5) + 0.5;
        return out;
      }
      @group(0) @binding(0) var srcTex: texture_2d<f32>;
      @group(0) @binding(1) var srcSampler: sampler;
      @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
        return textureSample(srcTex, srcSampler, uv);
      }
    `,
  });

  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
  });

  const encoder = device.createCommandEncoder({ label: 'cubemap-mipgen' });

  for (let mip = 1; mip < mipLevels; mip++) {
    for (let face = 0; face < 6; face++) {
      const srcView = cubemap.createView({
        dimension: '2d',
        baseArrayLayer: face,
        arrayLayerCount: 1,
        baseMipLevel: mip - 1,
        mipLevelCount: 1,
      });

      const dstView = cubemap.createView({
        dimension: '2d',
        baseArrayLayer: face,
        arrayLayerCount: 1,
        baseMipLevel: mip,
        mipLevelCount: 1,
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: sampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
  }

  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  console.log(`[IBL] envCubemap mipmaps generated (${mipLevels} levels)`);
}

async function prefilterSpecular(
  device: GPUDevice,
  source: GPUTexture,
  target: GPUTexture,
  baseSize: number,
  mipLevels: number,
  sampleCount: number,
  sampler: GPUSampler,
): Promise<void> {
  const module = device.createShaderModule({ code: prefilterSource, label: 'prefilter-specular' });
  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sourceView = source.createView({ dimension: 'cube' });

  for (let mip = 0; mip < mipLevels; mip++) {
    const mipSize = Math.max(1, baseSize >> mip);
    const roughness = mip / (mipLevels - 1);

    const paramsF32 = new Float32Array([roughness, 0, 0, 0]);
    const paramsU32 = new Uint32Array(paramsF32.buffer);
    paramsU32[1] = mipSize;
    paramsU32[2] = sampleCount;
    paramsU32[3] = baseSize;
    device.queue.writeBuffer(paramsBuffer, 0, paramsF32 as Float32Array<ArrayBuffer>);

    const mipView = target.createView({
      dimension: '2d-array',
      baseMipLevel: mip,
      mipLevelCount: 1,
    });

    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: mipView },
      ],
    });

    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main' },
    });

    await runComputeWithErrorCheck(device, `prefilter-mip${mip}`, pipeline, bindGroup,
      [Math.ceil(mipSize / 8), Math.ceil(mipSize / 8), 6]);
  }

  paramsBuffer.destroy();
}

async function computeIrradiance(
  device: GPUDevice,
  source: GPUTexture,
  target: GPUTexture,
  size: number,
  sampler: GPUSampler,
): Promise<void> {
  const module = device.createShaderModule({ code: irradianceSource, label: 'irradiance-conv' });

  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramsU32 = new Uint32Array([size, 0, 0, 0]);
  device.queue.writeBuffer(paramsBuffer, 0, paramsU32 as Uint32Array<ArrayBuffer>);

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: 'cube' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: source.createView({ dimension: 'cube' }) },
      { binding: 1, resource: sampler },
      { binding: 2, resource: target.createView({ dimension: '2d-array' }) },
      { binding: 3, resource: { buffer: paramsBuffer } },
    ],
  });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });

  await runComputeWithErrorCheck(device, 'irradiance', pipeline, bindGroup,
    [Math.ceil(size / 8), Math.ceil(size / 8), 6]);

  paramsBuffer.destroy();
}

async function computeBrdfLUT(
  device: GPUDevice,
  target: GPUTexture,
  size: number,
  sampleCount: number,
): Promise<void> {
  const module = device.createShaderModule({ code: brdfLutSource, label: 'brdf-lut' });

  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramsU32 = new Uint32Array([size, sampleCount, 0, 0]);
  device.queue.writeBuffer(paramsBuffer, 0, paramsU32 as Uint32Array<ArrayBuffer>);

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: target.createView() },
      { binding: 1, resource: { buffer: paramsBuffer } },
    ],
  });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });

  await runComputeWithErrorCheck(device, 'brdfLUT', pipeline, bindGroup,
    [Math.ceil(size / 8), Math.ceil(size / 8)]);

  paramsBuffer.destroy();
}

async function convertEquirectToCubemap(
  device: GPUDevice,
  hdr: { width: number; height: number; data: Float32Array },
  target: GPUTexture,
  cubemapSize: number,
  sampler: GPUSampler,
): Promise<void> {
  // Upload HDR data as rgba16float 2D texture (convert RGB→RGBA)
  const pixelCount = hdr.width * hdr.height;
  const rgba = new Float32Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = hdr.data[i * 3]!;
    rgba[i * 4 + 1] = hdr.data[i * 3 + 1]!;
    rgba[i * 4 + 2] = hdr.data[i * 3 + 2]!;
    rgba[i * 4 + 3] = 1.0;
  }

  // Use rgba32float for the equirect source (full precision)
  const equirectTex = device.createTexture({
    label: 'equirect-hdr',
    size: [hdr.width, hdr.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.writeTexture(
    { texture: equirectTex },
    rgba as Float32Array<ArrayBuffer>,
    { bytesPerRow: hdr.width * 16 },
    { width: hdr.width, height: hdr.height },
  );

  const module = device.createShaderModule({ code: equirectToCubeSource, label: 'equirect-to-cube' });

  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramsU32 = new Uint32Array([cubemapSize, 0, 0, 0]);
  device.queue.writeBuffer(paramsBuffer, 0, paramsU32 as Uint32Array<ArrayBuffer>);

  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: equirectTex.createView() },
      { binding: 1, resource: target.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });

  await runComputeWithErrorCheck(device, 'equirectToCube', pipeline, bindGroup,
    [Math.ceil(cubemapSize / 8), Math.ceil(cubemapSize / 8), 6]);

  paramsBuffer.destroy();
  equirectTex.destroy();
}

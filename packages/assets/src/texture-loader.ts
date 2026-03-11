/**
 * Load an image from a URL and create a GPUTexture with mipmaps.
 */

export interface TextureOptions {
  generateMipmaps?: boolean;
  sRGB?: boolean;
  flipY?: boolean;
}

export async function loadTexture(
  device: GPUDevice,
  url: string,
  options: TextureOptions = {},
): Promise<GPUTexture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load texture: ${url} (${response.status})`);

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

  const format: GPUTextureFormat = options.sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
  const mipCount = options.generateMipmaps !== false
    ? Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1
    : 1;

  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format,
    mipLevelCount: mipCount,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: options.flipY ?? false },
    { texture, mipLevel: 0 },
    [bitmap.width, bitmap.height],
  );

  if (mipCount > 1) {
    generateMipmaps(device, texture, bitmap.width, bitmap.height, mipCount, format);
  }

  bitmap.close();
  return texture;
}

/**
 * Create a solid-color 1x1 texture.
 */
export function createSolidColorTexture(
  device: GPUDevice,
  color: [number, number, number, number],
): GPUTexture {
  const tex = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: tex },
    new Uint8Array([
      Math.round(color[0] * 255),
      Math.round(color[1] * 255),
      Math.round(color[2] * 255),
      Math.round(color[3] * 255),
    ]),
    { bytesPerRow: 4 },
    [1, 1, 1],
  );
  return tex;
}

// Mipmap generation via blit pipeline — one pipeline per texture format
const _mipmapPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
let _mipmapSampler: GPUSampler | null = null;

function getMipmapPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  let pipeline = _mipmapPipelines.get(format);
  if (pipeline) return pipeline;

  const module = device.createShaderModule({
    code: /* wgsl */`
      var<private> pos: array<vec2f, 3> = array(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0),
      );

      struct VertOut {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
      };

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

  if (!_mipmapSampler) {
    _mipmapSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }

  pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  _mipmapPipelines.set(format, pipeline);
  return pipeline;
}

function generateMipmaps(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  mipCount: number,
  format: GPUTextureFormat,
): void {
  const pipeline = getMipmapPipeline(device, format);
  const encoder = device.createCommandEncoder();

  let mipWidth = width;
  let mipHeight = height;

  for (let level = 1; level < mipCount; level++) {
    mipWidth = Math.max(1, mipWidth >> 1);
    mipHeight = Math.max(1, mipHeight >> 1);

    const srcView = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
    const dstView = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: _mipmapSampler! },
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

  device.queue.submit([encoder.finish()]);
}

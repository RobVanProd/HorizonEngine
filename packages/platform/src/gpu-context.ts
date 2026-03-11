export interface GPUContextOptions {
  canvas: HTMLCanvasElement;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
  alphaMode?: GPUCanvasAlphaMode;
  presentationFormat?: GPUTextureFormat;
}

export interface GPUContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;

  getCurrentTexture(): GPUTexture;
  resize(width: number, height: number): void;
  destroy(): void;
}

/**
 * Attempt to acquire a GPUAdapter with progressive fallbacks:
 *   1. Requested powerPreference (default: high-performance)
 *   2. No preference
 *   3. Low-power
 *   4. Force software/fallback adapter
 */
async function acquireAdapter(powerPreference?: GPUPowerPreference): Promise<GPUAdapter> {
  if (!navigator.gpu) {
    throw new Error('WebGPU API not available (navigator.gpu is undefined)');
  }

  const attempts: Array<{ label: string; opts: GPURequestAdapterOptions }> = [
    { label: `powerPreference="${powerPreference ?? 'high-performance'}"`, opts: { powerPreference: powerPreference ?? 'high-performance' } },
    { label: 'no preference', opts: {} },
    { label: 'low-power', opts: { powerPreference: 'low-power' } },
    { label: 'forceFallbackAdapter (software)', opts: { forceFallbackAdapter: true } },
  ];

  for (const { label, opts } of attempts) {
    try {
      console.log(`[GPU] Trying adapter: ${label}`);
      const adapter = await navigator.gpu.requestAdapter(opts);
      if (adapter) {
        console.log(`[GPU] Acquired adapter via: ${label}`);
        try {
          const info = adapter.info;
          console.log(`[GPU] Adapter info:`, info);
        } catch { /* info not always available */ }
        return adapter;
      }
      console.warn(`[GPU] requestAdapter(${label}) returned null`);
    } catch (e) {
      console.warn(`[GPU] requestAdapter(${label}) threw:`, e);
    }
  }

  throw new Error(
    'Failed to obtain GPUAdapter after all fallback attempts.\n\n' +
    'Possible fixes:\n' +
    '  • Linux: launch Chrome with --enable-unsafe-webgpu --enable-features=Vulkan\n' +
    '  • Verify your GPU drivers support Vulkan: run vulkaninfo in a terminal\n' +
    '  • Check chrome://gpu for WebGPU status\n' +
    '  • Try chrome://flags → #enable-unsafe-webgpu → Enabled',
  );
}

export async function createGPUContext(options: GPUContextOptions): Promise<GPUContext> {
  const adapter = await acquireAdapter(options.powerPreference);

  const device = await adapter.requestDevice({
    requiredFeatures: options.requiredFeatures,
    requiredLimits: options.requiredLimits,
  });

  device.lost.then((info) => {
    console.error(`WebGPU device lost: ${info.reason}`, info.message);
  });

  const context = options.canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU canvas context');
  }

  const format = options.presentationFormat ?? navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: options.alphaMode ?? 'premultiplied',
  });

  const gpuContext: GPUContext = {
    adapter,
    device,
    context,
    format,
    canvas: options.canvas,

    getCurrentTexture() {
      return context.getCurrentTexture();
    },

    resize(width: number, height: number) {
      options.canvas.width = width;
      options.canvas.height = height;
    },

    destroy() {
      device.destroy();
    },
  };

  return gpuContext;
}

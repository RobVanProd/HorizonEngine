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

export async function createGPUContext(options: GPUContextOptions): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  if (!adapter) {
    throw new Error('Failed to obtain GPUAdapter');
  }

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

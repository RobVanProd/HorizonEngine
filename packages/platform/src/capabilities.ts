export interface PlatformCapabilities {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly atomics: boolean;
  readonly offscreenCanvas: boolean;
  readonly webWorkers: boolean;
  readonly webAudio: boolean;
  readonly pointerLock: boolean;
  readonly gamepad: boolean;
  readonly maxWorkers: number;
}

let cachedCapabilities: PlatformCapabilities | null = null;

export function detectCapabilities(): PlatformCapabilities {
  if (cachedCapabilities) return cachedCapabilities;

  const isBrowser = typeof globalThis.navigator !== 'undefined';

  cachedCapabilities = Object.freeze({
    webgpu: isBrowser && 'gpu' in navigator,
    webgl2: isBrowser && (() => {
      try {
        const canvas = document.createElement('canvas');
        return !!canvas.getContext('webgl2');
      } catch {
        return false;
      }
    })(),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    atomics: typeof Atomics !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    webWorkers: typeof Worker !== 'undefined',
    webAudio: typeof AudioContext !== 'undefined' || typeof (globalThis as any).webkitAudioContext !== 'undefined',
    pointerLock: isBrowser && 'exitPointerLock' in document,
    gamepad: isBrowser && 'getGamepads' in navigator,
    maxWorkers: isBrowser ? (navigator.hardwareConcurrency ?? 4) : 1,
  });

  return cachedCapabilities;
}

export function requireWebGPU(): void {
  const caps = detectCapabilities();
  if (!caps.webgpu) {
    throw new Error(
      'WebGPU is not available in this browser. ' +
      'Please use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.',
    );
  }
}

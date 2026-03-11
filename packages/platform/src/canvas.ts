export interface CanvasOptions {
  width?: number;
  height?: number;
  container?: HTMLElement;
  pixelRatio?: number;
  autoResize?: boolean;
}

export interface ManagedCanvas {
  readonly element: HTMLCanvasElement;
  readonly pixelRatio: number;
  width: number;
  height: number;
  destroy(): void;
}

/**
 * Create and manage a canvas element with automatic DPR handling and resize observation.
 */
export function createCanvas(options: CanvasOptions = {}): ManagedCanvas {
  const container = options.container ?? document.body;
  const pixelRatio = options.pixelRatio ?? Math.min(devicePixelRatio, 2);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  let destroyed = false;
  let width = options.width ?? container.clientWidth;
  let height = options.height ?? container.clientHeight;

  function applySize(): void {
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
  }

  applySize();

  let observer: ResizeObserver | null = null;
  if (options.autoResize !== false) {
    observer = new ResizeObserver((entries) => {
      if (destroyed) return;
      for (const entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
      }
      applySize();
    });
    observer.observe(container);
  }

  return {
    element: canvas,
    pixelRatio,
    get width() { return width; },
    set width(w: number) { width = w; applySize(); },
    get height() { return height; },
    set height(h: number) { height = h; applySize(); },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      canvas.remove();
    },
  };
}

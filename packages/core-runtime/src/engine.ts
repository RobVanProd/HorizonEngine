import { World } from '@engine/ecs';
import { detectCapabilities, createGPUContext, createCanvas, InputState, type GPUContext, type ManagedCanvas } from '@engine/platform';
import { Renderer } from '@engine/renderer-webgpu';
import { Scheduler, FrameLoop, type FrameContext } from '@engine/scheduler';
import { CpuTimer, FrameMetrics } from '@engine/profiler';

export interface EngineOptions {
  container?: HTMLElement;
  pixelRatio?: number;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
}

/**
 * The Engine class bootstraps and orchestrates all subsystems.
 * This is the primary entry point for creating an engine instance.
 */
export class Engine {
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly input: InputState;
  readonly frameMetrics: FrameMetrics;
  readonly cpuTimer: CpuTimer;

  private _canvas!: ManagedCanvas;
  private _gpu!: GPUContext;
  private _renderer!: Renderer;
  private _frameLoop!: FrameLoop;
  private _initialized = false;

  constructor() {
    this.world = new World();
    this.scheduler = new Scheduler();
    this.input = new InputState();
    this.frameMetrics = new FrameMetrics();
    this.cpuTimer = new CpuTimer();
  }

  get gpu(): GPUContext {
    return this._gpu;
  }

  get renderer(): Renderer {
    return this._renderer;
  }

  get canvas(): ManagedCanvas {
    return this._canvas;
  }

  async initialize(options: EngineOptions = {}): Promise<void> {
    if (this._initialized) return;

    const caps = detectCapabilities();
    console.log('[Engine] Platform capabilities:', caps);

    if (!caps.webgpu) {
      throw new Error('WebGPU is required but not available.');
    }

    this._canvas = createCanvas({
      container: options.container,
      pixelRatio: options.pixelRatio,
      autoResize: true,
    });

    this._gpu = await createGPUContext({
      canvas: this._canvas.element,
      powerPreference: options.powerPreference ?? 'high-performance',
      requiredFeatures: options.requiredFeatures,
    });

    console.log('[Engine] GPU adapter:', this._gpu.adapter.info);
    console.log('[Engine] Presentation format:', this._gpu.format);

    this._renderer = new Renderer(this._gpu);
    await this._renderer.initialize();

    this.input.attach(this._canvas.element);

    const resizeObserver = new ResizeObserver(() => {
      this._renderer.handleResize();
    });
    resizeObserver.observe(this._canvas.element);

    this._frameLoop = new FrameLoop({
      onFrame: (ctx) => this._onFrame(ctx),
      onError: (err) => console.error('[Engine] Frame error:', err),
    });

    this._initialized = true;
    console.log('[Engine] Initialized successfully');
  }

  start(): void {
    if (!this._initialized) {
      throw new Error('Engine must be initialized before starting. Call initialize() first.');
    }
    this._frameLoop.start();
    console.log('[Engine] Started');
  }

  stop(): void {
    this._frameLoop?.stop();
  }

  destroy(): void {
    this.stop();
    this.input.detach();
    this._renderer?.destroy();
    this._gpu?.destroy();
    this._canvas?.destroy();
  }

  private _onFrame(ctx: FrameContext): void {
    this.cpuTimer.start('frame');
    this.frameMetrics.beginFrame(ctx.timestamp);

    this.cpuTimer.start('input');
    this.input.update();
    this.cpuTimer.stop('input');

    this.scheduler.execute(ctx);

    this.cpuTimer.stop('frame');
  }
}

import { World } from '@engine/ecs';
import { detectCapabilities, createGPUContext, createCanvas, InputState, type GPUContext, type ManagedCanvas } from '@engine/platform';
import {
  Renderer,
  PBRRenderer,
  type SceneLighting,
  type EnvironmentConfig,
  type ShadowConfig,
  type GPUMesh,
  type PBRMaterial,
  type PBRMaterialParams,
  type WaterMaterial,
  createRenderSystem,
  type RenderSystemContext,
} from '@engine/renderer-webgpu';
import { Scheduler, FrameLoop, Phase, type FrameContext } from '@engine/scheduler';
import { CpuTimer, FrameMetrics } from '@engine/profiler';
import { AudioEngine, createAudioSystem, type AudioHandle, type AudioRegistries } from '@engine/audio';

export interface EngineOptions {
  container?: HTMLElement;
  pixelRatio?: number;
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  /** Use 'pbr' for PBR rendering with IBL, shadows, and skybox. Default: 'simple'. */
  renderer?: 'simple' | 'pbr';
}

export interface PBRInitOptions {
  environment?: EnvironmentConfig;
  shadow?: ShadowConfig;
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

  /** Mesh handle registry — maps numeric handles to GPUMesh instances. */
  readonly meshes = new Map<number, GPUMesh>();
  /** Material handle registry — maps numeric handles to PBRMaterial instances. */
  readonly materials = new Map<number, PBRMaterial>();
  /** Water material registry — maps handles to WaterMaterial instances. */
  readonly waterMaterials = new Map<number, WaterMaterial>();
  /** Audio clip registry — maps numeric handles to AudioEngine buffer handles. */
  readonly audioClips = new Map<number, AudioHandle>();
  /** Human-readable scene labels for hierarchy and tooling surfaces. */
  readonly entityLabels = new Map<number, string>();

  private _canvas!: ManagedCanvas;
  private _gpu!: GPUContext;
  private _simpleRenderer: Renderer | null = null;
  private _pbrRenderer: PBRRenderer | null = null;
  private _audioEngine: AudioEngine | null = null;
  private _frameLoop!: FrameLoop;
  private _initialized = false;
  private _rendererType: 'simple' | 'pbr' = 'simple';

  private _lighting: SceneLighting = {
    direction: [-0.5, -0.8, -0.3],
    color: [1, 0.98, 0.92],
    intensity: 3.0,
    ambient: [0.01, 0.01, 0.02],
    envIntensity: 1.0,
    pointLights: [],
    shadowBias: 0.003,
    debugView: 'lit',
  };

  private _cameraVP = new Float32Array(16);
  private _cameraEye: [number, number, number] = [0, 5, 15];

  private _nextHandle = 1;

  constructor() {
    this.world = new World();
    this.scheduler = new Scheduler();
    this.input = new InputState();
    this.frameMetrics = new FrameMetrics();
    this.cpuTimer = new CpuTimer();
  }

  get gpu(): GPUContext { return this._gpu; }

  get renderer(): Renderer {
    if (!this._simpleRenderer) throw new Error('Engine not initialized with simple renderer');
    return this._simpleRenderer;
  }

  get pbrRenderer(): PBRRenderer {
    if (!this._pbrRenderer) throw new Error('Engine not initialized with PBR renderer');
    return this._pbrRenderer;
  }

  get canvas(): ManagedCanvas { return this._canvas; }

  get lighting(): SceneLighting { return this._lighting; }
  set lighting(l: SceneLighting) { this._lighting = l; }

  get cameraEye(): [number, number, number] { return this._cameraEye; }

  get audio(): AudioEngine {
    if (!this._audioEngine) {
      this._audioEngine = new AudioEngine();
    }
    return this._audioEngine;
  }

  setCamera(vp: Float32Array, eye: [number, number, number]): void {
    this._cameraVP.set(vp);
    this._cameraEye = eye;
  }

  setEntityLabel(entityId: number, label: string | null | undefined): void {
    const trimmed = label?.trim();
    if (!trimmed) {
      this.entityLabels.delete(entityId);
      return;
    }
    this.entityLabels.set(entityId, trimmed);
  }

  getEntityLabel(entityId: number): string | undefined {
    return this.entityLabels.get(entityId);
  }

  /** Allocate a handle, register a mesh, and return the handle. */
  registerMesh(mesh: GPUMesh): number {
    const h = this._nextHandle++;
    this.meshes.set(h, mesh);
    return h;
  }

  /** Allocate a handle, register a material, and return the handle. */
  registerMaterial(mat: PBRMaterial): number {
    const h = this._nextHandle++;
    this.materials.set(h, mat);
    return h;
  }

  /** Convenience: create a PBR material via the PBR renderer and register it. */
  createMaterial(params?: PBRMaterialParams): { handle: number; material: PBRMaterial } {
    const mat = this.pbrRenderer.createMaterial(params);
    const handle = this.registerMaterial(mat);
    return { handle, material: mat };
  }

  /** Create a water material and register it. Returns handle for WaterRef. */
  createWaterMaterial(params?: {
    waveScale?: number;
    waveStrength?: number;
    waveSpeed?: number;
    shallowColor?: [number, number, number];
    deepColor?: [number, number, number];
    foamColor?: [number, number, number];
    edgeFade?: number;
    clarity?: number;
    foamAmount?: number;
  }): { handle: number; material: WaterMaterial } {
    const mat = this.pbrRenderer.createWaterMaterial(params);
    const handle = this._nextHandle++;
    this.waterMaterials.set(handle, mat);
    return { handle, material: mat };
  }

  /** Register an audio clip handle and return an engine handle for use with AudioSource components. */
  registerAudioClip(audioHandle: AudioHandle): number {
    const h = this._nextHandle++;
    this.audioClips.set(h, audioHandle);
    return h;
  }

  /** Load an audio clip from URL, register it, and return the engine handle. */
  async loadAudioClip(url: string): Promise<number> {
    const bufHandle = await this.audio.loadBuffer(url);
    return this.registerAudioClip(bufHandle);
  }

  async initialize(options: EngineOptions = {}, pbrInit?: PBRInitOptions): Promise<void> {
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

    this._rendererType = options.renderer ?? 'simple';

    if (this._rendererType === 'pbr') {
      this._pbrRenderer = new PBRRenderer(this._gpu);
      await this._pbrRenderer.initialize(pbrInit?.environment, pbrInit?.shadow);

      const rsCtx: RenderSystemContext = {
        renderer: this._pbrRenderer,
        registries: { meshes: this.meshes, materials: this.materials, waterMaterials: this.waterMaterials },
        getCamera: () => ({ vp: this._cameraVP, eye: this._cameraEye }),
        getLighting: () => this._lighting,
      };

      const rs = createRenderSystem(this.world, rsCtx);
      this.scheduler.addSystem(Phase.RENDER, rs.render, 'pbr-render');

      new ResizeObserver(() => this._pbrRenderer!.handleResize()).observe(this._canvas.element);
    } else {
      this._simpleRenderer = new Renderer(this._gpu);
      await this._simpleRenderer.initialize();

      new ResizeObserver(() => this._simpleRenderer!.handleResize()).observe(this._canvas.element);
    }

    this.input.attach(this._canvas.element);

    // Initialize audio system
    this._audioEngine = new AudioEngine();
    this._audioEngine.initialize();
    const audioRegistries: AudioRegistries = { clips: this.audioClips };
    const audioSys = createAudioSystem(this.world, this._audioEngine, audioRegistries);
    this.scheduler.addSystem(Phase.AUDIO, audioSys.update, 'spatial-audio');

    this._frameLoop = new FrameLoop({
      onFrame: (ctx) => this._onFrame(ctx),
      onError: (err) => console.error('[Engine] Frame error:', err),
    });

    this._initialized = true;
    console.log(`[Engine] Initialized (renderer: ${this._rendererType})`);
  }

  start(): void {
    if (!this._initialized) {
      throw new Error('Engine must be initialized before starting. Call initialize() first.');
    }
    this._frameLoop.start();
    console.log('[Engine] Started');
  }

  stop(): void { this._frameLoop?.stop(); }

  destroy(): void {
    this.stop();
    this.input.detach();
    this._audioEngine?.destroy();
    this._simpleRenderer?.destroy();
    this._pbrRenderer?.destroy();
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

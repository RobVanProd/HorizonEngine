import { World } from '@engine/ecs';
import { detectCapabilities, createGPUContext, createCanvas, InputState } from '@engine/platform';
import { Renderer, PBRRenderer, createRenderSystem, } from '@engine/renderer-webgpu';
import { Scheduler, FrameLoop, Phase } from '@engine/scheduler';
import { CpuTimer, FrameMetrics } from '@engine/profiler';
import { AudioEngine, createAudioSystem } from '@engine/audio';
/**
 * The Engine class bootstraps and orchestrates all subsystems.
 * This is the primary entry point for creating an engine instance.
 */
export class Engine {
    world;
    scheduler;
    input;
    frameMetrics;
    cpuTimer;
    /** Mesh handle registry — maps numeric handles to GPUMesh instances. */
    meshes = new Map();
    /** Material handle registry — maps numeric handles to PBRMaterial instances. */
    materials = new Map();
    /** Water material registry — maps handles to WaterMaterial instances. */
    waterMaterials = new Map();
    /** Audio clip registry — maps numeric handles to AudioEngine buffer handles. */
    audioClips = new Map();
    /** Human-readable scene labels for hierarchy and tooling surfaces. */
    entityLabels = new Map();
    _canvas;
    _gpu;
    _simpleRenderer = null;
    _pbrRenderer = null;
    _audioEngine = null;
    _frameLoop;
    _initialized = false;
    _rendererType = 'simple';
    _lighting = {
        direction: [-0.5, -0.8, -0.3],
        color: [1, 0.98, 0.92],
        intensity: 3.0,
        ambient: [0.01, 0.01, 0.02],
        envIntensity: 1.0,
        pointLights: [],
        shadowBias: 0.003,
        shadowNormalBias: 0.0015,
        exposure: 1.0,
        fog: {
            color: [0.76, 0.84, 0.92],
            density: 0.0,
            heightFalloff: 0.0,
            startDistance: 0.0,
            maxOpacity: 0.0,
        },
        debugView: 'lit',
    };
    _cameraVP = new Float32Array(16);
    _cameraEye = [0, 5, 15];
    _nextHandle = 1;
    constructor() {
        this.world = new World();
        this.scheduler = new Scheduler();
        this.input = new InputState();
        this.frameMetrics = new FrameMetrics();
        this.cpuTimer = new CpuTimer();
    }
    get gpu() { return this._gpu; }
    get renderer() {
        if (!this._simpleRenderer)
            throw new Error('Engine not initialized with simple renderer');
        return this._simpleRenderer;
    }
    get pbrRenderer() {
        if (!this._pbrRenderer)
            throw new Error('Engine not initialized with PBR renderer');
        return this._pbrRenderer;
    }
    get canvas() { return this._canvas; }
    get lighting() { return this._lighting; }
    set lighting(l) { this._lighting = l; }
    get cameraEye() { return this._cameraEye; }
    get audio() {
        if (!this._audioEngine) {
            this._audioEngine = new AudioEngine();
        }
        return this._audioEngine;
    }
    setCamera(vp, eye) {
        this._cameraVP.set(vp);
        this._cameraEye = eye;
    }
    setEntityLabel(entityId, label) {
        const trimmed = label?.trim();
        if (!trimmed) {
            this.entityLabels.delete(entityId);
            return;
        }
        this.entityLabels.set(entityId, trimmed);
    }
    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId);
    }
    /** Allocate a handle, register a mesh, and return the handle. */
    registerMesh(mesh) {
        const h = this._nextHandle++;
        this.meshes.set(h, mesh);
        return h;
    }
    /** Allocate a handle, register a material, and return the handle. */
    registerMaterial(mat) {
        const h = this._nextHandle++;
        this.materials.set(h, mat);
        return h;
    }
    /** Convenience: create a PBR material via the PBR renderer and register it. */
    createMaterial(params) {
        const mat = this.pbrRenderer.createMaterial(params);
        const handle = this.registerMaterial(mat);
        return { handle, material: mat };
    }
    /** Create a water material and register it. Returns handle for WaterRef. */
    createWaterMaterial(params) {
        const mat = this.pbrRenderer.createWaterMaterial(params);
        const handle = this._nextHandle++;
        this.waterMaterials.set(handle, mat);
        return { handle, material: mat };
    }
    /** Register an audio clip handle and return an engine handle for use with AudioSource components. */
    registerAudioClip(audioHandle) {
        const h = this._nextHandle++;
        this.audioClips.set(h, audioHandle);
        return h;
    }
    /** Load an audio clip from URL, register it, and return the engine handle. */
    async loadAudioClip(url) {
        const bufHandle = await this.audio.loadBuffer(url);
        return this.registerAudioClip(bufHandle);
    }
    async initialize(options = {}, pbrInit) {
        if (this._initialized)
            return;
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
            const rsCtx = {
                renderer: this._pbrRenderer,
                registries: { meshes: this.meshes, materials: this.materials, waterMaterials: this.waterMaterials },
                getCamera: () => ({ vp: this._cameraVP, eye: this._cameraEye }),
                getLighting: () => this._lighting,
            };
            const rs = createRenderSystem(this.world, rsCtx);
            this.scheduler.addSystem(Phase.RENDER, rs.render, 'pbr-render');
            new ResizeObserver(() => this._pbrRenderer.handleResize()).observe(this._canvas.element);
        }
        else {
            this._simpleRenderer = new Renderer(this._gpu);
            await this._simpleRenderer.initialize();
            new ResizeObserver(() => this._simpleRenderer.handleResize()).observe(this._canvas.element);
        }
        this.input.attach(this._canvas.element);
        // Initialize audio system
        this._audioEngine = new AudioEngine();
        this._audioEngine.initialize();
        const audioRegistries = { clips: this.audioClips };
        const audioSys = createAudioSystem(this.world, this._audioEngine, audioRegistries);
        this.scheduler.addSystem(Phase.AUDIO, audioSys.update, 'spatial-audio');
        this._frameLoop = new FrameLoop({
            onFrame: (ctx) => this._onFrame(ctx),
            onError: (err) => console.error('[Engine] Frame error:', err),
        });
        this._initialized = true;
        console.log(`[Engine] Initialized (renderer: ${this._rendererType})`);
    }
    start() {
        if (!this._initialized) {
            throw new Error('Engine must be initialized before starting. Call initialize() first.');
        }
        this._frameLoop.start();
        console.log('[Engine] Started');
    }
    stop() { this._frameLoop?.stop(); }
    destroy() {
        this.stop();
        this.input.detach();
        this._audioEngine?.destroy();
        this._simpleRenderer?.destroy();
        this._pbrRenderer?.destroy();
        this._gpu?.destroy();
        this._canvas?.destroy();
    }
    _onFrame(ctx) {
        this.cpuTimer.start('frame');
        this.frameMetrics.beginFrame(ctx.timestamp);
        this.cpuTimer.start('input');
        this.input.update();
        this.cpuTimer.stop('input');
        this.scheduler.execute(ctx);
        this.cpuTimer.stop('frame');
    }
}
//# sourceMappingURL=engine.js.map

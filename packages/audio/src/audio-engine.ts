import type { AudioHandle, PlayOptions, ActiveSound, ListenerState, SpatialParams } from './types.js';

let nextSoundId = 1;

/**
 * Core audio engine wrapping the WebAudio API.
 * Manages buffer loading, spatial playback, and listener positioning.
 */
export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _master!: GainNode;
  private _buffers = new Map<AudioHandle, AudioBuffer>();
  private _active = new Map<number, ActiveSound>();
  private _nextHandle = 1;
  private _suspended = true;

  get context(): AudioContext {
    if (!this._ctx) throw new Error('AudioEngine not initialized');
    return this._ctx;
  }

  get masterGain(): GainNode { return this._master; }
  get isReady(): boolean { return this._ctx !== null && !this._suspended; }

  /**
   * Initialize the audio context. Must be called from a user gesture on some browsers.
   */
  initialize(): void {
    if (this._ctx) return;
    this._ctx = new AudioContext();
    this._master = this._ctx.createGain();
    this._master.connect(this._ctx.destination);
    this._suspended = this._ctx.state === 'suspended';

    this._ctx.onstatechange = () => {
      this._suspended = this._ctx!.state === 'suspended';
    };
  }

  async resume(): Promise<void> {
    if (!this._ctx) this.initialize();
    if (this._ctx!.state === 'suspended') {
      await this._ctx!.resume();
    }
  }

  /**
   * Load an audio buffer from a URL and return a handle.
   */
  async loadBuffer(url: string): Promise<AudioHandle> {
    if (!this._ctx) this.initialize();
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await this._ctx!.decodeAudioData(arrayBuf);
    const handle = this._nextHandle++;
    this._buffers.set(handle, audioBuf);
    return handle;
  }

  /**
   * Register a pre-decoded AudioBuffer and return a handle.
   */
  registerBuffer(buffer: AudioBuffer): AudioHandle {
    const handle = this._nextHandle++;
    this._buffers.set(handle, buffer);
    return handle;
  }

  /**
   * Create a buffer from raw PCM data.
   */
  createBuffer(channels: Float32Array[], sampleRate: number): AudioHandle {
    if (!this._ctx) this.initialize();
    const buf = this._ctx!.createBuffer(channels.length, channels[0]!.length, sampleRate);
    for (let i = 0; i < channels.length; i++) {
      buf.copyToChannel(new Float32Array(channels[i]!), i);
    }
    return this.registerBuffer(buf);
  }

  getBuffer(handle: AudioHandle): AudioBuffer | undefined {
    return this._buffers.get(handle);
  }

  /**
   * Play a loaded buffer. Returns a sound ID for stop/update operations.
   */
  play(handle: AudioHandle, options: PlayOptions = {}): number {
    if (!this._ctx) this.initialize();
    const buffer = this._buffers.get(handle);
    if (!buffer) throw new Error(`Audio buffer ${handle} not found`);

    const ctx = this._ctx!;
    const id = nextSoundId++;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;
    if (options.playbackRate !== undefined) source.playbackRate.value = options.playbackRate;

    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1.0;

    let panner: PannerNode | null = null;

    if (options.spatial) {
      panner = ctx.createPanner();
      this._applySpatialParams(panner, options.spatial);
      source.connect(gain).connect(panner).connect(this._master);
    } else {
      source.connect(gain).connect(this._master);
    }

    const active: ActiveSound = { handle, source, gain, panner, playing: true };
    this._active.set(id, active);

    source.onended = () => {
      active.playing = false;
      this._active.delete(id);
    };

    source.start(0, options.offset ?? 0);
    return id;
  }

  /**
   * Stop a playing sound by its sound ID.
   */
  stop(soundId: number): void {
    const active = this._active.get(soundId);
    if (!active) return;
    try { active.source.stop(); } catch { /* already stopped */ }
    active.playing = false;
    this._active.delete(soundId);
  }

  /**
   * Stop all currently playing sounds.
   */
  stopAll(): void {
    for (const [id] of this._active) {
      this.stop(id);
    }
  }

  /**
   * Update spatial position of a playing sound.
   */
  setSoundPosition(soundId: number, position: [number, number, number]): void {
    const active = this._active.get(soundId);
    if (!active?.panner) return;
    active.panner.positionX.value = position[0];
    active.panner.positionY.value = position[1];
    active.panner.positionZ.value = position[2];
  }

  /**
   * Update volume of a playing sound.
   */
  setSoundVolume(soundId: number, volume: number): void {
    const active = this._active.get(soundId);
    if (!active) return;
    active.gain.gain.value = volume;
  }

  isPlaying(soundId: number): boolean {
    return this._active.get(soundId)?.playing ?? false;
  }

  get activeSoundCount(): number { return this._active.size; }

  /**
   * Set the listener position and orientation (typically matches the camera).
   */
  setListener(state: ListenerState): void {
    if (!this._ctx) return;
    const l = this._ctx.listener;
    if (l.positionX) {
      l.positionX.value = state.position[0];
      l.positionY.value = state.position[1];
      l.positionZ.value = state.position[2];
      l.forwardX.value = state.forward[0];
      l.forwardY.value = state.forward[1];
      l.forwardZ.value = state.forward[2];
      l.upX.value = state.up[0];
      l.upY.value = state.up[1];
      l.upZ.value = state.up[2];
    } else {
      l.setPosition(state.position[0], state.position[1], state.position[2]);
      l.setOrientation(
        state.forward[0], state.forward[1], state.forward[2],
        state.up[0], state.up[1], state.up[2],
      );
    }
  }

  setMasterVolume(volume: number): void {
    if (this._master) this._master.gain.value = volume;
  }

  getMasterVolume(): number {
    return this._master?.gain.value ?? 1.0;
  }

  destroy(): void {
    this.stopAll();
    if (this._ctx) {
      void this._ctx.close();
      this._ctx = null;
    }
    this._buffers.clear();
  }

  private _applySpatialParams(panner: PannerNode, params: SpatialParams): void {
    panner.panningModel = 'HRTF';
    panner.distanceModel = params.distanceModel ?? 'inverse';
    panner.refDistance = params.refDistance ?? 1;
    panner.maxDistance = params.maxDistance ?? 10000;
    panner.rolloffFactor = params.rolloffFactor ?? 1;
    panner.coneInnerAngle = params.coneInnerAngle ?? 360;
    panner.coneOuterAngle = params.coneOuterAngle ?? 360;
    panner.coneOuterGain = params.coneOuterGain ?? 0;
    panner.positionX.value = params.position[0];
    panner.positionY.value = params.position[1];
    panner.positionZ.value = params.position[2];
    if (params.orientation) {
      panner.orientationX.value = params.orientation[0];
      panner.orientationY.value = params.orientation[1];
      panner.orientationZ.value = params.orientation[2];
    }
  }
}

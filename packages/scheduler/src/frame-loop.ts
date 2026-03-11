import { now } from '@engine/profiler';
import type { FrameContext } from './types.js';

export interface FrameLoopOptions {
  fixedDeltaTime?: number;
  maxDeltaTime?: number;
  onFrame: (ctx: FrameContext) => void;
  onError?: (error: unknown) => void;
}

/**
 * The main frame loop. Drives the engine tick via requestAnimationFrame.
 * Provides frame timing, delta clamping, and fixed timestep accumulation.
 */
export class FrameLoop {
  private _running = false;
  private _rafId = 0;
  private _frameNumber = 0;
  private _startTime = 0;
  private _lastTime = 0;
  private _fixedDt: number;
  private _maxDt: number;
  private _onFrame: (ctx: FrameContext) => void;
  private _onError: (error: unknown) => void;

  constructor(options: FrameLoopOptions) {
    this._fixedDt = options.fixedDeltaTime ?? 1 / 60;
    this._maxDt = options.maxDeltaTime ?? 1 / 10;
    this._onFrame = options.onFrame;
    this._onError = options.onError ?? console.error;
  }

  get running(): boolean {
    return this._running;
  }

  get frameNumber(): number {
    return this._frameNumber;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._startTime = now() / 1000;
    this._lastTime = this._startTime;
    this._tick = this._tick.bind(this);
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }

  private _tick(rafTimestamp: number): void {
    if (!this._running) return;

    try {
      const currentTime = rafTimestamp / 1000;
      let dt = currentTime - this._lastTime;

      if (dt <= 0) dt = this._fixedDt;
      if (dt > this._maxDt) dt = this._maxDt;

      this._lastTime = currentTime;
      this._frameNumber++;

      const ctx: FrameContext = {
        deltaTime: dt,
        elapsedTime: currentTime - this._startTime,
        frameNumber: this._frameNumber,
        fixedDeltaTime: this._fixedDt,
        timestamp: rafTimestamp,
      };

      this._onFrame(ctx);
    } catch (err) {
      this._onError(err);
    }

    if (this._running) {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }
}

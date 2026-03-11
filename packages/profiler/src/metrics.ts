/**
 * Rolling window metrics tracker for frame timing and throughput analysis.
 * Stores the last N samples and provides statistical summaries.
 */
export class RollingMetrics {
  private _samples: Float64Array;
  private _head = 0;
  private _count = 0;
  readonly windowSize: number;

  constructor(windowSize: number = 120) {
    this.windowSize = windowSize;
    this._samples = new Float64Array(windowSize);
  }

  push(value: number): void {
    this._samples[this._head] = value;
    this._head = (this._head + 1) % this.windowSize;
    if (this._count < this.windowSize) this._count++;
  }

  get count(): number {
    return this._count;
  }

  get last(): number {
    if (this._count === 0) return 0;
    return this._samples[(this._head - 1 + this.windowSize) % this.windowSize]!;
  }

  get avg(): number {
    if (this._count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += this._samples[i]!;
    return sum / this._count;
  }

  get min(): number {
    if (this._count === 0) return 0;
    let m = Infinity;
    for (let i = 0; i < this._count; i++) {
      if (this._samples[i]! < m) m = this._samples[i]!;
    }
    return m;
  }

  get max(): number {
    if (this._count === 0) return 0;
    let m = -Infinity;
    for (let i = 0; i < this._count; i++) {
      if (this._samples[i]! > m) m = this._samples[i]!;
    }
    return m;
  }

  /**
   * Compute a percentile (0-100) from the current window.
   */
  percentile(p: number): number {
    if (this._count === 0) return 0;
    const sorted = Array.from(this._samples.subarray(0, this._count)).sort((a, b) => a - b);
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx]!;
  }

  snapshot(): MetricSnapshot {
    return {
      count: this._count,
      last: this.last,
      avg: this.avg,
      min: this.min,
      max: this.max,
      p95: this.percentile(95),
      p99: this.percentile(99),
    };
  }
}

export interface MetricSnapshot {
  readonly count: number;
  readonly last: number;
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly p95: number;
  readonly p99: number;
}

/**
 * Frame-level profiling data aggregator.
 */
export class FrameMetrics {
  readonly frameTimes = new RollingMetrics(300);
  readonly fps = new RollingMetrics(300);

  private _lastTimestamp = 0;
  private _frameCount = 0;

  beginFrame(timestamp: number): void {
    if (this._lastTimestamp > 0) {
      const dt = timestamp - this._lastTimestamp;
      this.frameTimes.push(dt);
      this.fps.push(dt > 0 ? 1000 / dt : 0);
    }
    this._lastTimestamp = timestamp;
    this._frameCount++;
  }

  get frameCount(): number {
    return this._frameCount;
  }

  report(): FrameReport {
    return {
      frameCount: this._frameCount,
      frameTimes: this.frameTimes.snapshot(),
      fps: this.fps.snapshot(),
    };
  }
}

export interface FrameReport {
  readonly frameCount: number;
  readonly frameTimes: MetricSnapshot;
  readonly fps: MetricSnapshot;
}

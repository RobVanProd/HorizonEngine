const HAS_PERFORMANCE = typeof performance !== 'undefined' && typeof performance.now === 'function';

/**
 * High-resolution timestamp in milliseconds.
 */
export function now(): number {
  return HAS_PERFORMANCE ? performance.now() : Date.now();
}

/**
 * Scoped CPU timer. Call start() and stop() to measure a named region.
 * Accumulated results are available via getMetrics().
 */
export class CpuTimer {
  private _active: Map<string, number> = new Map();
  private _accumulated: Map<string, TimerAccumulator> = new Map();

  start(label: string): void {
    this._active.set(label, now());
  }

  stop(label: string): number {
    const startTime = this._active.get(label);
    if (startTime === undefined) return 0;

    const elapsed = now() - startTime;
    this._active.delete(label);

    let acc = this._accumulated.get(label);
    if (!acc) {
      acc = new TimerAccumulator();
      this._accumulated.set(label, acc);
    }
    acc.record(elapsed);
    return elapsed;
  }

  getAccumulator(label: string): TimerAccumulator | undefined {
    return this._accumulated.get(label);
  }

  getAllMetrics(): Map<string, TimerSnapshot> {
    const result = new Map<string, TimerSnapshot>();
    for (const [label, acc] of this._accumulated) {
      result.set(label, acc.snapshot());
    }
    return result;
  }

  reset(): void {
    this._accumulated.clear();
    this._active.clear();
  }
}

export interface TimerSnapshot {
  readonly count: number;
  readonly total: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly last: number;
}

export class TimerAccumulator {
  private _count = 0;
  private _total = 0;
  private _min = Infinity;
  private _max = -Infinity;
  private _last = 0;

  record(ms: number): void {
    this._count++;
    this._total += ms;
    if (ms < this._min) this._min = ms;
    if (ms > this._max) this._max = ms;
    this._last = ms;
  }

  snapshot(): TimerSnapshot {
    return {
      count: this._count,
      total: this._total,
      min: this._count > 0 ? this._min : 0,
      max: this._count > 0 ? this._max : 0,
      avg: this._count > 0 ? this._total / this._count : 0,
      last: this._last,
    };
  }

  reset(): void {
    this._count = 0;
    this._total = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._last = 0;
  }
}

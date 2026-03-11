import { CpuTimer, now } from '@engine/profiler';
import { type FrameContext, type SystemFn, Phase, PHASE_COUNT, PHASE_NAMES } from './types.js';

interface SystemEntry {
  fn: SystemFn;
  label: string;
  priority: number;
}

/**
 * Phase-based system scheduler. Systems are registered into phases and
 * executed in priority order within each phase. Each frame, all phases
 * run sequentially in fixed order.
 */
export class Scheduler {
  private _phases: SystemEntry[][] = Array.from({ length: PHASE_COUNT }, () => []);
  private _dirty = true;
  readonly timer = new CpuTimer();

  /**
   * Register a system function to run in a specific phase.
   * Lower priority numbers run first within a phase.
   */
  addSystem(phase: Phase, fn: SystemFn, label?: string, priority = 0): void {
    this._phases[phase]!.push({ fn, label: label ?? (fn.name || `system_${phase}`), priority });
    this._dirty = true;
  }

  removeSystem(phase: Phase, fn: SystemFn): boolean {
    const list = this._phases[phase]!;
    const idx = list.findIndex(e => e.fn === fn);
    if (idx >= 0) {
      list.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Execute all phases in order for the current frame.
   */
  execute(ctx: FrameContext): void {
    if (this._dirty) {
      for (const phase of this._phases) {
        phase.sort((a, b) => a.priority - b.priority);
      }
      this._dirty = false;
    }

    for (let p = 0; p < PHASE_COUNT; p++) {
      const systems = this._phases[p]!;
      if (systems.length === 0) continue;

      const phaseName = PHASE_NAMES[p]!;
      this.timer.start(phaseName);

      for (const sys of systems) {
        this.timer.start(sys.label);
        sys.fn(ctx);
        this.timer.stop(sys.label);
      }

      this.timer.stop(phaseName);
    }
  }

  getSystemCount(phase?: Phase): number {
    if (phase !== undefined) return this._phases[phase]!.length;
    let total = 0;
    for (const p of this._phases) total += p.length;
    return total;
  }
}

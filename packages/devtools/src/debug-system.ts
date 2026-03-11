import type { Engine } from '@engine/core';
import type { FrameContext } from '@engine/scheduler';
import { Phase } from '@engine/scheduler';
import type { PerfPanel } from './perf-panel.js';
import type { DebugDraw } from './debug-draw.js';

export interface DebugSystemOptions {
  showSkeleton?: boolean;
  showWireframe?: boolean;
  showAABB?: boolean;
  showGrid?: boolean;
}

/**
 * Debug system that runs in Phase.DIAGNOSTICS.
 * Feeds the perf panel with data and optionally draws skeleton/wireframe/AABB overlays.
 */
export class DebugSystem {
  private _engine: Engine;
  private _perfPanel: PerfPanel;
  private _debugDraw: DebugDraw | null;

  showSkeleton = false;
  showWireframe = false;
  showAABB = false;
  showGrid = false;

  constructor(engine: Engine, perfPanel: PerfPanel, debugDraw: DebugDraw | null, options?: DebugSystemOptions) {
    this._engine = engine;
    this._perfPanel = perfPanel;
    this._debugDraw = debugDraw;

    if (options) {
      this.showSkeleton = options.showSkeleton ?? false;
      this.showWireframe = options.showWireframe ?? false;
      this.showAABB = options.showAABB ?? false;
      this.showGrid = options.showGrid ?? false;
    }

    this._perfPanel.bind(engine.cpuTimer, engine.frameMetrics);
  }

  /** Register the debug system onto the engine's scheduler. */
  register(): void {
    this._engine.scheduler.addSystem(Phase.DIAGNOSTICS, (ctx) => this.update(ctx), 'debug-system');
  }

  update(_ctx: FrameContext): void {
    // Feed GPU profiling data to perf panel
    const gpuProfiler = this._engine.pbrRenderer?.gpuProfiler;
    if (gpuProfiler) {
      this._perfPanel.setGpuTimings(gpuProfiler.results);
    }

    this._perfPanel.setSceneStats({
      entities: this._engine.world.entityCount,
      archetypes: this._engine.world.archetypeCount,
      meshes: this._engine.meshes.size,
      materials: this._engine.materials.size,
      audio: this._engine.audioClips.size,
    });
    this._perfPanel.update();
  }

  destroy(): void {
    this._engine.scheduler.removeSystemByLabel(Phase.DIAGNOSTICS, 'debug-system');
    this._perfPanel.destroy();
    this._debugDraw?.destroy();
  }
}

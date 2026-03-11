import type { Engine } from '@engine/core';
import type { CommandRouter } from './command-router.js';

/**
 * State tracked externally by devtools — the AI API reads/writes these flags.
 */
export interface DebugState {
  showSkeleton: boolean;
  showWireframe: boolean;
  showAABB: boolean;
  showGrid: boolean;
  perfPanelVisible: boolean;
}

/**
 * Registers performance and debug commands onto a CommandRouter.
 */
export function registerDebugCommands(
  router: CommandRouter,
  engine: Engine,
  debugState?: DebugState,
): void {
  // ─── perf.getFrameStats ───────────────────────────────────────
  router.register(
    {
      action: 'perf.getFrameStats',
      description: 'Get current frame timing statistics (FPS, frame time avg/min/max/p95/p99)',
      params: {},
    },
    () => {
      const report = engine.frameMetrics.report();
      return {
        ok: true,
        data: {
          frameCount: report.frameCount,
          fps: report.fps,
          frameTimes: report.frameTimes,
        },
      };
    },
  );

  // ─── perf.getTimings ──────────────────────────────────────────
  router.register(
    {
      action: 'perf.getTimings',
      description: 'Get per-system CPU timing breakdown and optional GPU pass timings',
      params: {},
    },
    () => {
      const cpuMetrics: Record<string, { last: number; avg: number; max: number }> = {};
      for (const [label, snap] of engine.cpuTimer.getAllMetrics()) {
        cpuMetrics[label] = { last: snap.last, avg: snap.avg, max: snap.max };
      }

      const gpuMetrics: Record<string, number> = {};
      try {
        const profiler = engine.pbrRenderer?.gpuProfiler;
        if (profiler) {
          for (const [label, ms] of profiler.results) {
            gpuMetrics[label] = ms;
          }
        }
      } catch { /* no PBR renderer */ }

      return {
        ok: true,
        data: { cpu: cpuMetrics, gpu: gpuMetrics },
      };
    },
  );

  // ─── debug.toggleWireframe ────────────────────────────────────
  router.register(
    {
      action: 'debug.toggleWireframe',
      description: 'Toggle wireframe overlay rendering',
      params: {
        enabled: { type: 'boolean', description: 'Explicit on/off (omit to toggle)' },
      },
    },
    (params) => {
      if (!debugState) return { ok: false, error: 'Debug system not attached' };
      debugState.showWireframe = params['enabled'] !== undefined
        ? params['enabled'] as boolean
        : !debugState.showWireframe;
      return { ok: true, data: { wireframe: debugState.showWireframe } };
    },
  );

  // ─── debug.showSkeleton ───────────────────────────────────────
  router.register(
    {
      action: 'debug.showSkeleton',
      description: 'Toggle skeleton visualization for animated entities',
      params: {
        enabled: { type: 'boolean', description: 'Explicit on/off (omit to toggle)' },
      },
    },
    (params) => {
      if (!debugState) return { ok: false, error: 'Debug system not attached' };
      debugState.showSkeleton = params['enabled'] !== undefined
        ? params['enabled'] as boolean
        : !debugState.showSkeleton;
      return { ok: true, data: { skeleton: debugState.showSkeleton } };
    },
  );

  // ─── debug.showAABB ───────────────────────────────────────────
  router.register(
    {
      action: 'debug.showAABB',
      description: 'Toggle axis-aligned bounding box visualization',
      params: {
        enabled: { type: 'boolean', description: 'Explicit on/off (omit to toggle)' },
      },
    },
    (params) => {
      if (!debugState) return { ok: false, error: 'Debug system not attached' };
      debugState.showAABB = params['enabled'] !== undefined
        ? params['enabled'] as boolean
        : !debugState.showAABB;
      return { ok: true, data: { aabb: debugState.showAABB } };
    },
  );

  // ─── debug.togglePerfPanel ────────────────────────────────────
  router.register(
    {
      action: 'debug.togglePerfPanel',
      description: 'Toggle the performance dashboard panel visibility',
      params: {
        visible: { type: 'boolean', description: 'Explicit on/off (omit to toggle)' },
      },
    },
    (params) => {
      if (!debugState) return { ok: false, error: 'Debug system not attached' };
      debugState.perfPanelVisible = params['visible'] !== undefined
        ? params['visible'] as boolean
        : !debugState.perfPanelVisible;
      return { ok: true, data: { perfPanel: debugState.perfPanelVisible } };
    },
  );
}

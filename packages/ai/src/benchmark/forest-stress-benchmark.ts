import type { Engine } from '@engine/core';
import { collectForestStressMetrics, type ForestStressMetricsSnapshot } from './control-plane-benchmark.js';

export type ForestStressDensityLabel = 'low' | 'medium' | 'high' | 'extreme';
export type ForestStressBenchmarkStatus = 'completed' | 'failed';

export interface ForestStressBenchmarkContext {
  engine: Engine;
  cleanup?(): void | Promise<void>;
}

export interface ForestStressBenchmarkSetupResult {
  notes?: string[];
}

export interface ForestStressBenchmarkRun {
  benchmarkName: 'forest-stress-v0';
  sceneName: string;
  densityLabel: ForestStressDensityLabel;
  status: ForestStressBenchmarkStatus;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  outputPath: string;
  metrics: ForestStressMetricsSnapshot;
  notes: string[];
  error?: string;
}

export async function runForestStressBenchmarkRun(options: {
  sceneName: string;
  densityLabel: ForestStressDensityLabel;
  createContext: () => Promise<ForestStressBenchmarkContext> | ForestStressBenchmarkContext;
  setupScene(context: ForestStressBenchmarkContext, densityLabel: ForestStressDensityLabel): Promise<ForestStressBenchmarkSetupResult | void> | ForestStressBenchmarkSetupResult | void;
}): Promise<ForestStressBenchmarkRun> {
  const context = await options.createContext();
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const outputPath = getForestStressBenchmarkOutputPath(options.sceneName, options.densityLabel, startedAtDate);
  const notes: string[] = [];
  const start = now();

  try {
    const setupResult = await options.setupScene(context, options.densityLabel);
    if (setupResult?.notes) {
      notes.push(...setupResult.notes);
    }
    const endedAt = new Date().toISOString();
    return {
      benchmarkName: 'forest-stress-v0',
      sceneName: options.sceneName,
      densityLabel: options.densityLabel,
      status: 'completed',
      startedAt,
      endedAt,
      elapsedMs: Number((now() - start).toFixed(3)),
      outputPath,
      metrics: collectForestStressMetrics(context.engine),
      notes,
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    return {
      benchmarkName: 'forest-stress-v0',
      sceneName: options.sceneName,
      densityLabel: options.densityLabel,
      status: 'failed',
      startedAt,
      endedAt,
      elapsedMs: Number((now() - start).toFixed(3)),
      outputPath,
      metrics: collectForestStressMetrics(context.engine),
      notes,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.cleanup?.();
  }
}

export async function runForestStressBenchmarkMatrix(options: {
  sceneName: string;
  densityLabels?: ForestStressDensityLabel[];
  createContext: () => Promise<ForestStressBenchmarkContext> | ForestStressBenchmarkContext;
  setupScene(context: ForestStressBenchmarkContext, densityLabel: ForestStressDensityLabel): Promise<ForestStressBenchmarkSetupResult | void> | ForestStressBenchmarkSetupResult | void;
}): Promise<ForestStressBenchmarkRun[]> {
  const densityLabels = options.densityLabels ?? ['low', 'medium', 'high', 'extreme'];
  const runs: ForestStressBenchmarkRun[] = [];
  for (const densityLabel of densityLabels) {
    runs.push(await runForestStressBenchmarkRun({
      sceneName: options.sceneName,
      densityLabel,
      createContext: options.createContext,
      setupScene: options.setupScene,
    }));
  }
  return runs;
}

export function serializeForestStressBenchmarkRun(run: ForestStressBenchmarkRun): string {
  return JSON.stringify(run, null, 2);
}

export function getForestStressBenchmarkOutputPath(
  sceneName: string,
  densityLabel: ForestStressDensityLabel,
  startedAt: Date,
): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  return `logs/benchmarks/forest-stress-v0/${sceneName}/${densityLabel}/${stamp}.json`;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

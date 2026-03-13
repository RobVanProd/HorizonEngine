import { describe, expect, it } from 'vitest';
import {
  compareForestStressBenchmarkRunSets,
  parseForestStressBenchmarkRunSet,
  serializeForestStressBenchmarkComparison,
  type ForestStressBenchmarkRun,
} from '@engine/ai';

function createRun(
  densityLabel: ForestStressBenchmarkRun['densityLabel'],
  overrides: Partial<ForestStressBenchmarkRun> = {},
): ForestStressBenchmarkRun {
  return {
    benchmarkName: 'forest-stress-v0',
    sceneName: 'first-nature-expedition',
    densityLabel,
    status: 'completed',
    startedAt: '2026-03-12T22:00:00.000Z',
    endedAt: '2026-03-12T22:00:01.000Z',
    elapsedMs: 1000,
    outputPath: `logs/${densityLabel}.json`,
    metrics: {
      entityCount: 100,
      meshCount: 25,
      materialCount: 8,
      rendererFrame: {
        drawCount: 20,
        triangleCount: 3000,
        meshletCount: 120,
        culledObjects: 5,
        culledTriangles: 400,
      },
    },
    notes: [],
    ...overrides,
  };
}

describe('forest stress benchmark comparison', () => {
  it('compares two four-run outputs tier by tier with JSON-friendly output', () => {
    const baseline = [
      createRun('low'),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ];
    const candidate = [
      createRun('low', { elapsedMs: 900 }),
      createRun('medium', { metrics: { ...createRun('medium').metrics, entityCount: 110, rendererFrame: { ...createRun('medium').metrics.rendererFrame!, drawCount: 22, triangleCount: 3200, meshletCount: 130, culledObjects: 4, culledTriangles: 350 } } }),
      createRun('high', { elapsedMs: 1100 }),
      createRun('extreme', { metrics: { ...createRun('extreme').metrics, meshCount: 28 } }),
    ];

    const comparison = compareForestStressBenchmarkRunSets(baseline, candidate);
    expect(comparison.benchmarkName).toBe('forest-stress-v0-comparison');
    expect(comparison.tiers).toHaveLength(4);
    expect(comparison.tiers.map((tier) => tier.densityLabel)).toEqual(['low', 'medium', 'high', 'extreme']);

    const parsed = JSON.parse(serializeForestStressBenchmarkComparison(comparison)) as typeof comparison;
    expect(parsed.tiers).toHaveLength(4);
  });

  it('captures improvement and regression deltas without inventing new metrics', () => {
    const baseline = [
      createRun('low', { elapsedMs: 1000 }),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ];
    const candidate = [
      createRun('low', { elapsedMs: 850 }),
      createRun('medium'),
      createRun('high', { elapsedMs: 1250 }),
      createRun('extreme'),
    ];

    const comparison = compareForestStressBenchmarkRunSets(baseline, candidate);
    const low = comparison.tiers.find((tier) => tier.densityLabel === 'low')!;
    const high = comparison.tiers.find((tier) => tier.densityLabel === 'high')!;

    expect(low.metrics.elapsedMs.delta).toBe(-150);
    expect(high.metrics.elapsedMs.delta).toBe(250);
    expect(low.metrics.entityCount.delta).toBe(0);
  });

  it('handles missing tiers and missing renderer metrics gracefully', () => {
    const baseline = [
      createRun('low', { metrics: { ...createRun('low').metrics, rendererFrame: null } }),
      createRun('medium'),
      createRun('high'),
    ];
    const candidate = [
      createRun('low'),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ];

    const comparison = compareForestStressBenchmarkRunSets(baseline, candidate);
    const low = comparison.tiers.find((tier) => tier.densityLabel === 'low')!;
    const extreme = comparison.tiers.find((tier) => tier.densityLabel === 'extreme')!;

    expect(low.metrics.rendererFrame.drawCount.status).toBe('missing_baseline');
    expect(low.notes.some((note) => note.includes('Renderer frame counters unavailable'))).toBe(true);
    expect(extreme.comparable).toBe(false);
    expect(extreme.errors).toContain('Missing baseline tier: extreme');
  });

  it('parses saved run-set JSON before comparison', () => {
    const runSet = JSON.stringify([
      createRun('low'),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ]);

    const parsed = parseForestStressBenchmarkRunSet(runSet);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]!.densityLabel).toBe('low');
  });
});

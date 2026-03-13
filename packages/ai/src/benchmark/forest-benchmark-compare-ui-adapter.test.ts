import { describe, expect, it } from 'vitest';
import { comparePastedForestBenchmarkJson } from '../../../../examples/editor-demo/src/forest-benchmark-compare-ui.js';

function createRun(densityLabel: 'low' | 'medium' | 'high' | 'extreme', overrides: Record<string, unknown> = {}) {
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

describe('forest benchmark browser compare helper adapter', () => {
  it('compares two pasted JSON bundles successfully', () => {
    const baseline = JSON.stringify([
      createRun('low'),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ]);
    const candidate = JSON.stringify([
      createRun('low', { elapsedMs: 900 }),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ]);

    const result = comparePastedForestBenchmarkJson(baseline, candidate);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.output).toContain('"benchmarkName": "forest-stress-v0-comparison"');
    expect(result.output).toContain('"delta": -100');
  });

  it('surfaces parse failures explicitly without throwing', () => {
    const result = comparePastedForestBenchmarkJson('{bad json', '[]');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.comparison).toBeNull();
  });

  it('preserves missing-tier and missing-metric paths in rendered output', () => {
    const baseline = JSON.stringify([
      createRun('low', { metrics: { entityCount: 100, meshCount: 25, materialCount: 8, rendererFrame: null } }),
      createRun('medium'),
      createRun('high'),
    ]);
    const candidate = JSON.stringify([
      createRun('low'),
      createRun('medium'),
      createRun('high'),
      createRun('extreme'),
    ]);

    const result = comparePastedForestBenchmarkJson(baseline, candidate);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Missing baseline tier: extreme');
    expect(result.output).toContain('Renderer frame counters unavailable for low');
  });
});

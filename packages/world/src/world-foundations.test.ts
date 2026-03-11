import { describe, expect, it } from 'vitest';
import { estimateSplineLength, sampleSpline } from './spline.js';
import { generateHeightfield, generateScatterInstances } from './terrain.js';
import { WorldChunkController } from './chunk-controller.js';

describe('world foundations', () => {
  it('samples splines deterministically', () => {
    const points = [
      { position: [0, 0, 0] as [number, number, number] },
      { position: [5, 0, 0] as [number, number, number] },
      { position: [10, 0, 5] as [number, number, number] },
    ];
    const sample = sampleSpline(points, 0.5);
    expect(sample.position[0]).toBeGreaterThan(4);
    expect(sample.position[0]).toBeLessThan(8);
    expect(estimateSplineLength(points)).toBeGreaterThan(10);
  });

  it('generates terrain reproducibly from a seed', () => {
    const a = generateHeightfield({ seed: 42, width: 8, depth: 8 });
    const b = generateHeightfield({ seed: 42, width: 8, depth: 8 });
    const c = generateHeightfield({ seed: 84, width: 8, depth: 8 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
  });

  it('generates stable scatter instances', () => {
    const field = generateHeightfield({ seed: 11, width: 12, depth: 12 });
    const instancesA = generateScatterInstances(field, { seed: 7, density: 0.3 });
    const instancesB = generateScatterInstances(field, { seed: 7, density: 0.3 });
    expect(instancesA.length).toBe(instancesB.length);
    expect(instancesA[0]?.position ?? null).toEqual(instancesB[0]?.position ?? null);
  });

  it('maps chunk seeds consistently', () => {
    const controller = new WorldChunkController(99, 32, 64);
    expect(controller.getCellSeed(1, 2)).toBe(controller.getCellSeed(1, 2));
    expect(controller.getCellSeed(1, 2)).not.toBe(controller.getCellSeed(2, 1));
  });
});

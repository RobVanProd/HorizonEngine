import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core';
import { LocalTransform, Visible, WorldMatrix } from '@engine/ecs';
import {
  getForestStressBenchmarkOutputPath,
  runForestStressBenchmarkRun,
  serializeForestStressBenchmarkRun,
} from '@engine/ai';

function createEntity(engine: Engine): void {
  const id = engine.world.spawn().id;
  engine.world.addComponent(id, LocalTransform, {
    px: 0, py: 0, pz: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
  });
  engine.world.addComponent(id, WorldMatrix, {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  });
  engine.world.addComponent(id, Visible, { _tag: 1 });
  engine.setEntityLabel(id, 'Forest Benchmark Entity');
}

describe('forest stress benchmark runner', () => {
  it('runs one successful benchmark pass and returns structured JSON-ready output', async () => {
    const run = await runForestStressBenchmarkRun({
      sceneName: 'first-nature-expedition',
      densityLabel: 'low',
      createContext: () => {
        const engine = new Engine();
        return { engine };
      },
      setupScene: async (context) => {
        createEntity(context.engine);
        return {
          notes: ['Smoke benchmark setup used test-only stub scene content.'],
        };
      },
    });

    expect(run.status).toBe('completed');
    expect(run.sceneName).toBe('first-nature-expedition');
    expect(run.densityLabel).toBe('low');
    expect(run.metrics.entityCount).toBe(1);
    expect(run.outputPath).toContain('logs/benchmarks/forest-stress-v0/first-nature-expedition/low/');

    const parsed = JSON.parse(serializeForestStressBenchmarkRun(run)) as typeof run;
    expect(parsed.sceneName).toBe('first-nature-expedition');
    expect(parsed.metrics.entityCount).toBe(1);
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it('records a failed run without fabricating unavailable metrics', async () => {
    const run = await runForestStressBenchmarkRun({
      sceneName: 'first-nature-expedition',
      densityLabel: 'extreme',
      createContext: () => ({ engine: new Engine() }),
      setupScene: async () => {
        throw new Error('nature pack unavailable');
      },
    });

    expect(run.status).toBe('failed');
    expect(run.error).toBe('nature pack unavailable');
    expect(run.metrics.entityCount).toBe(0);
    expect(run.metrics.rendererFrame).toBeNull();
  });

  it('builds canonical output paths for per-run JSON logs', () => {
    const path = getForestStressBenchmarkOutputPath(
      'first-nature-expedition',
      'high',
      new Date('2026-03-12T21:30:00.000Z'),
    );
    expect(path).toBe('logs/benchmarks/forest-stress-v0/first-nature-expedition/high/2026-03-12T21-30-00-000Z.json');
  });
});

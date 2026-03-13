import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core';
import { LocalTransform, Visible, WorldMatrix } from '@engine/ecs';
import {
  EngineAI,
  collectForestStressMetrics,
  createMinimalControlPlaneBenchmarkTasks,
  registerControlPlaneCommands,
  runControlPlaneBenchmarkSuite,
} from '@engine/ai';
import { UndoRedoStack } from '../../../editor/src/scene/undo-redo.js';
import { createEditorAiPlanUndoBridge } from '../../../editor/src/ai/ai-plan-undo.js';

function createSeedEntity(engine: Engine): number {
  const id = engine.world.spawn().id;
  engine.world.addComponent(id, LocalTransform, {
    px: 1, py: 2, pz: 3,
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
  engine.setEntityLabel(id, 'Benchmark Seed');
  return id;
}

function createRuntimeContext() {
  const engine = new Engine();
  const seedEntityId = createSeedEntity(engine);
  const ai = EngineAI.attach(engine);
  return {
    ai,
    engine,
    path: 'runtime' as const,
    seedEntityId,
    cleanup: () => ai.destroy(),
  };
}

function createEditorContext() {
  const engine = new Engine();
  const seedEntityId = createSeedEntity(engine);
  const ai = EngineAI.attach(engine);
  const undoStack = new UndoRedoStack();

  registerControlPlaneCommands(ai.router, engine, {
    undoBridge: createEditorAiPlanUndoBridge(engine, undoStack),
  });

  return {
    ai,
    engine,
    path: 'editor' as const,
    seedEntityId,
    undoController: {
      canUndo: () => undoStack.canUndo,
      undo: () => undoStack.undo(),
    },
    cleanup: () => ai.destroy(),
  };
}

describe('control-plane benchmark harness', () => {
  it('runs the minimal runtime benchmark suite for preview/apply create, rename, and transform', async () => {
    const suite = await runControlPlaneBenchmarkSuite({
      suiteName: 'runtime-v0',
      createContext: createRuntimeContext,
      tasks: createMinimalControlPlaneBenchmarkTasks(),
    });

    expect(suite.allPassed).toBe(true);
    expect(suite.results.map((result) => result.taskName)).toEqual([
      'preview create',
      'apply create',
      'preview rename',
      'apply rename',
      'preview transform',
      'apply transform',
    ]);
    for (const result of suite.results) {
      expect(result.pass).toBe(true);
      expect(result.validationIssueCount).toBe(0);
      expect(result.executionTimingMs).toBeGreaterThanOrEqual(0);
      if (result.mode === 'preview') {
        expect(result.applySuccess).toBe(false);
        expect(result.undoSuccess).toBeNull();
      }
    }
  });

  it('records grouped undo success for editor-path apply benchmarks', async () => {
    const suite = await runControlPlaneBenchmarkSuite({
      suiteName: 'editor-v0',
      createContext: createEditorContext,
      tasks: createMinimalControlPlaneBenchmarkTasks().filter((task) => task.mode === 'apply'),
    });

    expect(suite.allPassed).toBe(true);
    for (const result of suite.results) {
      expect(result.mode).toBe('apply');
      expect(result.applySuccess).toBe(true);
      expect(result.undoSuccess).toBe(true);
    }
  });

  it('collects the initial forest stress metrics surface without requiring a full benchmark runner', () => {
    const engine = new Engine();
    createSeedEntity(engine);

    const metrics = collectForestStressMetrics(engine);
    expect(metrics.entityCount).toBe(1);
    expect(metrics.meshCount).toBe(0);
    expect(metrics.materialCount).toBe(0);
    expect(metrics.rendererFrame === null || typeof metrics.rendererFrame.drawCount === 'number').toBe(true);
  });
});

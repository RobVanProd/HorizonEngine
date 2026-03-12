import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core';
import { LocalTransform, Visible, WorldMatrix } from '@engine/ecs';
import { EngineAI, registerControlPlaneCommands } from '@engine/ai';
import { UndoRedoStack } from '../scene/undo-redo.js';
import { createEditorAiPlanUndoBridge } from './ai-plan-undo.js';

function createEntity(engine: Engine, label: string): number {
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
  engine.setEntityLabel(id, label);
  return id;
}

describe('editor AI plan undo bridge', () => {
  it('registers one grouped undo entry for an applied plan', async () => {
    const engine = new Engine();
    const entityId = createEntity(engine, 'Before');
    const undoStack = new UndoRedoStack();
    const ai = EngineAI.attach(engine);

    registerControlPlaneCommands(ai.router, engine, {
      undoBridge: createEditorAiPlanUndoBridge(engine, undoStack),
    });

    const result = await ai.execute({
      action: 'scene.applyPlan',
      params: {
        plan: {
          label: 'Rename and Move',
          actions: [
            {
              kind: 'entity.rename',
              entityId,
              payload: { name: 'After' },
            },
            {
              kind: 'entity.setTransform',
              entityId,
              payload: { position: [5, 6, 7] },
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(undoStack.canUndo).toBe(true);
    expect(undoStack.undoLabel).toBe('Rename and Move');
    expect(engine.getEntityLabel(entityId)).toBe('After');
    expect(engine.world.getField(entityId, LocalTransform, 'px')).toBe(5);

    undoStack.undo();
    expect(engine.getEntityLabel(entityId)).toBe('Before');
    expect(engine.world.getField(entityId, LocalTransform, 'px')).toBe(0);

    undoStack.redo();
    expect(engine.getEntityLabel(entityId)).toBe('After');
    expect(engine.world.getField(entityId, LocalTransform, 'px')).toBe(5);
  });
});

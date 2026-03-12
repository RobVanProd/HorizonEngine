import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core';
import { LocalTransform, Visible, WorldMatrix } from '@engine/ecs';
import { EngineAI } from '@engine/ai';

function createEntity(engine: Engine, label: string): number {
  const id = engine.world.spawn().id;
  engine.world.addComponent(id, LocalTransform, {
    px: 1, py: 2, pz: 3,
    rotX: 0, rotY: 0.25, rotZ: 0,
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

describe('AI Control Plane v0', () => {
  it('reads stable entity summaries and details', async () => {
    const engine = new Engine();
    const first = createEntity(engine, 'First');
    const second = createEntity(engine, 'Second');
    const ai = EngineAI.attach(engine);

    const entitiesResult = await ai.execute({
      action: 'scene.read.entities',
      params: {},
    });
    expect(entitiesResult.ok).toBe(true);
    const entitiesData = entitiesResult.data as {
      count: number;
      entities: Array<{ entityId: number; name: string | null; components: string[]; tagSupport: string }>;
    };
    expect(entitiesData.count).toBe(2);
    expect(entitiesData.entities.map((entry) => entry.entityId)).toEqual([first, second]);
    expect(entitiesData.entities[0]!.name).toBe('First');
    expect(entitiesData.entities[0]!.components).toContain('LocalTransform');
    expect(entitiesData.entities[0]!.tagSupport).toBe('unavailable');

    const detailResult = await ai.execute({
      action: 'scene.read.entity',
      params: { entityId: second },
    });
    expect(detailResult.ok).toBe(true);
    const detail = detailResult.data as {
      entityId: number;
      name: string | null;
      transform: { position: [number, number, number] };
      componentFields: Record<string, Record<string, number>>;
      tags: string[];
    };
    expect(detail.entityId).toBe(second);
    expect(detail.name).toBe('Second');
    expect(detail.transform.position).toEqual([1, 2, 3]);
    expect(detail.componentFields.LocalTransform.py).toBe(2);
    expect(detail.tags).toEqual([]);
  });

  it('previews and applies create, rename, and transform plans without scope creep', async () => {
    const engine = new Engine();
    const entityId = createEntity(engine, 'Before');
    const ai = EngineAI.attach(engine);

    const previewCreate = await ai.execute({
      action: 'scene.previewPlan',
      params: {
        plan: {
          label: 'Preview Create',
          actions: [{
            kind: 'entity.create',
            payload: {
              name: 'Created by AI',
              transform: { position: [4, 5, 6] },
            },
          }],
        },
      },
    });
    expect(previewCreate.ok).toBe(true);
    const previewCreateData = previewCreate.data as {
      canApply: boolean;
      validation: { ok: boolean; issues: unknown[] };
      diff: { createdEntities: unknown[] };
    };
    expect(previewCreateData.canApply).toBe(true);
    expect(previewCreateData.validation.ok).toBe(true);
    expect(previewCreateData.diff.createdEntities).toHaveLength(1);
    expect(engine.world.entityCount).toBe(1);

    const applyCreate = await ai.execute({
      action: 'scene.applyPlan',
      params: {
        plan: {
          label: 'Apply Create',
          actions: [{
            actionId: 'create-1',
            kind: 'entity.create',
            payload: {
              name: 'Created by AI',
              transform: { position: [4, 5, 6] },
            },
          }],
        },
      },
    });
    expect(applyCreate.ok).toBe(true);
    const applyCreateData = applyCreate.data as {
      applied: boolean;
      idRemaps: Array<{ actionId: string; entityId: number }>;
    };
    expect(applyCreateData.applied).toBe(true);
    expect(applyCreateData.idRemaps).toHaveLength(1);
    const createdId = applyCreateData.idRemaps[0]!.entityId;
    expect(engine.world.has(createdId)).toBe(true);
    expect(engine.getEntityLabel(createdId)).toBe('Created by AI');

    const previewRename = await ai.execute({
      action: 'scene.previewPlan',
      params: {
        plan: {
          label: 'Preview Rename',
          actions: [{
            kind: 'entity.rename',
            entityId,
            payload: { name: 'After Rename' },
          }],
        },
      },
    });
    expect(previewRename.ok).toBe(true);
    const previewRenameData = previewRename.data as {
      canApply: boolean;
      diff: { updatedEntities: Array<{ changedFields: string[] }> };
    };
    expect(previewRenameData.canApply).toBe(true);
    expect(previewRenameData.diff.updatedEntities[0]!.changedFields).toContain('name');
    expect(engine.getEntityLabel(entityId)).toBe('Before');

    const applyRename = await ai.execute({
      action: 'scene.applyPlan',
      params: {
        plan: {
          label: 'Apply Rename',
          actions: [{
            kind: 'entity.rename',
            entityId,
            payload: { name: 'After Rename' },
          }],
        },
      },
    });
    expect(applyRename.ok).toBe(true);
    expect(engine.getEntityLabel(entityId)).toBe('After Rename');

    const previewTransform = await ai.execute({
      action: 'scene.previewPlan',
      params: {
        plan: {
          label: 'Preview Transform',
          actions: [{
            kind: 'entity.setTransform',
            entityId,
            payload: {
              position: [8, 9, 10],
              scale: [2, 2, 2],
            },
          }],
        },
      },
    });
    expect(previewTransform.ok).toBe(true);
    const previewTransformData = previewTransform.data as {
      canApply: boolean;
      diff: { updatedEntities: Array<{ changedFields: string[] }> };
    };
    expect(previewTransformData.canApply).toBe(true);
    expect(previewTransformData.diff.updatedEntities[0]!.changedFields).toContain('transform');
    expect(engine.world.getField(entityId, LocalTransform, 'px')).toBe(1);

    const applyTransform = await ai.execute({
      action: 'scene.applyPlan',
      params: {
        plan: {
          label: 'Apply Transform',
          actions: [{
            kind: 'entity.setTransform',
            entityId,
            payload: {
              position: [8, 9, 10],
              scale: [2, 2, 2],
            },
          }],
        },
      },
    });
    expect(applyTransform.ok).toBe(true);
    expect(engine.world.getField(entityId, LocalTransform, 'px')).toBe(8);
    expect(engine.world.getField(entityId, LocalTransform, 'scaleX')).toBe(2);
  });

  it('returns structured validation issues for unsupported actions', async () => {
    const engine = new Engine();
    const ai = EngineAI.attach(engine);

    const preview = await ai.execute({
      action: 'scene.previewPlan',
      params: {
        plan: {
          label: 'Unsupported',
          actions: [{
            kind: 'entity.delete',
            entityId: 1,
            payload: {},
          }],
        },
      },
    });
    expect(preview.ok).toBe(true);
    const data = preview.data as {
      canApply: boolean;
      validation: { ok: boolean; issues: Array<{ code: string }> };
    };
    expect(data.canApply).toBe(false);
    expect(data.validation.ok).toBe(false);
    expect(data.validation.issues[0]!.code).toBe('UNSUPPORTED_ACTION');

    const apply = await ai.execute({
      action: 'scene.applyPlan',
      params: {
        plan: {
          label: 'Unsupported Apply',
          actions: [{
            kind: 'entity.delete',
            entityId: 1,
            payload: {},
          }],
        },
      },
    });
    expect(apply.ok).toBe(false);
    const applyData = apply.data as {
      validation: { ok: boolean; issues: Array<{ code: string }> };
      applied: boolean;
    };
    expect(applyData.applied).toBe(false);
    expect(applyData.validation.issues[0]!.code).toBe('UNSUPPORTED_ACTION');
  });
});

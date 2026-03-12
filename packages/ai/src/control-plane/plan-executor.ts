import type { Engine } from '@engine/core';
import {
  LocalTransform,
  Parent,
  Visible,
  WorldMatrix,
} from '@engine/ecs';
import {
  buildDiffFromSnapshots,
} from './plan-diff.js';
import {
  buildPredictedCreatedSnapshot,
  cloneSnapshot,
  normalizeTransform,
  sanitizeName,
  snapshotEntity,
  withRenamedSnapshot,
  withTransformedSnapshot,
} from './entity-snapshots.js';
import {
  normalizePlan,
  validatePlan,
} from './plan-validator.js';
import type {
  AiActionPlan,
  AiIdRemap,
  AiNormalizedActionPlan,
  AiPlanApplyResult,
  AiPlanPreviewResult,
  AiPlanSnapshotEntry,
  CreateEntityPayload,
  EntitySnapshot,
  RenameEntityPayload,
  SetTransformPayload,
} from './plan-types.js';

interface InternalUndoStep {
  undo(): void;
}

interface InternalApplyExecution {
  publicResult: AiPlanApplyResult;
  undoSteps: InternalUndoStep[];
}

export function previewAiActionPlan(
  engine: Engine,
  planInput: AiActionPlan | null | undefined,
  options: {
    editorUndoAvailable?: boolean;
  } = {},
): AiPlanPreviewResult {
  const plan = normalizePlan(planInput);
  const validation = validatePlan(engine, plan, options);
  const snapshots = validation.ok ? buildPreviewSnapshots(engine, plan) : [];
  const diff = buildDiffFromSnapshots(snapshots);
  return {
    plan,
    validation,
    snapshots,
    diff,
    canApply: validation.ok,
  };
}

export function applyAiActionPlan(
  engine: Engine,
  planInput: AiActionPlan | AiNormalizedActionPlan,
  options: {
    editorUndoAvailable?: boolean;
    undoAvailable?: boolean;
  } = {},
): AiPlanApplyResult {
  return applyAiActionPlanWithUndoLog(engine, planInput, options).publicResult;
}

export function applyAiActionPlanWithUndoLog(
  engine: Engine,
  planInput: AiActionPlan | AiNormalizedActionPlan,
  options: {
    editorUndoAvailable?: boolean;
    undoAvailable?: boolean;
  } = {},
): InternalApplyExecution {
  const preview = previewAiActionPlan(engine, planInput as AiActionPlan, {
    editorUndoAvailable: options.editorUndoAvailable,
  });
  if (!preview.validation.ok) {
    return {
      publicResult: {
        ...preview,
        applied: false,
        appliedActionCount: 0,
        idRemaps: [],
        undo: {
          available: false,
          label: null,
        },
      },
      undoSteps: [],
    };
  }

  const snapshots: AiPlanSnapshotEntry[] = [];
  const idRemaps: AiIdRemap[] = [];
  const undoSteps: InternalUndoStep[] = [];

  for (const action of preview.plan.actions) {
    switch (action.kind) {
      case 'entity.create': {
        const payload = action.payload as CreateEntityPayload;
        const entityId = createEntity(engine, payload);
        const after = snapshotEntity(engine, entityId);
        if (!after) break;
        snapshots.push({
          actionId: action.actionId,
          entityId,
          before: null,
          after,
        });
        idRemaps.push({ actionId: action.actionId, entityId });
        undoSteps.push({
          undo: () => {
            if (engine.world.has(entityId)) {
              engine.world.destroy(entityId);
            }
            engine.setEntityLabel(entityId, null);
          },
        });
        break;
      }
      case 'entity.rename': {
        const entityId = action.entityId!;
        const before = snapshotEntity(engine, entityId);
        const oldName = engine.getEntityLabel(entityId) ?? null;
        const payload = action.payload as unknown as RenameEntityPayload;
        engine.setEntityLabel(entityId, payload.name);
        const after = snapshotEntity(engine, entityId);
        if (before && after) {
          snapshots.push({
            actionId: action.actionId,
            entityId,
            before,
            after,
          });
        }
        undoSteps.push({
          undo: () => engine.setEntityLabel(entityId, oldName),
        });
        break;
      }
      case 'entity.setTransform': {
        const entityId = action.entityId!;
        const before = snapshotEntity(engine, entityId);
        const payload = action.payload as SetTransformPayload;
        const previousTransform = before?.transform ? cloneTransform(before.transform) : null;
        applyTransform(engine, entityId, payload);
        const after = snapshotEntity(engine, entityId);
        if (before && after) {
          snapshots.push({
            actionId: action.actionId,
            entityId,
            before,
            after,
          });
        }
        undoSteps.push({
          undo: () => {
            if (previousTransform) {
              applyTransform(engine, entityId, previousTransform);
            }
          },
        });
        break;
      }
    }
  }

  const diff = buildDiffFromSnapshots(snapshots);
  return {
    publicResult: {
      plan: preview.plan,
      validation: preview.validation,
      snapshots,
      diff,
      canApply: true,
      applied: true,
      appliedActionCount: preview.plan.actions.length,
      idRemaps,
      undo: {
        available: Boolean(options.undoAvailable),
        label: options.undoAvailable ? preview.plan.label : null,
      },
    },
    undoSteps,
  };
}

export function undoAiActionPlanExecution(execution: InternalApplyExecution): void {
  for (let i = execution.undoSteps.length - 1; i >= 0; i--) {
    execution.undoSteps[i]!.undo();
  }
}

function buildPreviewSnapshots(engine: Engine, plan: AiNormalizedActionPlan): AiPlanSnapshotEntry[] {
  const snapshots: AiPlanSnapshotEntry[] = [];
  for (const action of plan.actions) {
    switch (action.kind) {
      case 'entity.create': {
        const predicted = buildPredictedCreatedSnapshot(action.payload as CreateEntityPayload);
        snapshots.push({
          actionId: action.actionId,
          before: null,
          after: predicted,
        });
        break;
      }
      case 'entity.rename': {
        const before = snapshotEntity(engine, action.entityId!);
        if (!before) break;
        snapshots.push({
          actionId: action.actionId,
          entityId: action.entityId,
          before,
          after: withRenamedSnapshot(before, (action.payload as unknown as RenameEntityPayload).name),
        });
        break;
      }
      case 'entity.setTransform': {
        const before = snapshotEntity(engine, action.entityId!);
        if (!before) break;
        snapshots.push({
          actionId: action.actionId,
          entityId: action.entityId,
          before,
          after: withTransformedSnapshot(before, action.payload as SetTransformPayload),
        });
        break;
      }
    }
  }
  return snapshots;
}

function createEntity(engine: Engine, payload: CreateEntityPayload): number {
  const world = engine.world;
  const entityId = world.spawn().id;
  const transform = normalizeTransform(payload.transform ?? null);
  world.addComponent(entityId, LocalTransform, {
    px: transform.position[0],
    py: transform.position[1],
    pz: transform.position[2],
    rotX: transform.rotation[0],
    rotY: transform.rotation[1],
    rotZ: transform.rotation[2],
    scaleX: transform.scale[0],
    scaleY: transform.scale[1],
    scaleZ: transform.scale[2],
  });
  world.addComponent(entityId, WorldMatrix, {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  });
  world.addComponent(entityId, Visible, { _tag: 1 });
  if (payload.parentId != null) {
    world.addComponent(entityId, Parent, { entity: payload.parentId });
  }
  const name = sanitizeName(payload.name) ?? 'AI Entity';
  engine.setEntityLabel(entityId, name);
  return entityId;
}

function applyTransform(engine: Engine, entityId: number, payload: Partial<SetTransformPayload>): void {
  const world = engine.world;
  if (payload.position) {
    world.setField(entityId, LocalTransform, 'px', payload.position[0]!);
    world.setField(entityId, LocalTransform, 'py', payload.position[1]!);
    world.setField(entityId, LocalTransform, 'pz', payload.position[2]!);
  }
  if (payload.rotation) {
    world.setField(entityId, LocalTransform, 'rotX', payload.rotation[0]!);
    world.setField(entityId, LocalTransform, 'rotY', payload.rotation[1]!);
    world.setField(entityId, LocalTransform, 'rotZ', payload.rotation[2]!);
  }
  if (payload.scale) {
    world.setField(entityId, LocalTransform, 'scaleX', payload.scale[0]!);
    world.setField(entityId, LocalTransform, 'scaleY', payload.scale[1]!);
    world.setField(entityId, LocalTransform, 'scaleZ', payload.scale[2]!);
  }
}

function cloneTransform(transform: NonNullable<EntitySnapshot['transform']>): SetTransformPayload {
  return {
    position: [...transform.position] as [number, number, number],
    rotation: [...transform.rotation] as [number, number, number],
    scale: [...transform.scale] as [number, number, number],
  };
}

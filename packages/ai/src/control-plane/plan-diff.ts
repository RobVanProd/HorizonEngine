import type {
  AiPlanDiff,
  AiPlanSnapshotEntry,
  EntitySnapshot,
} from './plan-types.js';

export function buildDiffFromSnapshots(entries: AiPlanSnapshotEntry[]): AiPlanDiff {
  const createdEntities: AiPlanDiff['createdEntities'] = [];
  const updatedEntities: AiPlanDiff['updatedEntities'] = [];

  for (const entry of entries) {
    if (!entry.before && entry.after) {
      createdEntities.push({
        actionId: entry.actionId,
        entityId: entry.entityId,
        name: entry.after.name,
        after: entry.after,
      });
      continue;
    }

    if (entry.before && entry.after && entry.after.entityId != null) {
      updatedEntities.push({
        actionId: entry.actionId,
        entityId: entry.after.entityId,
        before: entry.before,
        after: entry.after,
        changedFields: diffSnapshotFields(entry.before, entry.after),
      });
    }
  }

  return { createdEntities, updatedEntities };
}

function diffSnapshotFields(before: EntitySnapshot, after: EntitySnapshot): string[] {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push('name');
  if (before.parentId !== after.parentId) changed.push('parentId');
  if (!equalArrays(before.tags, after.tags)) changed.push('tags');
  if (!equalArrays(before.components, after.components)) changed.push('components');
  if (!equalTransform(before.transform, after.transform)) changed.push('transform');
  return changed;
}

function equalTransform(a: EntitySnapshot['transform'], b: EntitySnapshot['transform']): boolean {
  if (a === null || b === null) return a === b;
  return equalArrays(a.position, b.position) && equalArrays(a.rotation, b.rotation) && equalArrays(a.scale, b.scale);
}

function equalArrays(a: readonly number[] | readonly string[], b: readonly number[] | readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

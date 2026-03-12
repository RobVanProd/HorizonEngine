import type { Engine } from '@engine/core';
import { LocalTransform, Parent, type ComponentDef } from '@engine/ecs';
import type {
  EntitySnapshot,
  EntityTransformSnapshot,
  SceneEntityDetail,
  SceneEntitySummary,
} from './plan-types.js';

interface EntityRecordSummary {
  entityId: number;
  componentDefs: readonly ComponentDef[];
}

interface HierarchyMaps {
  parentByEntity: Map<number, number>;
  childrenByEntity: Map<number, number[]>;
}

const TAG_SUPPORT = 'unavailable' as const;

export function readEntitySummaries(
  engine: Engine,
  options: {
    limit?: number;
    entityIds?: number[];
  } = {},
): { count: number; entities: SceneEntitySummary[]; tagSupport: typeof TAG_SUPPORT } {
  const hierarchy = buildHierarchyMaps(engine);
  const records = collectEntityRecords(engine);
  const requested = options.entityIds?.length
    ? new Set(options.entityIds)
    : null;
  const entities = records
    .filter((record) => requested === null || requested.has(record.entityId))
    .sort((a, b) => a.entityId - b.entityId)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
    .map((record) => toSummary(engine, record, hierarchy));

  return {
    count: entities.length,
    entities,
    tagSupport: TAG_SUPPORT,
  };
}

export function readEntityDetail(engine: Engine, entityId: number): SceneEntityDetail | null {
  const hierarchy = buildHierarchyMaps(engine);
  const record = collectEntityRecordMap(engine).get(entityId);
  if (!record) return null;

  const summary = toSummary(engine, record, hierarchy);
  const componentFields: Record<string, Record<string, number>> = {};

  for (const comp of record.componentDefs) {
    const fields: Record<string, number> = {};
    for (const fieldName of comp.fieldNames) {
      fields[fieldName] = engine.world.getField(entityId, comp as never, fieldName as never);
    }
    componentFields[comp.name] = fields;
  }

  return {
    ...summary,
    componentFields,
  };
}

export function snapshotEntity(engine: Engine, entityId: number): EntitySnapshot | null {
  const detail = readEntityDetail(engine, entityId);
  if (!detail) return null;
  return {
    entityId: detail.entityId,
    name: detail.name,
    parentId: detail.parentId,
    tags: detail.tags,
    tagSupport: detail.tagSupport,
    components: detail.components,
    transform: detail.transform,
  };
}

export function buildPredictedCreatedSnapshot(payload: {
  name?: string;
  parentId?: number | null;
  transform?: Partial<EntityTransformSnapshot> | null;
}): EntitySnapshot {
  return {
    entityId: null,
    name: sanitizeName(payload.name),
    parentId: payload.parentId ?? null,
    tags: [],
    tagSupport: TAG_SUPPORT,
    components: ['LocalTransform', 'Visible', 'WorldMatrix'],
    transform: normalizeTransform(payload.transform),
  };
}

export function cloneSnapshot(snapshot: EntitySnapshot): EntitySnapshot {
  return {
    entityId: snapshot.entityId,
    name: snapshot.name,
    parentId: snapshot.parentId,
    tags: [...snapshot.tags],
    tagSupport: snapshot.tagSupport,
    components: [...snapshot.components],
    transform: snapshot.transform ? {
      position: [...snapshot.transform.position] as [number, number, number],
      rotation: [...snapshot.transform.rotation] as [number, number, number],
      scale: [...snapshot.transform.scale] as [number, number, number],
    } : null,
  };
}

export function withRenamedSnapshot(snapshot: EntitySnapshot, name: string): EntitySnapshot {
  const next = cloneSnapshot(snapshot);
  next.name = sanitizeName(name);
  return next;
}

export function withTransformedSnapshot(
  snapshot: EntitySnapshot,
  transform: Partial<EntityTransformSnapshot>,
): EntitySnapshot {
  const next = cloneSnapshot(snapshot);
  next.transform = normalizeTransform({
    position: transform.position ?? next.transform?.position,
    rotation: transform.rotation ?? next.transform?.rotation,
    scale: transform.scale ?? next.transform?.scale,
  });
  return next;
}

export function normalizeTransform(
  transform?: Partial<EntityTransformSnapshot> | null,
): EntityTransformSnapshot {
  return {
    position: toVec3(transform?.position, [0, 0, 0]),
    rotation: toVec3(transform?.rotation, [0, 0, 0]),
    scale: toVec3(transform?.scale, [1, 1, 1]),
  };
}

export function sanitizeName(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function toSummary(
  engine: Engine,
  record: EntityRecordSummary,
  hierarchy: HierarchyMaps,
): SceneEntitySummary {
  return {
    entityId: record.entityId,
    name: engine.getEntityLabel(record.entityId) ?? null,
    parentId: hierarchy.parentByEntity.get(record.entityId) ?? null,
    children: [...(hierarchy.childrenByEntity.get(record.entityId) ?? [])].sort((a, b) => a - b),
    tags: [],
    tagSupport: TAG_SUPPORT,
    components: [...record.componentDefs.map((comp) => comp.name)].sort((a, b) => a.localeCompare(b)),
    transform: readTransform(engine, record.entityId),
  };
}

function readTransform(engine: Engine, entityId: number): EntityTransformSnapshot | null {
  const world = engine.world;
  if (!world.hasComponent(entityId, LocalTransform)) {
    return null;
  }
  return {
    position: [
      world.getField(entityId, LocalTransform, 'px'),
      world.getField(entityId, LocalTransform, 'py'),
      world.getField(entityId, LocalTransform, 'pz'),
    ],
    rotation: [
      world.getField(entityId, LocalTransform, 'rotX'),
      world.getField(entityId, LocalTransform, 'rotY'),
      world.getField(entityId, LocalTransform, 'rotZ'),
    ],
    scale: [
      world.getField(entityId, LocalTransform, 'scaleX'),
      world.getField(entityId, LocalTransform, 'scaleY'),
      world.getField(entityId, LocalTransform, 'scaleZ'),
    ],
  };
}

function buildHierarchyMaps(engine: Engine): HierarchyMaps {
  const parentByEntity = new Map<number, number>();
  const childrenByEntity = new Map<number, number[]>();
  const query = engine.world.query(Parent);
  query.each((arch, count) => {
    const ids = arch.entities.data as Uint32Array;
    const parentCol = arch.getColumn(Parent, 'entity') as Uint32Array;
    for (let i = 0; i < count; i++) {
      const entityId = ids[i]!;
      const parentId = parentCol[i]!;
      parentByEntity.set(entityId, parentId);
      if (!childrenByEntity.has(parentId)) {
        childrenByEntity.set(parentId, []);
      }
      childrenByEntity.get(parentId)!.push(entityId);
    }
  });
  return { parentByEntity, childrenByEntity };
}

function collectEntityRecords(engine: Engine): EntityRecordSummary[] {
  return [...collectEntityRecordMap(engine).values()];
}

function collectEntityRecordMap(engine: Engine): Map<number, EntityRecordSummary> {
  const records = new Map<number, EntityRecordSummary>();
  const query = engine.world.query();
  query.each((arch, count) => {
    const ids = arch.entities.data as Uint32Array;
    for (let i = 0; i < count; i++) {
      const entityId = ids[i]!;
      records.set(entityId, {
        entityId,
        componentDefs: arch.components,
      });
    }
  });
  return records;
}

function toVec3(
  value: Partial<[number, number, number]> | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  return [
    Number(value?.[0] ?? fallback[0]),
    Number(value?.[1] ?? fallback[1]),
    Number(value?.[2] ?? fallback[2]),
  ];
}

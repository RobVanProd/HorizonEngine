import { LocalTransform, Parent } from '@engine/ecs';
const TAG_SUPPORT = 'unavailable';
export function readEntitySummaries(engine, options = {}) {
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
export function readEntityDetail(engine, entityId) {
    const hierarchy = buildHierarchyMaps(engine);
    const record = collectEntityRecordMap(engine).get(entityId);
    if (!record)
        return null;
    const summary = toSummary(engine, record, hierarchy);
    const componentFields = {};
    for (const comp of record.componentDefs) {
        const fields = {};
        for (const fieldName of comp.fieldNames) {
            fields[fieldName] = engine.world.getField(entityId, comp, fieldName);
        }
        componentFields[comp.name] = fields;
    }
    return {
        ...summary,
        componentFields,
    };
}
export function snapshotEntity(engine, entityId) {
    const detail = readEntityDetail(engine, entityId);
    if (!detail)
        return null;
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
export function buildPredictedCreatedSnapshot(payload) {
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
export function cloneSnapshot(snapshot) {
    return {
        entityId: snapshot.entityId,
        name: snapshot.name,
        parentId: snapshot.parentId,
        tags: [...snapshot.tags],
        tagSupport: snapshot.tagSupport,
        components: [...snapshot.components],
        transform: snapshot.transform ? {
            position: [...snapshot.transform.position],
            rotation: [...snapshot.transform.rotation],
            scale: [...snapshot.transform.scale],
        } : null,
    };
}
export function withRenamedSnapshot(snapshot, name) {
    const next = cloneSnapshot(snapshot);
    next.name = sanitizeName(name);
    return next;
}
export function withTransformedSnapshot(snapshot, transform) {
    const next = cloneSnapshot(snapshot);
    next.transform = normalizeTransform({
        position: transform.position ?? next.transform?.position,
        rotation: transform.rotation ?? next.transform?.rotation,
        scale: transform.scale ?? next.transform?.scale,
    });
    return next;
}
export function normalizeTransform(transform) {
    return {
        position: toVec3(transform?.position, [0, 0, 0]),
        rotation: toVec3(transform?.rotation, [0, 0, 0]),
        scale: toVec3(transform?.scale, [1, 1, 1]),
    };
}
export function sanitizeName(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > 0 ? text : null;
}
function toSummary(engine, record, hierarchy) {
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
function readTransform(engine, entityId) {
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
function buildHierarchyMaps(engine) {
    const parentByEntity = new Map();
    const childrenByEntity = new Map();
    const query = engine.world.query(Parent);
    query.each((arch, count) => {
        const ids = arch.entities.data;
        const parentCol = arch.getColumn(Parent, 'entity');
        for (let i = 0; i < count; i++) {
            const entityId = ids[i];
            const parentId = parentCol[i];
            parentByEntity.set(entityId, parentId);
            if (!childrenByEntity.has(parentId)) {
                childrenByEntity.set(parentId, []);
            }
            childrenByEntity.get(parentId).push(entityId);
        }
    });
    return { parentByEntity, childrenByEntity };
}
function collectEntityRecords(engine) {
    return [...collectEntityRecordMap(engine).values()];
}
function collectEntityRecordMap(engine) {
    const records = new Map();
    const query = engine.world.query();
    query.each((arch, count) => {
        const ids = arch.entities.data;
        for (let i = 0; i < count; i++) {
            const entityId = ids[i];
            records.set(entityId, {
                entityId,
                componentDefs: arch.components,
            });
        }
    });
    return records;
}
function toVec3(value, fallback) {
    return [
        Number(value?.[0] ?? fallback[0]),
        Number(value?.[1] ?? fallback[1]),
        Number(value?.[2] ?? fallback[2]),
    ];
}

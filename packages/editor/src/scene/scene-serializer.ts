import type { Engine } from '@engine/core';
import type { World, ComponentDef } from '@engine/ecs';
import { GPUMesh } from '@engine/renderer-webgpu';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  Parent, HierarchyDepth, SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
} from '@engine/ecs';
import {
  BiomeRegion,
  buildTerrainMeshData,
  ChunkCoord,
  ChunkState,
  GeneratorSeed,
  generateHeightfield,
  getWorldRegistry,
  HeightfieldMeta,
  readSplinePoints,
  ScatterRule,
  SplineControlPoint,
  SplinePath,
  StableAssetRef,
  TerrainChunk,
} from '@engine/world';

export interface SerializedEntity {
  id: number;
  parentId?: number;
  components: Record<string, Record<string, number>>;
}

export interface SerializedScene {
  version: 1;
  name: string;
  entities: SerializedEntity[];
  metadata?: Record<string, unknown>;
}

const SERIALIZABLE_COMPONENTS: ComponentDef[] = [
  LocalTransform, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
  GeneratorSeed, ChunkCoord, ChunkState, TerrainChunk, HeightfieldMeta,
  BiomeRegion, ScatterRule, StableAssetRef, SplinePath, SplineControlPoint,
];

const SUPPORT_COMPONENTS: ComponentDef[] = [Parent, HierarchyDepth, WorldMatrix];

const COMPONENT_FIELD_FILTERS: Partial<Record<string, readonly string[]>> = {
  AnimationPlayer: ['clipHandle', 'speed', 'flags'],
  AudioSource: ['clipHandle', 'volume', 'refDistance', 'maxDistance', 'rolloff', 'flags'],
};

export class SceneSerializer {
  private _engine: Engine;

  constructor(engine: Engine) {
    this._engine = engine;
  }

  serialize(name = 'Untitled'): SerializedScene {
    const world = this._engine.world;
    const entities: SerializedEntity[] = [];
    const allIds = this.collectSceneEntityIds();
    const entityLabels: Record<string, string> = {};

    for (const id of allIds) {
      if (!world.has(id)) continue;
      const components: Record<string, Record<string, number>> = {};
      let parentId: number | undefined;

      for (const comp of SERIALIZABLE_COMPONENTS) {
        if (!world.hasComponent(id, comp)) continue;
        const fields: Record<string, number> = {};
        const allowedFields = COMPONENT_FIELD_FILTERS[comp.name] ?? comp.fieldNames;
        for (const fieldName of allowedFields) {
          fields[fieldName] = world.getField(id, comp, fieldName);
        }
        components[comp.name] = fields;
      }

      if (world.hasComponent(id, Parent)) {
        const value = world.getField(id, Parent, 'entity');
        if (value !== 0) parentId = value;
      }

      if (Object.keys(components).length > 0) {
        entities.push({ id, parentId, components });
        const label = this._engine.getEntityLabel(id);
        if (label) {
          entityLabels[String(id)] = label;
        }
      }
    }

    return {
      version: 1,
      name,
      entities,
      metadata: Object.keys(entityLabels).length > 0 ? { entityLabels } : undefined,
    };
  }

  deserialize(scene: SerializedScene, options?: { replace?: boolean }): void {
    const world = this._engine.world;
    if (options?.replace) this.clearScene();

    const compMap = new Map<string, ComponentDef>();
    for (const comp of SERIALIZABLE_COMPONENTS) compMap.set(comp.name, comp);

    const idMap = new Map<number, number>();
    for (const se of scene.entities) {
      const eid = world.spawn().id;
      idMap.set(se.id, eid);

      for (const [compName, fields] of Object.entries(se.components)) {
        const comp = compMap.get(compName);
        if (!comp) continue;

        world.addComponent(eid, comp);
        for (const [fieldName, value] of Object.entries(fields)) {
          if (comp.fieldNames.includes(fieldName as any)) {
            world.setField(eid, comp, fieldName as any, value);
          }
        }
      }

      if (world.hasComponent(eid, LocalTransform) && !world.hasComponent(eid, WorldMatrix)) {
        world.addComponent(eid, WorldMatrix, identityWorldMatrix());
      }
    }

    for (const se of scene.entities) {
      const eid = idMap.get(se.id);
      if (!eid || se.parentId === undefined) continue;
      const parentEid = idMap.get(se.parentId);
      if (!parentEid) continue;
      world.addComponent(eid, Parent, { entity: parentEid });
    }

    const depthCache = new Map<number, number>();
    const resolveDepth = (serializedId: number): number => {
      const cached = depthCache.get(serializedId);
      if (cached !== undefined) return cached;
      const entity = scene.entities.find((item) => item.id === serializedId);
      if (!entity || entity.parentId === undefined) {
        depthCache.set(serializedId, 0);
        return 0;
      }
      const depth = resolveDepth(entity.parentId) + 1;
      depthCache.set(serializedId, depth);
      return depth;
    };

    for (const se of scene.entities) {
      if (se.parentId === undefined) continue;
      const eid = idMap.get(se.id);
      if (!eid) continue;
      world.addComponent(eid, HierarchyDepth, { depth: resolveDepth(se.id) });
    }

    const entityLabels = (scene.metadata?.['entityLabels'] ?? null) as Record<string, string> | null;
    if (entityLabels) {
      for (const [serializedId, label] of Object.entries(entityLabels)) {
        const mappedId = idMap.get(Number(serializedId));
        if (mappedId !== undefined) {
          this._engine.setEntityLabel(mappedId, label);
        }
      }
    }

    this._rebuildProceduralWorldState(idMap.values());
  }

  toJSON(name = 'Untitled'): string {
    return JSON.stringify(this.serialize(name), null, 2);
  }

  fromJSON(json: string, options?: { replace?: boolean }): void {
    const scene = JSON.parse(json) as SerializedScene;
    if (scene.version !== 1) throw new Error(`Unsupported scene version: ${scene.version}`);
    this.deserialize(scene, options);
  }

  downloadScene(name = 'scene'): void {
    const json = this.toJSON(name);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.hscene`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async loadSceneFile(options?: { replace?: boolean }): Promise<void> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.hscene,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return resolve();
        const text = await file.text();
        this.fromJSON(text, options);
        resolve();
      });
      input.click();
    });
  }

  clearScene(): void {
    const world = this._engine.world;
    const ids = this.collectSceneEntityIds();
    for (const id of ids) {
      if (world.has(id)) world.destroy(id);
    }
  }

  collectSceneEntityIds(): number[] {
    const world = this._engine.world;
    const ids = new Set<number>();
    const scan = (comp: ComponentDef): void => {
      world.query(comp).each((arch, count) => {
        const data = arch.entities.data as Uint32Array;
        for (let i = 0; i < count; i++) ids.add(data[i]!);
      });
    };

    for (const comp of [...SERIALIZABLE_COMPONENTS, ...SUPPORT_COMPONENTS]) {
      scan(comp);
    }
    return [...ids];
  }

  private _rebuildProceduralWorldState(entityIds: Iterable<number>): void {
    const world = this._engine.world;
    const registry = getWorldRegistry(this._engine);

    for (const entityId of entityIds) {
      if (!world.has(entityId)) continue;

      if (
        world.hasComponent(entityId, GeneratorSeed) &&
        world.hasComponent(entityId, TerrainChunk) &&
        world.hasComponent(entityId, HeightfieldMeta)
      ) {
        const heightfield = generateHeightfield({
          seed: world.getField(entityId, GeneratorSeed, 'value'),
          width: world.getField(entityId, HeightfieldMeta, 'width'),
          depth: world.getField(entityId, HeightfieldMeta, 'depth'),
          cellSize: world.getField(entityId, HeightfieldMeta, 'cellSize'),
          originX: world.getField(entityId, HeightfieldMeta, 'originX'),
          originZ: world.getField(entityId, HeightfieldMeta, 'originZ'),
          baseHeight: world.getField(entityId, TerrainChunk, 'baseHeight'),
          heightScale: world.getField(entityId, TerrainChunk, 'heightScale'),
        });
        const meshHandle = this._engine.registerMesh(
          GPUMesh.create(this._engine.gpu.device, buildTerrainMeshData(heightfield)),
        );
        const materialHandle = this._engine.createMaterial({
          albedo: [0.28, 0.36, 0.24, 1],
          roughness: 0.92,
          metallic: 0,
        }).handle;

        if (!world.hasComponent(entityId, MeshRef)) world.addComponent(entityId, MeshRef);
        if (!world.hasComponent(entityId, MaterialRef)) world.addComponent(entityId, MaterialRef);
        if (!world.hasComponent(entityId, Visible)) world.addComponent(entityId, Visible);
        world.setField(entityId, MeshRef, 'handle', meshHandle);
        world.setField(entityId, MaterialRef, 'handle', materialHandle);
        registry.registerTerrainEntity(entityId, heightfield, meshHandle, materialHandle);
      }

      if (world.hasComponent(entityId, SplinePath)) {
        registry.registerSplineEntity(entityId, readSplinePoints(world, entityId));
      }
    }
  }
}

function identityWorldMatrix(): Record<`m${number}`, number> {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

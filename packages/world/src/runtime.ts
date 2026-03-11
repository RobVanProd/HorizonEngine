import type { Engine } from '@engine/core';
import { LocalTransform, MaterialRef, MeshRef, Visible, WorldMatrix } from '@engine/ecs';
import { GPUMesh } from '@engine/renderer-webgpu';
import {
  BiomeRegion,
  ChunkCoord,
  ChunkState,
  ChunkLoadState,
  GeneratorSeed,
  HeightfieldMeta,
  ScatterRule,
  SplineKind,
  StableAssetRef,
  TerrainChunk,
} from './components.js';
import {
  BiomeId,
  buildTerrainMeshData,
  generateHeightfield,
  generateScatterInstances,
  sampleHeightWorld,
  sampleSlopeAt,
  type Heightfield,
  type ScatterInstance,
  type ScatterOptions,
  type TerrainGenerationOptions,
} from './terrain.js';
import { createSplineEntities, readSplinePoints, type CreateSplineOptions, type SplinePoint } from './spline.js';

interface TerrainRecord {
  heightfield: Heightfield;
  meshHandle: number;
  materialHandle: number;
}

interface ScatterRecord {
  terrainEntity: number;
  instanceIds: number[];
  instances: ScatterInstance[];
}

export interface RegionSample {
  averageHeight: number;
  averageSlope: number;
  biomeHistogram: Record<number, number>;
  sampleCount: number;
}

export interface TerrainSpawnOptions extends TerrainGenerationOptions {
  materialHandle?: number;
  stableAssetId?: number;
}

export interface SplineSpawnOptions extends CreateSplineOptions {
  stableAssetId?: number;
}

export interface ScatterSpawnOptions extends ScatterOptions {
  terrainEntityId: number;
  meshHandle: number;
  materialHandle?: number;
  stableAssetId?: number;
}

export class WorldRegistry {
  readonly terrains = new Map<number, TerrainRecord>();
  readonly splines = new Map<number, SplinePoint[]>();
  readonly scatters = new Map<number, ScatterRecord>();

  constructor(readonly engine: Engine) {}

  spawnTerrain(options: TerrainSpawnOptions): {
    entityId: number;
    meshHandle: number;
    materialHandle: number;
    heightfield: Heightfield;
  } {
    const heightfield = generateHeightfield(options);
    const meshData = buildTerrainMeshData(heightfield);
    const meshHandle = this.engine.registerMesh(GPUMesh.create(this.engine.gpu.device, meshData));
    const materialHandle = options.materialHandle ?? this.engine.createMaterial({
      albedo: [0.28, 0.36, 0.24, 1],
      roughness: 0.92,
      metallic: 0,
    }).handle;

    const entity = this.engine.world.spawn();
    entity.add(LocalTransform, {
      px: 0, py: 0, pz: 0,
      rotX: 0, rotY: 0, rotZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    entity.add(WorldMatrix, identityWorldMatrix());
    entity.add(MeshRef, { handle: meshHandle });
    entity.add(MaterialRef, { handle: materialHandle });
    entity.add(Visible, { _tag: 1 });
    entity.add(GeneratorSeed, { value: options.seed >>> 0 });
    entity.add(ChunkCoord, {
      cx: Math.floor((options.originX ?? 0) / Math.max(1, (options.width - 1) * (options.cellSize ?? 2))),
      cz: Math.floor((options.originZ ?? 0) / Math.max(1, (options.depth - 1) * (options.cellSize ?? 2))),
    });
    entity.add(ChunkState, { state: ChunkLoadState.Active, revision: 1 });
    entity.add(TerrainChunk, {
      size: Math.max(options.width, options.depth) * (options.cellSize ?? 2),
      resolution: Math.max(options.width, options.depth),
      heightScale: options.heightScale ?? 18,
      baseHeight: options.baseHeight ?? 0,
      minHeight: heightfield.minHeight,
      maxHeight: heightfield.maxHeight,
    });
    entity.add(HeightfieldMeta, {
      originX: options.originX ?? 0,
      originZ: options.originZ ?? 0,
      cellSize: options.cellSize ?? 2,
      width: heightfield.width,
      depth: heightfield.depth,
    });
    entity.add(BiomeRegion, {
      biomeId: BiomeId.Plains,
      weight: 1,
      temperature: 0.5,
      moisture: 0.5,
    });
    if (options.stableAssetId !== undefined) {
      entity.add(StableAssetRef, { assetId: options.stableAssetId, variant: 0 });
    }

    this.terrains.set(entity.id, { heightfield, meshHandle, materialHandle });
    return { entityId: entity.id, meshHandle, materialHandle, heightfield };
  }

  registerTerrainEntity(entityId: number, heightfield: Heightfield, meshHandle: number, materialHandle: number): void {
    this.terrains.set(entityId, { heightfield, meshHandle, materialHandle });
  }

  spawnSpline(points: SplinePoint[], options: SplineSpawnOptions = {}): { entityId: number; controlPointIds: number[] } {
    const created = createSplineEntities(this.engine.world, points, {
      closed: options.closed,
      kind: options.kind ?? SplineKind.Generic,
      width: options.width ?? 4,
    });
    this.splines.set(created.splineEntity, points.map((point) => ({ ...point, position: [...point.position] as [number, number, number] })));
    if (options.stableAssetId !== undefined) {
      this.engine.world.addComponent(created.splineEntity, StableAssetRef, { assetId: options.stableAssetId, variant: 0 });
    }
    return { entityId: created.splineEntity, controlPointIds: created.controlPointIds };
  }

  registerSplineEntity(entityId: number, points: SplinePoint[]): void {
    this.splines.set(entityId, points.map((point) => ({ ...point, position: [...point.position] as [number, number, number] })));
  }

  readSpline(entityId: number): SplinePoint[] {
    const fromRegistry = this.splines.get(entityId);
    if (fromRegistry) return fromRegistry.map((point) => ({ ...point, position: [...point.position] as [number, number, number] }));
    const points = readSplinePoints(this.engine.world, entityId);
    this.splines.set(entityId, points);
    return points;
  }

  paintBiomeCircle(terrainEntityId: number, centerX: number, centerZ: number, radius: number, biomeId: number): boolean {
    const terrain = this.terrains.get(terrainEntityId);
    if (!terrain) return false;
    const field = terrain.heightfield;
    for (let z = 0; z < field.depth; z++) {
      for (let x = 0; x < field.width; x++) {
        const wx = field.originX + x * field.cellSize;
        const wz = field.originZ + z * field.cellSize;
        if (Math.hypot(wx - centerX, wz - centerZ) <= radius) {
          field.biomeIds[z * field.width + x] = biomeId;
        }
      }
    }
    return true;
  }

  scatterTerrain(options: ScatterSpawnOptions): { scatterEntityId: number; instanceCount: number } {
    const terrain = this.terrains.get(options.terrainEntityId);
    if (!terrain) {
      throw new Error(`Terrain ${options.terrainEntityId} is not registered`);
    }
    const instances = generateScatterInstances(terrain.heightfield, options);
    const materialHandle = options.materialHandle ?? terrain.materialHandle;
    const scatterRoot = this.engine.world.spawn();
    scatterRoot.add(ScatterRule, {
      prototypeMesh: options.meshHandle,
      prototypeMaterial: materialHandle,
      density: options.density,
      minScale: options.minScale ?? 0.8,
      maxScale: options.maxScale ?? 1.4,
      jitter: 0.5,
      seedOffset: options.seed >>> 0,
    });
    if (options.stableAssetId !== undefined) {
      scatterRoot.add(StableAssetRef, { assetId: options.stableAssetId, variant: 0 });
    }

    const instanceIds: number[] = [];
    for (const instance of instances) {
      const entity = this.engine.world.spawn();
      entity.add(LocalTransform, {
        px: instance.position[0],
        py: instance.position[1],
        pz: instance.position[2],
        rotX: 0,
        rotY: instance.rotationY,
        rotZ: 0,
        scaleX: instance.scale,
        scaleY: instance.scale,
        scaleZ: instance.scale,
      });
      entity.add(WorldMatrix, identityWorldMatrix());
      entity.add(MeshRef, { handle: options.meshHandle });
      entity.add(MaterialRef, { handle: materialHandle });
      entity.add(Visible, { _tag: 1 });
      instanceIds.push(entity.id);
    }

    this.scatters.set(scatterRoot.id, {
      terrainEntity: options.terrainEntityId,
      instanceIds,
      instances,
    });
    return { scatterEntityId: scatterRoot.id, instanceCount: instances.length };
  }

  sampleRegion(terrainEntityId: number, x: number, z: number, radius: number): RegionSample {
    const terrain = this.terrains.get(terrainEntityId);
    if (!terrain) {
      throw new Error(`Terrain ${terrainEntityId} is not registered`);
    }
    const field = terrain.heightfield;
    let totalHeight = 0;
    let totalSlope = 0;
    let count = 0;
    const histogram: Record<number, number> = {};
    for (let gz = 0; gz < field.depth; gz++) {
      for (let gx = 0; gx < field.width; gx++) {
        const wx = field.originX + gx * field.cellSize;
        const wz = field.originZ + gz * field.cellSize;
        if (Math.hypot(wx - x, wz - z) > radius) continue;
        totalHeight += field.heights[gz * field.width + gx]!;
        totalSlope += sampleSlopeAt(field, gx, gz);
        const biomeId = field.biomeIds[gz * field.width + gx]!;
        histogram[biomeId] = (histogram[biomeId] ?? 0) + 1;
        count++;
      }
    }
    return {
      averageHeight: count > 0 ? totalHeight / count : sampleHeightWorld(field, x, z),
      averageSlope: count > 0 ? totalSlope / count : 0,
      biomeHistogram: histogram,
      sampleCount: count,
    };
  }
}

const REGISTRIES = new WeakMap<Engine, WorldRegistry>();

export function getWorldRegistry(engine: Engine): WorldRegistry {
  let registry = REGISTRIES.get(engine);
  if (!registry) {
    registry = new WorldRegistry(engine);
    REGISTRIES.set(engine, registry);
  }
  return registry;
}

function identityWorldMatrix(): Record<`m${number}`, number> {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

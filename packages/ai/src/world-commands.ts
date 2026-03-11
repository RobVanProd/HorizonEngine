import type { Engine } from '@engine/core';
import { getWorldRegistry, SplineKind } from '@engine/world';
import type { CommandRouter } from './command-router.js';

export function registerWorldCommands(router: CommandRouter, engine: Engine): void {
  const registry = getWorldRegistry(engine);

  router.register({
    action: 'world.createTerrain',
    description: 'Generate a procedural terrain patch and register it as a world chunk',
    params: {
      seed: { type: 'number', required: true, description: 'Seed used for deterministic terrain generation' },
      width: { type: 'number', description: 'Grid width in samples', default: 64 },
      depth: { type: 'number', description: 'Grid depth in samples', default: 64 },
      cellSize: { type: 'number', description: 'Distance between terrain samples', default: 2 },
      originX: { type: 'number', description: 'Terrain origin X', default: 0 },
      originZ: { type: 'number', description: 'Terrain origin Z', default: 0 },
      baseHeight: { type: 'number', description: 'Base terrain height', default: 0 },
      heightScale: { type: 'number', description: 'Terrain height multiplier', default: 18 },
      materialHandle: { type: 'number', description: 'Optional existing material handle to use' },
      stableAssetId: { type: 'number', description: 'Optional stable asset reference for serialization/tooling' },
    },
  }, (params) => {
    const created = registry.spawnTerrain({
      seed: Number(params['seed']),
      width: Number(params['width'] ?? 64),
      depth: Number(params['depth'] ?? 64),
      cellSize: Number(params['cellSize'] ?? 2),
      originX: Number(params['originX'] ?? 0),
      originZ: Number(params['originZ'] ?? 0),
      baseHeight: Number(params['baseHeight'] ?? 0),
      heightScale: Number(params['heightScale'] ?? 18),
      materialHandle: params['materialHandle'] !== undefined ? Number(params['materialHandle']) : undefined,
      stableAssetId: params['stableAssetId'] !== undefined ? Number(params['stableAssetId']) : undefined,
    });
    return {
      ok: true,
      data: {
        entityId: created.entityId,
        meshHandle: created.meshHandle,
        materialHandle: created.materialHandle,
        minHeight: created.heightfield.minHeight,
        maxHeight: created.heightfield.maxHeight,
      },
    };
  });

  router.register({
    action: 'world.addSpline',
    description: 'Create a spline path from a flat XYZ point array',
    params: {
      points: { type: 'array', required: true, description: 'Flat XYZ control-point list [x0,y0,z0,x1,y1,z1,...]', items: { type: 'number' } },
      closed: { type: 'boolean', description: 'Whether the spline loops' },
      width: { type: 'number', description: 'Semantic width for roads/rivers/fences', default: 4 },
      kind: { type: 'string', description: 'Spline kind: generic, road, river, fence, cameraRail', default: 'generic' },
      stableAssetId: { type: 'number', description: 'Optional stable asset reference for serialization/tooling' },
    },
  }, (params) => {
    const flat = (params['points'] as number[] | undefined) ?? [];
    if (flat.length < 6 || flat.length % 3 !== 0) {
      return { ok: false, error: 'points must contain at least two XYZ control points' };
    }
    const points = [];
    for (let i = 0; i < flat.length; i += 3) {
      points.push({
        position: [flat[i]!, flat[i + 1]!, flat[i + 2]!] as [number, number, number],
      });
    }
    const kindLookup: Record<string, SplineKind> = {
      generic: SplineKind.Generic,
      road: SplineKind.Road,
      river: SplineKind.River,
      fence: SplineKind.Fence,
      cameraRail: SplineKind.CameraRail,
    };
    const kindName = String(params['kind'] ?? 'generic');
    const created = registry.spawnSpline(points, {
      closed: Boolean(params['closed'] ?? false),
      width: Number(params['width'] ?? 4),
      kind: kindLookup[kindName] ?? SplineKind.Generic,
      stableAssetId: params['stableAssetId'] !== undefined ? Number(params['stableAssetId']) : undefined,
    });
    return { ok: true, data: created };
  });

  router.register({
    action: 'world.paintBiome',
    description: 'Paint a biome id into a circular region on a registered terrain',
    params: {
      terrainEntityId: { type: 'number', required: true, description: 'Terrain entity to modify' },
      centerX: { type: 'number', required: true, description: 'Biome paint center X' },
      centerZ: { type: 'number', required: true, description: 'Biome paint center Z' },
      radius: { type: 'number', required: true, description: 'Paint radius' },
      biomeId: { type: 'number', required: true, description: 'Biome id to stamp' },
    },
  }, (params) => {
    const ok = registry.paintBiomeCircle(
      Number(params['terrainEntityId']),
      Number(params['centerX']),
      Number(params['centerZ']),
      Number(params['radius']),
      Number(params['biomeId']),
    );
    return ok ? { ok: true } : { ok: false, error: 'Terrain not found in world registry' };
  });

  router.register({
    action: 'world.scatter',
    description: 'Scatter prototype instances across a registered terrain using biome/slope filters',
    params: {
      terrainEntityId: { type: 'number', required: true, description: 'Terrain entity to scatter over' },
      meshHandle: { type: 'number', required: true, description: 'Prototype mesh handle' },
      materialHandle: { type: 'number', description: 'Prototype material handle' },
      density: { type: 'number', required: true, description: 'Per-cell spawn probability 0-1' },
      seed: { type: 'number', required: true, description: 'Scatter seed' },
      stableAssetId: { type: 'number', description: 'Optional stable asset reference for serialization/tooling' },
    },
  }, (params) => {
    const created = registry.scatterTerrain({
      terrainEntityId: Number(params['terrainEntityId']),
      meshHandle: Number(params['meshHandle']),
      materialHandle: params['materialHandle'] !== undefined ? Number(params['materialHandle']) : undefined,
      density: Number(params['density']),
      seed: Number(params['seed']),
      stableAssetId: params['stableAssetId'] !== undefined ? Number(params['stableAssetId']) : undefined,
    });
    return { ok: true, data: created };
  });

  router.register({
    action: 'world.sampleRegion',
    description: 'Sample average height, average slope, and biome histogram for a terrain region',
    params: {
      terrainEntityId: { type: 'number', required: true, description: 'Terrain entity to sample' },
      x: { type: 'number', required: true, description: 'World X position' },
      z: { type: 'number', required: true, description: 'World Z position' },
      radius: { type: 'number', required: true, description: 'Sample radius' },
    },
  }, (params) => {
    const sample = registry.sampleRegion(
      Number(params['terrainEntityId']),
      Number(params['x']),
      Number(params['z']),
      Number(params['radius']),
    );
    return { ok: true, data: sample };
  });
}

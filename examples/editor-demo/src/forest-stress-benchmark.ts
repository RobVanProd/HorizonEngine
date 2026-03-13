import { Engine } from '@engine/core';
import { GrassRef, HierarchyDepth, LocalTransform, MaterialRef, MeshRef, Parent, Visible, WorldMatrix } from '@engine/ecs';
import { spawnProceduralTree, loadGltfScene, loadTexture, type SceneBounds } from '@engine/assets';
import {
  GPUMesh,
  type GrassMaterial,
  type GrassMaterialParams,
  type MeshData,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
} from '@engine/renderer-webgpu';
import {
  BiomeId,
  createSeededRandom,
  generateScatterInstances,
  getWorldRegistry,
  OccupancyMap,
  sampleSplinePolyline,
  type SplinePoint,
} from '@engine/world';
import {
  runForestStressBenchmarkRun,
  type ForestStressBenchmarkRun,
  type ForestStressDensityLabel,
} from '@engine/ai';
import { buildStylizedGrassMesh } from './grass-field.js';
import { naturePackBaseUrl, naturePackEntries } from 'virtual:nature-pack-manifest';

export const FOREST_STRESS_BENCHMARK_SCENE_NAME = 'first-nature-expedition';
const FIRST_LEVEL_SEED = 12345;
const FIRST_LEVEL_TRAIL_WIDTH = 8;

export const FIRST_NATURE_EXPEDITION_DENSITY_PROFILES: Record<ForestStressDensityLabel, {
  grassDensity: number;
  bladesPerCell: number;
  proceduralTreeDensityScale: number;
  scatterDensityScale: number;
}> = {
  low: {
    grassDensity: 0.65,
    bladesPerCell: 96,
    proceduralTreeDensityScale: 0.4,
    scatterDensityScale: 0.45,
  },
  medium: {
    grassDensity: 0.85,
    bladesPerCell: 192,
    proceduralTreeDensityScale: 0.7,
    scatterDensityScale: 0.7,
  },
  high: {
    grassDensity: 1,
    bladesPerCell: 384,
    proceduralTreeDensityScale: 1,
    scatterDensityScale: 1,
  },
  extreme: {
    grassDensity: 1,
    bladesPerCell: 512,
    proceduralTreeDensityScale: 1.3,
    scatterDensityScale: 1.2,
  },
};

const NATURE_SCATTER_ASSETS: Array<{
  file: string;
  density: number;
  minScale: number;
  maxScale: number;
  allowedBiomes?: number[];
  minNormalizedHeight?: number;
  maxNormalizedHeight?: number;
  minSlope?: number;
  maxSlope?: number;
  occupationRadiusPixels?: number;
  noiseScale?: number;
  noiseThreshold?: number;
  noiseSeedOffset?: number;
}> = [
  { file: 'Rock_Medium_1.gltf', density: 0.02, minScale: 0.6, maxScale: 1.4, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.55, maxNormalizedHeight: 0.95, maxSlope: 0.4, occupationRadiusPixels: 4, noiseScale: 0.05, noiseThreshold: 0.5, noiseSeedOffset: 81 },
  { file: 'Rock_Medium_2.gltf', density: 0.015, minScale: 0.5, maxScale: 1.2, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.5, maxNormalizedHeight: 0.9, maxSlope: 0.45, occupationRadiusPixels: 4, noiseScale: 0.05, noiseThreshold: 0.53, noiseSeedOffset: 91 },
  { file: 'Bush_Common.gltf', density: 0.05, minScale: 0.65, maxScale: 1.15, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.46, maxSlope: 0.06, occupationRadiusPixels: 3, noiseScale: 0.09, noiseThreshold: 0.56, noiseSeedOffset: 101 },
  { file: 'Plant_1_Big.gltf', density: 0.04, minScale: 0.45, maxScale: 0.85, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.06, maxNormalizedHeight: 0.52, maxSlope: 0.07, occupationRadiusPixels: 1, noiseScale: 0.08, noiseThreshold: 0.5, noiseSeedOffset: 111 },
  { file: 'Fern_1.gltf', density: 0.06, minScale: 0.45, maxScale: 0.9, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.58, maxSlope: 0.08, occupationRadiusPixels: 1, noiseScale: 0.09, noiseThreshold: 0.54, noiseSeedOffset: 100 },
  { file: 'Grass_Common_Tall.gltf', density: 0.72, minScale: 0.2, maxScale: 0.42, allowedBiomes: [BiomeId.Plains], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.46, maxSlope: 0.06, occupationRadiusPixels: 0, noiseScale: 0.065, noiseThreshold: 0.58, noiseSeedOffset: 200 },
];

const NATURE_PROCEDURAL_TREE_ASSETS: Array<{
  preset: 'oak-medium' | 'oak-large' | 'aspen-medium' | 'ash-medium' | 'pine-medium' | 'pine-large';
  density: number;
  minScale: number;
  maxScale: number;
  allowedBiomes?: number[];
  minNormalizedHeight?: number;
  maxNormalizedHeight?: number;
  minSlope?: number;
  maxSlope?: number;
  occupationRadiusPixels?: number;
  noiseScale?: number;
  noiseThreshold?: number;
  noiseSeedOffset?: number;
}> = [
  { preset: 'oak-medium', density: 0.075, minScale: 0.84, maxScale: 1.22, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.78, maxSlope: 0.11, occupationRadiusPixels: 7, noiseScale: 0.08, noiseThreshold: 0.54, noiseSeedOffset: 301 },
  { preset: 'oak-large', density: 0.028, minScale: 1.05, maxScale: 1.4, allowedBiomes: [BiomeId.Forest], minNormalizedHeight: 0.14, maxNormalizedHeight: 0.72, maxSlope: 0.1, occupationRadiusPixels: 8, noiseScale: 0.075, noiseThreshold: 0.57, noiseSeedOffset: 311 },
  { preset: 'aspen-medium', density: 0.05, minScale: 0.85, maxScale: 1.18, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.1, maxNormalizedHeight: 0.72, maxSlope: 0.1, occupationRadiusPixels: 6, noiseScale: 0.08, noiseThreshold: 0.56, noiseSeedOffset: 321 },
  { preset: 'ash-medium', density: 0.038, minScale: 0.82, maxScale: 1.15, allowedBiomes: [BiomeId.Forest], minNormalizedHeight: 0.15, maxNormalizedHeight: 0.74, maxSlope: 0.12, occupationRadiusPixels: 6, noiseScale: 0.08, noiseThreshold: 0.58, noiseSeedOffset: 331 },
  { preset: 'pine-medium', density: 0.06, minScale: 0.86, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Plains, BiomeId.Alpine], minNormalizedHeight: 0.16, maxNormalizedHeight: 0.9, maxSlope: 0.14, occupationRadiusPixels: 6, noiseScale: 0.07, noiseThreshold: 0.52, noiseSeedOffset: 341 },
  { preset: 'pine-large', density: 0.03, minScale: 1.02, maxScale: 1.38, allowedBiomes: [BiomeId.Forest, BiomeId.Alpine], minNormalizedHeight: 0.18, maxNormalizedHeight: 0.92, maxSlope: 0.15, occupationRadiusPixels: 7, noiseScale: 0.07, noiseThreshold: 0.55, noiseSeedOffset: 351 },
];

const forestBenchmarkGrassMaterials = new Map<number, GrassMaterial>();
let nextBenchmarkGrassMaterialHandle = 900_000;

interface LayoutCircle {
  centerX: number;
  centerZ: number;
  radius: number;
}

function buildFirstLevelTrail(originX: number, originZ: number, terrainSize: number, seed: number): SplinePoint[] {
  const rng = createSeededRandom(seed ^ 0x5bd1e995);
  const pointCount = 8;
  const startX = originX + terrainSize * 0.12;
  const endX = originX + terrainSize * 0.88;
  const baseZ = originZ + terrainSize * (0.48 + rng.range(-0.04, 0.04));
  const ampA = terrainSize * 0.12;
  const ampB = terrainSize * 0.05;
  const phaseA = rng.range(-0.6, 0.6);
  const phaseB = rng.range(0, Math.PI * 2);
  const minZ = originZ + terrainSize * 0.14;
  const maxZ = originZ + terrainSize * 0.86;
  const points: SplinePoint[] = [];
  for (let i = 0; i < pointCount; i++) {
    const t = i / Math.max(1, pointCount - 1);
    const x = lerp(startX, endX, t);
    const z = baseZ
      + Math.sin(t * Math.PI * 1.35 + phaseA) * ampA
      + Math.sin(t * Math.PI * 4.1 + phaseB) * ampB;
    points.push({
      position: [x, 0, clamp(z, minZ, maxZ)],
    });
  }
  return points;
}

function buildFirstLevelClearings(trail: SplinePoint[]): LayoutCircle[] {
  const samples = sampleSplinePolyline(trail, 12);
  const picks = [
    { index: 2, offset: 8, radius: 11 },
    { index: 6, offset: 0, radius: 13 },
    { index: 10, offset: -10, radius: 12 },
  ];
  return picks.map((pick) => {
    const sample = samples[pick.index] ?? samples[samples.length - 1]!;
    const tangent = sample.tangent;
    const nx = -tangent[2];
    const nz = tangent[0];
    return {
      centerX: sample.position[0] + nx * pick.offset,
      centerZ: sample.position[2] + nz * pick.offset,
      radius: pick.radius,
    };
  });
}

function getChildren(world: Engine['world'], parentId: number): number[] {
  const children: number[] = [];
  world.query(Parent).each((arch, count) => {
    const parentCol = arch.getColumn(Parent, 'entity') as Uint32Array;
    const ids = arch.entities.data as Uint32Array;
    for (let i = 0; i < count; i++) {
      if (parentCol[i] === parentId) children.push(ids[i]!);
    }
  });
  return children;
}

function cloneEntityHierarchy(
  engine: Engine,
  rootId: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  scale: number,
  rotationY: number,
): number {
  const world = engine.world;
  const copyComp = (src: number, dst: number, comp: any) => {
    if (!world.hasComponent(src, comp)) return;
    world.addComponent(dst, comp);
    for (const field of comp.fieldNames) {
      world.setField(dst, comp, field, world.getField(src, comp, field));
    }
  };

  function cloneRecursive(srcId: number, newParentId: number | null, isRoot: boolean): number {
    const dst = world.spawn().id;
    copyComp(srcId, dst, LocalTransform);
    copyComp(srcId, dst, WorldMatrix);
    copyComp(srcId, dst, MeshRef);
    copyComp(srcId, dst, MaterialRef);
    copyComp(srcId, dst, Visible);

    if (isRoot) {
      world.setField(dst, LocalTransform, 'px', offsetX);
      world.setField(dst, LocalTransform, 'py', offsetY);
      world.setField(dst, LocalTransform, 'pz', offsetZ);
      world.setField(dst, LocalTransform, 'rotY', rotationY);
      world.setField(dst, LocalTransform, 'scaleX', scale);
      world.setField(dst, LocalTransform, 'scaleY', scale);
      world.setField(dst, LocalTransform, 'scaleZ', scale);
    }

    if (newParentId !== null) {
      world.addComponent(dst, Parent, { entity: newParentId });
      world.addComponent(dst, HierarchyDepth, { depth: 1 });
    }

    for (const childId of getChildren(world, srcId)) {
      cloneRecursive(childId, dst, false);
    }
    return dst;
  }

  return cloneRecursive(rootId, null, true);
}

function destroyEntityHierarchy(engine: Engine, rootId: number): void {
  const world = engine.world;
  const ids: number[] = [];
  function collect(id: number) {
    if (!world.has(id)) return;
    ids.push(id);
    for (const childId of getChildren(world, id)) collect(childId);
  }
  collect(rootId);
  for (const id of ids.reverse()) {
    if (world.has(id)) world.destroy(id);
  }
}

export async function runFirstNatureExpeditionForestStressBenchmark(options: {
  engine: Engine;
  densityLabel: ForestStressDensityLabel;
}): Promise<ForestStressBenchmarkRun> {
  return runForestStressBenchmarkRun({
    sceneName: FOREST_STRESS_BENCHMARK_SCENE_NAME,
    densityLabel: options.densityLabel,
    createContext: () => ({ engine: options.engine }),
    setupScene: async ({ engine }, densityLabel) => {
      await setupFirstNatureExpeditionForestStressScene(engine, densityLabel);
      return {
        notes: [
          'Scene target: first-nature-expedition.',
          'Density tiers are produced by parameter scaling, not separate authored scene files.',
          'Current real metrics are entity, mesh, material, and renderer frame counters when available.',
        ],
      };
    },
  });
}

export async function setupFirstNatureExpeditionForestStressScene(
  engine: Engine,
  densityLabel: ForestStressDensityLabel,
): Promise<{ bounds: SceneBounds }> {
  if (!naturePackBaseUrl || naturePackEntries.length === 0) {
    throw new Error('first-nature-expedition forest benchmark requires the nature pack manifest');
  }

  const device = engine.gpu.device;
  const densityProfile = FIRST_NATURE_EXPEDITION_DENSITY_PROFILES[densityLabel];
  const registry = getWorldRegistry(engine);
  const terrainSize = 200;
  const cellSize = 2;
  const originX = -terrainSize * 0.5;
  const originZ = -terrainSize * 0.5;
  const trail = buildFirstLevelTrail(originX, originZ, terrainSize, FIRST_LEVEL_SEED);
  const clearings = buildFirstLevelClearings(trail);
  const spring = clearings[2] ?? clearings[clearings.length - 1];
  const terrainWidth = (100 - 1) * cellSize;
  const terrainDepth = (100 - 1) * cellSize;
  const terrainCenterX = originX + terrainWidth * 0.5;
  const terrainCenterZ = originZ + terrainDepth * 0.5;

  engine.lighting = {
    direction: [-0.28, -0.92, -0.24],
    color: [1.0, 0.985, 0.96],
    intensity: 4.9,
    ambient: [0.03, 0.04, 0.045],
    envIntensity: 1.05,
  };

  const grassDiffuseUrl = new URL('../../pbr-demo/public/textures/grass_diffuse.jpg', import.meta.url).href;
  const grassNormalUrl = new URL('../../pbr-demo/public/textures/grass_normal.jpg', import.meta.url).href;
  const grassRoughUrl = new URL('../../pbr-demo/public/textures/grass_rough.jpg', import.meta.url).href;
  const [albedoTex, normalTex, roughTex] = await Promise.all([
    loadTexture(device, grassDiffuseUrl, { sRGB: true }),
    loadTexture(device, grassNormalUrl),
    loadTexture(device, grassRoughUrl),
  ]);
  const terrainMat = engine.createMaterial({
    albedo: [0.72, 0.8, 0.66, 1],
    roughness: 0.94,
    metallic: 0,
    albedoTexture: albedoTex,
    normalTexture: normalTex,
    mrTexture: roughTex,
  });

  const terrainResult = registry.spawnTerrain({
    seed: FIRST_LEVEL_SEED,
    width: 100,
    depth: 100,
    cellSize,
    originX,
    originZ,
    baseHeight: -0.25,
    heightScale: 11,
    materialHandle: terrainMat.handle,
    waterThreshold: 0.14,
    waterScaleX: 30 / terrainWidth,
    waterScaleZ: 24 / terrainDepth,
    waterOffsetX: spring.centerX - terrainCenterX,
    waterOffsetZ: spring.centerZ - terrainCenterZ,
    waterSegments: 96,
    waterMaterial: {
      waveScale: 0.22,
      waveStrength: 0.45,
      waveSpeed: 0.7,
      shallowColor: [0.19, 0.52, 0.46],
      deepColor: [0.03, 0.18, 0.28],
      foamColor: [0.86, 0.96, 0.98],
      edgeFade: 0.22,
      clarity: 0.88,
      foamAmount: 0.72,
    },
    roadSpline: trail,
    roadWidth: FIRST_LEVEL_TRAIL_WIDTH * 0.82,
    uvScale: 10,
    uvOffset: [0.37, 0.61],
    uvRotation: 0.4,
  });
  engine.setEntityLabel(terrainResult.entityId, 'Forest Stress Terrain');

  const terrainRec = registry.terrains.get(terrainResult.entityId);
  if (!terrainRec) {
    throw new Error('Failed to resolve benchmark terrain record');
  }
  const heightfield = terrainRec.heightfield;
  for (const clearing of clearings) {
    registry.paintBiomeCircle(terrainResult.entityId, clearing.centerX, clearing.centerZ, clearing.radius + 5, BiomeId.Plains);
  }
  registry.paintBiomeCircle(terrainResult.entityId, spring.centerX, spring.centerZ, 10, BiomeId.River);

  const grassAvoidCircles = clearings.map((clearing) => ({
    centerX: clearing.centerX,
    centerZ: clearing.centerZ,
    radius: clearing.radius * 0.9,
  }));
  const grassField = buildStylizedGrassMesh(heightfield, {
    seed: FIRST_LEVEL_SEED ^ 0x9e3779b9,
    density: densityProfile.grassDensity,
    bladesPerCell: densityProfile.bladesPerCell,
    minBladeHeight: 0.38,
    maxBladeHeight: 0.9,
    bladeWidth: 0.085,
    clusterRadiusMultiplier: 0.76,
    allowedBiomes: [BiomeId.Plains, BiomeId.Forest],
    minNormalizedHeight: 0.05,
    maxNormalizedHeight: 0.62,
    maxSlope: 0.12,
    avoidSpline: trail,
    avoidSplineRadius: FIRST_LEVEL_TRAIL_WIDTH * 0.48,
    avoidCircles: grassAvoidCircles,
  });
  spawnBenchmarkGrassLayer(engine, device, grassField, {
    label: `Forest Benchmark Grass (${densityLabel})`,
    baseColor: [0.36, 0.86, 0.42],
    tipColor: [0.76, 1, 0.66],
    windStrength: 0.1,
    windScale: 0.08,
    windSpeed: 0.9,
    ambientStrength: 0.54,
    translucency: 0.12,
    patchScale: 0.09,
  });

  const occupancy = new OccupancyMap(heightfield.width, heightfield.depth);
  const availableFiles = new Set(naturePackEntries.map((entry) => entry.file));

  for (const asset of NATURE_PROCEDURAL_TREE_ASSETS) {
    const template = await spawnProceduralTree(device, engine, {
      preset: asset.preset,
      seed: hashSeed(`${asset.preset}:${asset.noiseSeedOffset ?? 0}`),
      position: [0, 0, 0],
      label: `Forest Benchmark Template ${asset.preset}`,
    });

    const instances = generateScatterInstances(heightfield, {
      seed: hashSeed(asset.preset),
      density: asset.density * densityProfile.proceduralTreeDensityScale,
      minScale: asset.minScale,
      maxScale: asset.maxScale,
      allowedBiomes: asset.allowedBiomes,
      minNormalizedHeight: asset.minNormalizedHeight,
      maxNormalizedHeight: asset.maxNormalizedHeight,
      minSlope: asset.minSlope,
      maxSlope: asset.maxSlope,
      occupancy,
      occupationRadiusPixels: asset.occupationRadiusPixels,
      noiseScale: asset.noiseScale,
      noiseThreshold: asset.noiseThreshold,
      noiseSeedOffset: asset.noiseSeedOffset,
      avoidSpline: trail,
      avoidSplineRadius: FIRST_LEVEL_TRAIL_WIDTH * 0.9,
      avoidCircles: clearings,
    });

    for (const inst of instances) {
      cloneEntityHierarchy(engine, template.rootEntityId, inst.position[0], inst.position[1], inst.position[2], inst.scale, inst.rotationY);
    }
    destroyEntityHierarchy(engine, template.rootEntityId);
  }

  for (const asset of NATURE_SCATTER_ASSETS) {
    if (!availableFiles.has(asset.file)) continue;
    const sceneUrl = `${naturePackBaseUrl}/${encodeURIComponent(asset.file)}`;
    const loaded = await loadGltfScene(device, sceneUrl, engine);
    const rootId = loaded.entityIds[0];
    if (rootId === undefined) continue;

    const instances = generateScatterInstances(heightfield, {
      seed: hashSeed(asset.file),
      density: asset.density * densityProfile.scatterDensityScale,
      minScale: asset.minScale,
      maxScale: asset.maxScale,
      allowedBiomes: asset.allowedBiomes,
      minNormalizedHeight: asset.minNormalizedHeight,
      maxNormalizedHeight: asset.maxNormalizedHeight,
      minSlope: asset.minSlope,
      maxSlope: asset.maxSlope,
      occupancy,
      occupationRadiusPixels: asset.occupationRadiusPixels,
      noiseScale: asset.noiseScale,
      noiseThreshold: asset.noiseThreshold,
      noiseSeedOffset: asset.noiseSeedOffset,
      avoidSpline: /Tree|Pine|TwistedTree|Bush|Plant|Fern|Grass/i.test(asset.file) ? trail : undefined,
      avoidSplineRadius: /Grass|Plant|Fern/i.test(asset.file) ? FIRST_LEVEL_TRAIL_WIDTH * 0.55 : FIRST_LEVEL_TRAIL_WIDTH * 0.9,
      avoidCircles: /Tree|Pine|TwistedTree|Bush|Plant|Fern/i.test(asset.file) ? clearings : undefined,
    });

    for (const inst of instances) {
      cloneEntityHierarchy(engine, rootId, inst.position[0], inst.position[1], inst.position[2], inst.scale, inst.rotationY);
    }

    destroyEntityHierarchy(engine, rootId);
  }

  const bounds: SceneBounds = {
    min: [originX, heightfield.minHeight, originZ],
    max: [originX + 100 * cellSize, heightfield.maxHeight, originZ + 100 * cellSize],
    center: [originX + 50 * cellSize, (heightfield.minHeight + heightfield.maxHeight) * 0.5, originZ + 50 * cellSize],
    radius: Math.hypot(50 * cellSize, 50 * cellSize),
  };
  return { bounds };
}

function spawnBenchmarkGrassLayer(
  engine: Engine,
  device: GPUDevice,
  meshData: MeshData,
  options: GrassMaterialParams & { label: string },
): void {
  if (meshData.indices.length === 0) return;

  const grassMeshHandle = engine.registerMesh(GPUMesh.create(device, meshData));
  const grassMaterialHandle = nextBenchmarkGrassMaterialHandle++;
  forestBenchmarkGrassMaterials.set(grassMaterialHandle, engine.pbrRenderer.createGrassMaterial(options));

  const grassEntity = engine.world.spawn();
  grassEntity.add(LocalTransform, {
    px: 0, py: 0, pz: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
  });
  grassEntity.add(WorldMatrix, identityWorldMatrix());
  grassEntity.add(MeshRef, { handle: grassMeshHandle });
  grassEntity.add(GrassRef, { handle: grassMaterialHandle });
  grassEntity.add(Visible, { _tag: 1 });
  engine.setEntityLabel(grassEntity.id, options.label);
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return hash >>> 0;
}

function identityWorldMatrix() {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

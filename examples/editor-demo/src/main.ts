import { Engine } from '@engine/core';
import {
  AnimationPlayer,
  GrassRef,
  HierarchyDepth,
  LocalTransform,
  MaterialRef,
  MeshRef,
  Parent,
  SkeletonRef,
  Visible,
  WorldMatrix,
  createTransformSystem,
  type ComponentDef,
} from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import {
  buildSkeletonsAndClips,
  loadFbxScene,
  loadGltf,
  loadGltfScene,
  loadHDR,
  loadTexture,
  type SceneBounds,
} from '@engine/assets';
import { createAnimationSystem, type AnimationRegistries } from '@engine/animation';
import {
  GPUMesh,
  type GrassMaterial,
  type GrassMaterialParams,
  createPlane,
  createRenderSystem,
  createSphere,
  type MeshData,
} from '@engine/renderer-webgpu';
import { EmitterFlags, ParticleEmitter, ParticleRenderer, getEffectsRuntime } from '@engine/effects';
import { EngineAI } from '@engine/ai';
import { Editor, registerEditorCommands } from '@engine/editor';
import {
  BiomeId,
  createSeededRandom,
  generateScatterInstances,
  getWorldRegistry,
  OccupancyMap,
  sampleHeightWorld,
  sampleSplinePolyline,
  type SplinePoint,
} from '@engine/world';
import { userPackBaseUrl, userPackEntries } from 'virtual:user-pack-manifest';
import { naturePackBaseUrl, naturePackEntries } from 'virtual:nature-pack-manifest';
import { GameDemo, createGameHud, type GameQuestAnchors } from './game-demo.js';
import { buildStylizedGrassMesh } from './grass-field.js';

const BOOT_VIDEO_URL = new URL('../../../horizon_loader_blender.mp4', import.meta.url).href;
const FIRST_LEVEL_ID = 'first-nature-expedition';
const FIRST_LEVEL_NAME = 'First Nature Expedition';
const FIRST_LEVEL_SEED = 12345;
const FIRST_LEVEL_TRAIL_WIDTH = 8;
const demoGrassMaterials = new Map<number, GrassMaterial>();
let nextGrassMaterialHandle = 500_000;

interface DemoLevelResult {
  id: string;
  name: string;
  bounds: SceneBounds;
  collectibleRoute?: Array<[number, number, number]>;
  questAnchors?: Partial<GameQuestAnchors>;
}

interface DemoLevelDefinition {
  id: string;
  name: string;
  isAvailable: () => boolean;
  load: (
    engine: Engine,
    device: GPUDevice,
    animRegistries: AnimationRegistries,
    foxUrl: string,
  ) => Promise<DemoLevelResult | null>;
}

async function main() {
  await playBootIntro();

  const engine = new Engine();
  const hdrUrl = new URL('../../animation-demo/public/environment.hdr', import.meta.url).href;
  const foxUrl = new URL('../../animation-demo/public/models/Fox.glb', import.meta.url).href;

  let hdrData: { width: number; height: number; data: Float32Array } | undefined;
  try {
    hdrData = await loadHDR(hdrUrl);
  } catch (err) {
    console.warn('[EditorDemo] Failed to load HDRI, falling back to procedural sky', err);
  }

  await engine.initialize(
    { renderer: 'pbr' },
    {
      environment: {
        sunDirection: [0.42, 0.82, 0.18],
        sunIntensity: 50.0,
        cubemapSize: 512,
        hdrData,
        backgroundSource: 'procedural',
      },
      shadow: { resolution: 2048, frustumSize: 80 },
    },
  );

  const world = engine.world;
  const device = engine.gpu.device;
  const renderer = engine.pbrRenderer;
  renderer.enableProfiling();

  const animRegistries: AnimationRegistries = {
    skeletons: new Map(),
    clips: new Map(),
    jointBuffers: new Map(),
  };

  const transformSys = createTransformSystem(world);
  engine.scheduler.addSystem(Phase.TRANSFORM, () => transformSys.propagate(), 'transform');

  const animSys = createAnimationSystem(world, animRegistries);
  engine.scheduler.addSystem(Phase.ANIMATE, animSys.update, 'animation');

  const level = await loadPreferredDemoScene(engine, device, animRegistries, foxUrl);
  const sceneBounds = level.bounds;
  const effects = getEffectsRuntime(engine);
  const particleRenderer = new ParticleRenderer(device, engine.gpu.format);
  engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => effects.update(ctx.deltaTime), 'effects');
  spawnAmbientEmitter(engine, sceneBounds);

  const editor = Editor.create(engine);
  applyCameraPreset(editor, sceneBounds);

  const registry = getWorldRegistry(engine);
  editor.viewport.camera.setPlayModeGroundSampler((x, z) => registry.sampleGroundHeight(x, z));

  const gameDemo = new GameDemo(engine);
  gameDemo.spawn({
    bounds: sceneBounds,
    levelName: level.name,
    groundSampler: (x, z) => registry.sampleGroundHeight(x, z),
    interestPoints: level.collectibleRoute,
    questAnchors: level.questAnchors,
  });

  const gameHud = createGameHud();
  editor.layout.viewport.appendChild(gameHud.root);

  let wasPlayMode = false;
  engine.scheduler.addSystem(Phase.SIMULATE, () => {
    const playMode = editor.viewport.playMode;
    if (playMode) {
      if (!wasPlayMode) gameHud.show();
      const eye = editor.viewport.camera.getEye();
      const state = gameDemo.update(eye);
      gameHud.update(state);
    } else {
      if (wasPlayMode) gameHud.hide();
    }
    wasPlayMode = playMode;
  }, 'game-demo');

  const ai = EngineAI.attach(engine);
  registerEditorCommands(ai.router, editor);

  engine.scheduler.removeSystemByLabel(Phase.RENDER, 'pbr-render');
  const rs = createRenderSystem(world, {
    renderer,
    registries: {
      meshes: engine.meshes,
      materials: engine.materials,
      waterMaterials: engine.waterMaterials,
      grassMaterials: demoGrassMaterials,
    },
    getCamera: () => {
      const canvas = engine.canvas.element;
      const aspect = canvas.width / canvas.height;
      return {
        vp: editor.viewport.camera.getViewProjection(aspect),
        eye: editor.viewport.camera.getEye(),
      };
    },
    getLighting: () => engine.lighting,
    getSkinMatrices: (entityId) => animRegistries.jointBuffers.get(entityId),
    afterMainPass: (pass) => {
      const cameraAspect = engine.canvas.element.width / engine.canvas.element.height;
      const cameraVp = editor.viewport.camera.getViewProjection(cameraAspect);
      const buckets = effects.getBuckets();
      particleRenderer.render(pass, buckets.alpha, cameraVp, editor.viewport.camera.getRightVector(), editor.viewport.camera.getUpVector(), false);
      particleRenderer.render(pass, buckets.additive, cameraVp, editor.viewport.camera.getRightVector(), editor.viewport.camera.getUpVector(), true);
      editor.viewport.renderOverlays(pass);
    },
  });
  engine.scheduler.addSystem(Phase.RENDER, rs.render, 'editor-render');

  engine.start();

  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).editor = editor;
  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).engine = engine;
  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).ai = ai;
  (window as Window & { effects?: unknown }).effects = effects;
}

async function loadPreferredDemoScene(
  engine: Engine,
  device: GPUDevice,
  animRegistries: AnimationRegistries,
  foxUrl: string,
): Promise<DemoLevelResult> {
  const levels: DemoLevelDefinition[] = [
    {
      id: FIRST_LEVEL_ID,
      name: FIRST_LEVEL_NAME,
      isAvailable: () => Boolean(naturePackBaseUrl && naturePackEntries.length > 0),
      load: async (levelEngine, levelDevice) => loadNaturePackDemo(levelEngine, levelDevice),
    },
    {
      id: 'construction-showcase',
      name: 'Construction Showcase',
      isAvailable: () => Boolean(userPackBaseUrl && userPackEntries.length > 0),
      load: async (levelEngine, levelDevice) => loadConstructionPackDemo(levelEngine, levelDevice),
    },
    {
      id: 'fox-fallback',
      name: 'Fox Fallback',
      isAvailable: () => true,
      load: async (levelEngine, levelDevice, levelAnimRegistries, levelFoxUrl) => ({
        id: 'fox-fallback',
        name: 'Fox Fallback',
        bounds: await loadFallbackAnimationDemo(levelEngine, levelDevice, levelAnimRegistries, levelFoxUrl),
      }),
    },
  ];

  for (const level of levels) {
    if (!level.isAvailable()) continue;
    const loaded = await level.load(engine, device, animRegistries, foxUrl);
    if (loaded) return loaded;
  }
  return {
    id: 'fox-fallback',
    name: 'Fox Fallback',
    bounds: await loadFallbackAnimationDemo(engine, device, animRegistries, foxUrl),
  };
}

/** Curated nature models with biome-specific, height-band, and slope-aware placement. */
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
  // Trees: Forest + Plains (grassland), relaxed slope for rolling terrain
  { file: 'CommonTree_1.gltf', density: 0.08, minScale: 0.85, maxScale: 1.35, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.8, maxSlope: 0.12, occupationRadiusPixels: 6, noiseScale: 0.08, noiseThreshold: 0.54, noiseSeedOffset: 11 },
  { file: 'CommonTree_2.gltf', density: 0.06, minScale: 0.9, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.8, maxSlope: 0.12, occupationRadiusPixels: 6, noiseScale: 0.08, noiseThreshold: 0.56, noiseSeedOffset: 21 },
  { file: 'Pine_1.gltf', density: 0.07, minScale: 0.8, maxScale: 1.25, allowedBiomes: [BiomeId.Forest, BiomeId.Plains, BiomeId.Alpine], minNormalizedHeight: 0.15, maxNormalizedHeight: 0.9, maxSlope: 0.14, occupationRadiusPixels: 6, noiseScale: 0.07, noiseThreshold: 0.52, noiseSeedOffset: 31 },
  { file: 'Pine_2.gltf', density: 0.05, minScale: 0.85, maxScale: 1.15, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.75, maxSlope: 0.12, occupationRadiusPixels: 6, noiseScale: 0.07, noiseThreshold: 0.55, noiseSeedOffset: 41 },
  { file: 'TwistedTree_1.gltf', density: 0.008, minScale: 0.9, maxScale: 1.1, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.1, maxNormalizedHeight: 0.7, maxSlope: 0.1, occupationRadiusPixels: 5, noiseScale: 0.09, noiseThreshold: 0.62, noiseSeedOffset: 51 },
  { file: 'CommonTree_3.gltf', density: 0.05, minScale: 0.85, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.75, maxSlope: 0.12, occupationRadiusPixels: 6, noiseScale: 0.08, noiseThreshold: 0.55, noiseSeedOffset: 61 },
  { file: 'Pine_3.gltf', density: 0.04, minScale: 0.8, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Alpine], minNormalizedHeight: 0.2, maxNormalizedHeight: 0.9, maxSlope: 0.15, occupationRadiusPixels: 5, noiseScale: 0.07, noiseThreshold: 0.53, noiseSeedOffset: 71 },
  // Rocks: higher elevation, rocky/snowy
  { file: 'Rock_Medium_1.gltf', density: 0.02, minScale: 0.6, maxScale: 1.4, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.55, maxNormalizedHeight: 0.95, maxSlope: 0.4, occupationRadiusPixels: 4, noiseScale: 0.05, noiseThreshold: 0.5, noiseSeedOffset: 81 },
  { file: 'Rock_Medium_2.gltf', density: 0.015, minScale: 0.5, maxScale: 1.2, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.5, maxNormalizedHeight: 0.9, maxSlope: 0.45, occupationRadiusPixels: 4, noiseScale: 0.05, noiseThreshold: 0.53, noiseSeedOffset: 91 },
  // Bushes: plains, low elevation, above water
  { file: 'Bush_Common.gltf', density: 0.05, minScale: 0.65, maxScale: 1.15, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.46, maxSlope: 0.06, occupationRadiusPixels: 3, noiseScale: 0.09, noiseThreshold: 0.56, noiseSeedOffset: 101 },
  { file: 'Plant_1_Big.gltf', density: 0.04, minScale: 0.45, maxScale: 0.85, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.06, maxNormalizedHeight: 0.52, maxSlope: 0.07, occupationRadiusPixels: 1, noiseScale: 0.08, noiseThreshold: 0.5, noiseSeedOffset: 111 },
  { file: 'Fern_1.gltf', density: 0.06, minScale: 0.45, maxScale: 0.9, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.58, maxSlope: 0.08, occupationRadiusPixels: 1, noiseScale: 0.09, noiseThreshold: 0.54, noiseSeedOffset: 100 },
  // Grass: tighter meadow-style patches rather than isolated blades across the full terrain.
  { file: 'Grass_Common_Tall.gltf', density: 0.72, minScale: 0.2, maxScale: 0.42, allowedBiomes: [BiomeId.Plains], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.46, maxSlope: 0.06, occupationRadiusPixels: 0, noiseScale: 0.065, noiseThreshold: 0.58, noiseSeedOffset: 200 },
];

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

function buildFirstLevelCollectibleRoute(trail: SplinePoint[], clearings: LayoutCircle[]): Array<[number, number, number]> {
  const samples = sampleSplinePolyline(trail, 14);
  const route: Array<[number, number, number]> = [];
  const pushSample = (index: number, lateralOffset = 0) => {
    const sample = samples[index] ?? samples[samples.length - 1]!;
    const tangent = sample.tangent;
    const nx = -tangent[2];
    const nz = tangent[0];
    route.push([
      sample.position[0] + nx * lateralOffset,
      0,
      sample.position[2] + nz * lateralOffset,
    ]);
  };

  pushSample(1, -2);
  pushSample(3, 2);
  route.push([clearings[0]!.centerX, 0, clearings[0]!.centerZ]);
  pushSample(6, -1.5);
  route.push([clearings[1]!.centerX, 0, clearings[1]!.centerZ]);
  pushSample(9, 2.5);
  pushSample(11, -2);
  route.push([clearings[2]!.centerX, 0, clearings[2]!.centerZ]);
  return route;
}

function buildFirstLevelQuestAnchors(trail: SplinePoint[], clearings: LayoutCircle[]): GameQuestAnchors {
  const samples = sampleSplinePolyline(trail, 16);
  const pick = (index: number) => samples[Math.min(samples.length - 1, Math.max(0, index))]!;
  return {
    trailhead: [pick(0).position[0], 0, pick(0).position[2]],
    camp: [clearings[0]!.centerX, 0, clearings[0]!.centerZ],
    shrine: [clearings[1]!.centerX, 0, clearings[1]!.centerZ],
    spring: [clearings[2]!.centerX, 0, clearings[2]!.centerZ],
    overlook: [pick(samples.length - 2).position[0], 0, pick(samples.length - 2).position[2]],
  };
}

function shouldKeepTrailOpen(file: string): boolean {
  return /Tree|Pine|TwistedTree|Bush|Plant|Fern|Grass/i.test(file);
}

function getTrailAvoidRadius(file: string): number {
  if (/Grass|Plant|Fern/i.test(file)) return FIRST_LEVEL_TRAIL_WIDTH * 0.55;
  return FIRST_LEVEL_TRAIL_WIDTH * 0.9;
}

function shouldKeepClearingsOpen(file: string): boolean {
  return /Tree|Pine|TwistedTree|Bush|Plant|Fern/i.test(file);
}

async function loadNaturePackDemo(
  engine: Engine,
  device: GPUDevice,
): Promise<DemoLevelResult | null> {
  engine.lighting = {
    direction: [-0.28, -0.92, -0.24],
    color: [1.0, 0.985, 0.96],
    intensity: 4.9,
    ambient: [0.03, 0.04, 0.045],
    envIntensity: 1.05,
  };

  const registry = getWorldRegistry(engine);
  const terrainSize = 200;
  const cellSize = 2;
  const originX = -terrainSize * 0.5;
  const originZ = -terrainSize * 0.5;
  const firstLevelTrail = buildFirstLevelTrail(originX, originZ, terrainSize, FIRST_LEVEL_SEED);
  const firstLevelClearings = buildFirstLevelClearings(firstLevelTrail);
  const collectibleRoute = buildFirstLevelCollectibleRoute(firstLevelTrail, firstLevelClearings);
  const questAnchors = buildFirstLevelQuestAnchors(firstLevelTrail, firstLevelClearings);
  const terrainWidth = (100 - 1) * cellSize;
  const terrainDepth = (100 - 1) * cellSize;
  const terrainCenterX = originX + terrainWidth * 0.5;
  const terrainCenterZ = originZ + terrainDepth * 0.5;
  const grassDiffuseUrl = new URL('../../pbr-demo/public/textures/grass_diffuse.jpg', import.meta.url).href;
  const grassNormalUrl = new URL('../../pbr-demo/public/textures/grass_normal.jpg', import.meta.url).href;
  const grassRoughUrl = new URL('../../pbr-demo/public/textures/grass_rough.jpg', import.meta.url).href;
  let terrainMat: { handle: number };
  try {
    const [albedoTex, normalTex, roughTex] = await Promise.all([
      loadTexture(device, grassDiffuseUrl, { sRGB: true }),
      loadTexture(device, grassNormalUrl),
      loadTexture(device, grassRoughUrl),
    ]);
    terrainMat = engine.createMaterial({
      albedo: [0.72, 0.8, 0.66, 1],
      roughness: 0.94,
      metallic: 0,
      albedoTexture: albedoTex,
      normalTexture: normalTex,
      mrTexture: roughTex,
    });
  } catch (err) {
    console.warn('[EditorDemo] Terrain textures failed, using flat material', err);
    terrainMat = engine.createMaterial({
      albedo: [0.2, 0.26, 0.18, 1],
      roughness: 0.92,
      metallic: 0,
    });
  }

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
    waterOffsetX: questAnchors.spring[0] - terrainCenterX,
    waterOffsetZ: questAnchors.spring[2] - terrainCenterZ,
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
    roadSpline: firstLevelTrail,
    roadWidth: FIRST_LEVEL_TRAIL_WIDTH * 0.82,
    uvScale: 10,
    uvOffset: [0.37, 0.61],
    uvRotation: 0.4,
  });
  engine.setEntityLabel(terrainResult.entityId, 'Nature Terrain');
  const trailSpline = registry.spawnSpline(firstLevelTrail, {
    closed: false,
    width: FIRST_LEVEL_TRAIL_WIDTH * 0.7,
  });
  engine.setEntityLabel(trailSpline.entityId, 'First Level Trail');

  const terrainRec = registry.terrains.get(terrainResult.entityId);
  if (!terrainRec) return null;
  const heightfield = terrainRec.heightfield;
  for (const clearing of firstLevelClearings) {
    registry.paintBiomeCircle(terrainResult.entityId, clearing.centerX, clearing.centerZ, clearing.radius + 5, BiomeId.Plains);
  }
  registry.paintBiomeCircle(terrainResult.entityId, questAnchors.spring[0], questAnchors.spring[2], 10, BiomeId.River);

  const grassAvoidCircles = firstLevelClearings.map((clearing) => ({
    centerX: clearing.centerX,
    centerZ: clearing.centerZ,
    radius: clearing.radius * 0.9,
  }));

  const grassUnderCanopy = buildStylizedGrassMesh(heightfield, {
    seed: FIRST_LEVEL_SEED ^ 0x9e3779b9,
    density: 1,
    bladesPerCell: 54,
    minBladeHeight: 0.12,
    maxBladeHeight: 0.24,
    bladeWidth: 0.16,
    profile: 'coverage',
    clusterRadiusMultiplier: 0.58,
    allowedBiomes: [BiomeId.Plains, BiomeId.Forest],
    minNormalizedHeight: 0.05,
    maxNormalizedHeight: 0.62,
    maxSlope: 0.12,
    avoidSpline: firstLevelTrail,
    avoidSplineRadius: FIRST_LEVEL_TRAIL_WIDTH * 0.58,
    avoidCircles: grassAvoidCircles,
  });
  spawnGrassLayer(engine, device, grassUnderCanopy, {
    label: 'Grass Under Canopy',
    baseColor: [0.24, 0.48, 0.16],
    tipColor: [0.58, 0.76, 0.3],
    windStrength: 0.06,
    windScale: 0.05,
    windSpeed: 0.55,
    ambientStrength: 0.62,
    translucency: 0.08,
    patchScale: 0.055,
  });

  const grassUpperField = buildStylizedGrassMesh(heightfield, {
    seed: FIRST_LEVEL_SEED ^ 0x3c6ef372,
    density: 0.98,
    bladesPerCell: 14,
    minBladeHeight: 0.42,
    maxBladeHeight: 0.88,
    bladeWidth: 0.075,
    clusterRadiusMultiplier: 0.48,
    allowedBiomes: [BiomeId.Plains, BiomeId.Forest],
    minNormalizedHeight: 0.05,
    maxNormalizedHeight: 0.62,
    maxSlope: 0.11,
    avoidSpline: firstLevelTrail,
    avoidSplineRadius: FIRST_LEVEL_TRAIL_WIDTH * 0.62,
    avoidCircles: grassAvoidCircles,
  });
  spawnGrassLayer(engine, device, grassUpperField, {
    label: 'Stylized Grass Field',
    baseColor: [0.2, 0.42, 0.15],
    tipColor: [0.62, 0.8, 0.34],
    windStrength: 0.16,
    windScale: 0.06,
    windSpeed: 0.82,
    ambientStrength: 0.5,
    translucency: 0.16,
    patchScale: 0.07,
  });

  const occupancy = new OccupancyMap(heightfield.width, heightfield.depth);

  const aggregate = createBoundsAccumulator();
  mergeBounds(aggregate, {
    min: [originX, heightfield.minHeight, originZ],
    max: [originX + 100 * cellSize, heightfield.maxHeight, originZ + 100 * cellSize],
    center: [originX + 50 * cellSize, (heightfield.minHeight + heightfield.maxHeight) * 0.5, originZ + 50 * cellSize],
    radius: Math.hypot(50 * cellSize, 50 * cellSize),
  });

  const availableFiles = new Set(naturePackEntries.map((e) => e.file));
  let placedCount = 0;

  for (const asset of NATURE_SCATTER_ASSETS) {
    if (!availableFiles.has(asset.file)) continue;

    const sceneUrl = `${naturePackBaseUrl}/${encodeURIComponent(asset.file)}`;
    let loaded: Awaited<ReturnType<typeof loadGltfScene>>;
    try {
      loaded = await loadGltfScene(device, sceneUrl, engine);
    } catch (err) {
      console.warn('[EditorDemo] Failed to load nature asset', asset.file, err);
      continue;
    }

    const rootId = loaded.entityIds[0];
    if (rootId === undefined) continue;

    const instances = generateScatterInstances(heightfield, {
      seed: hashSeed(asset.file),
      density: asset.density,
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
      avoidSpline: shouldKeepTrailOpen(asset.file) ? firstLevelTrail : undefined,
      avoidSplineRadius: shouldKeepTrailOpen(asset.file) ? getTrailAvoidRadius(asset.file) : FIRST_LEVEL_TRAIL_WIDTH * 0.35,
      avoidCircles: shouldKeepClearingsOpen(asset.file) ? firstLevelClearings : undefined,
    });

    for (const inst of instances) {
      cloneEntityHierarchy(engine, rootId, inst.position[0], inst.position[1], inst.position[2], inst.scale, inst.rotationY);
      placedCount++;
    }

    destroyEntityHierarchy(engine, rootId);
  }

  if (placedCount === 0) return null;

  const bounds = finalizeAggregateBounds(aggregate);
  if (!bounds) return null;
  return {
    id: FIRST_LEVEL_ID,
    name: FIRST_LEVEL_NAME,
    bounds,
    collectibleRoute,
    questAnchors,
  };
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h >>> 0;
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
  const copyComp = (src: number, dst: number, comp: ComponentDef) => {
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
    for (const c of getChildren(world, id)) collect(c);
  }
  collect(rootId);
  for (const id of ids.reverse()) {
    if (world.has(id)) world.destroy(id);
  }
}

async function loadConstructionPackDemo(
  engine: Engine,
  device: GPUDevice,
): Promise<DemoLevelResult | null> {
  engine.lighting = {
    direction: [-0.35, -0.9, -0.2],
    color: [1.0, 0.98, 0.95],
    intensity: 4.4,
    ambient: [0.03, 0.03, 0.04],
    envIntensity: 1.1,
  };

  const registry = getWorldRegistry(engine);
  const terrainSize = 140;
  const cellSize = 2;
  const originX = -terrainSize * 0.5;
  const originZ = -terrainSize * 0.5;

  const roadSpline: SplinePoint[] = [
    { position: [originX + 20, 0, originZ + 30] },
    { position: [originX + 50, 0, originZ + 25] },
    { position: [originX + 75, 0, originZ + 45] },
    { position: [originX + 90, 0, originZ + 70] },
    { position: [originX + 70, 0, originZ + 100] },
    { position: [originX + 40, 0, originZ + 95] },
    { position: [originX + 15, 0, originZ + 75] },
    { position: [originX + 20, 0, originZ + 50] },
  ];

  const terrainMat = engine.createMaterial({
    albedo: [0.28, 0.34, 0.22, 1],
    roughness: 0.92,
    metallic: 0,
  });

  const terrainResult = registry.spawnTerrain({
    seed: 42,
    width: 72,
    depth: 72,
    cellSize,
    originX,
    originZ,
    baseHeight: 0,
    heightScale: 14,
    materialHandle: terrainMat.handle,
    roadSpline,
    roadWidth: 6,
  });
  engine.setEntityLabel(terrainResult.entityId, 'Procedural Terrain');

  const splineResult = registry.spawnSpline(roadSpline, {
    closed: true,
    width: 5,
    kind: 1,
  });
  engine.setEntityLabel(splineResult.entityId, 'Road Spline');

  const aggregate = createBoundsAccumulator();
  let loadedScenes = 0;
  let layoutCursorX = 0;
  let layoutCursorZ = 0;
  let currentRowDepth = 0;
  const maxRowWidth = 180;
  const gridOriginX = originX + 25;
  const gridOriginZ = originZ + 25;

  for (const entry of userPackEntries) {
    const sceneUrl = buildPackAssetUrl(userPackBaseUrl!, entry.dir, entry.file);
    try {
      const loaded = await loadFbxScene(device, sceneUrl, engine, {
        groupLabel: humanizeAssetLabel(entry.dir, entry.file),
      });
      if (loaded.entityIds.length > 0) {
        loadedScenes++;
      }
      if (loaded.bounds) {
        const footprintWidth = Math.max(6, loaded.bounds.max[0] - loaded.bounds.min[0]);
        const footprintDepth = Math.max(6, loaded.bounds.max[2] - loaded.bounds.min[2]);
        const margin = Math.max(3, Math.min(footprintWidth, footprintDepth) * 0.25);

        if (layoutCursorX > 0 && layoutCursorX + footprintWidth > maxRowWidth) {
          layoutCursorX = 0;
          layoutCursorZ += currentRowDepth + margin;
          currentRowDepth = 0;
        }

        const slotCenterX = gridOriginX + layoutCursorX + footprintWidth * 0.5;
        const slotCenterZ = gridOriginZ + layoutCursorZ + footprintDepth * 0.5;
        const offsetX = slotCenterX - loaded.bounds.center[0];
        const offsetY = -loaded.bounds.min[1];
        const offsetZ = slotCenterZ - loaded.bounds.center[2];
        const rootEntityId = loaded.entityIds[0] ?? 0;
        applyEntityOffset(engine, rootEntityId, offsetX, offsetY, offsetZ);

        mergeBounds(aggregate, offsetBounds(loaded.bounds, offsetX, offsetY, offsetZ));
        layoutCursorX += footprintWidth + margin;
        currentRowDepth = Math.max(currentRowDepth, footprintDepth);
      }
    } catch (err) {
      console.warn('[EditorDemo] Failed to load user FBX asset', entry.file, err);
    }
  }

  const bounds = finalizeAggregateBounds(aggregate);
  if (loadedScenes === 0 || !bounds) {
    return null;
  }

  const terrainRec = registry.terrains.get(terrainResult.entityId);
  const groundY = terrainRec ? terrainRec.heightfield.minHeight - 0.5 : bounds.min[1] - 0.5;
  spawnGround(engine, 220, bounds.center[0], bounds.center[2], groundY, {
    albedo: [0.22, 0.26, 0.2, 1],
    roughness: 0.95,
    metallic: 0.0,
  });

  return {
    id: 'construction-showcase',
    name: 'Construction Showcase',
    bounds,
  };
}

async function loadFallbackAnimationDemo(
  engine: Engine,
  device: GPUDevice,
  animRegistries: AnimationRegistries,
  foxUrl: string,
): Promise<SceneBounds> {
  engine.lighting = {
    direction: [-0.4, -0.7, -0.5],
    color: [1.0, 0.97, 0.9],
    intensity: 3.5,
    ambient: [0.02, 0.02, 0.03],
    envIntensity: 1.0,
  };

  const world = engine.world;
  const gltfScene = await loadGltf(foxUrl);
  const { skeletons, clips } = buildSkeletonsAndClips(gltfScene);
  for (let i = 0; i < skeletons.length; i++) animRegistries.skeletons.set(i, skeletons[i]!);
  for (let i = 0; i < clips.length; i++) animRegistries.clips.set(i, clips[i]!);

  const gltfMatHandles: number[] = [];
  for (const mat of gltfScene.materials) {
    const params: {
      albedo: [number, number, number, number];
      metallic: number;
      roughness: number;
      emissive: [number, number, number];
      albedoTexture?: GPUTexture;
      normalTexture?: GPUTexture;
      mrTexture?: GPUTexture;
    } = {
      albedo: mat.albedo,
      metallic: mat.metallic,
      roughness: mat.roughness,
      emissive: mat.emissive,
    };
    if (mat.albedoTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.albedoTextureIndex, true);
      if (tex) params.albedoTexture = tex;
    }
    if (mat.normalTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.normalTextureIndex, false);
      if (tex) params.normalTexture = tex;
    }
    if (mat.mrTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.mrTextureIndex, false);
      if (tex) params.mrTexture = tex;
    }
    const { handle } = engine.createMaterial(params);
    gltfMatHandles.push(handle);
  }

  const gltfMeshHandles: number[][] = [];
  for (const primGroup of gltfScene.meshes) {
    const handles: number[] = [];
    for (const prim of primGroup) {
      const meshData: MeshData = {
        positions: prim.positions,
        normals: prim.normals,
        uvs: prim.uvs,
        tangents: prim.tangents,
        indices: prim.indices,
        joints: prim.joints,
        weights: prim.weights,
      };
      handles.push(engine.registerMesh(GPUMesh.create(device, meshData)));
    }
    gltfMeshHandles.push(handles);
  }

  const modelScale = 0.02;
  const nodeEntities = new Map<number, number>();
  for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
    const node = gltfScene.nodes[ni]!;
    const entity = world.spawn();
    nodeEntities.set(ni, entity.id);
    engine.setEntityLabel(entity.id, node.name.trim() || `Fox Node ${ni}`);

    const isRoot = gltfScene.rootNodes.includes(ni);
    const scaleMul = isRoot ? modelScale : 1;
    const [rotX, rotY, rotZ] = quaternionToEulerXYZ(node.rotation);

    entity.add(LocalTransform, {
      px: node.translation[0] * scaleMul,
      py: node.translation[1] * scaleMul,
      pz: node.translation[2] * scaleMul,
      rotX,
      rotY,
      rotZ,
      scaleX: node.scale[0] * scaleMul,
      scaleY: node.scale[1] * scaleMul,
      scaleZ: node.scale[2] * scaleMul,
    });
    entity.add(WorldMatrix, identityWorldMatrix());

    if (node.meshIndex >= 0 && gltfMeshHandles[node.meshIndex]?.length) {
      const prim = gltfScene.meshes[node.meshIndex]?.[0];
      if (prim) {
        entity.add(MeshRef, { handle: gltfMeshHandles[node.meshIndex]![0]! });
        entity.add(MaterialRef, {
          handle: gltfMatHandles[prim.materialIndex] ?? gltfMatHandles[0] ?? 1,
        });
        entity.add(Visible, { _tag: 1 });
      }
    }

    if (node.skinIndex >= 0) {
      entity.add(SkeletonRef, { handle: node.skinIndex });
      entity.add(AnimationPlayer, {
        clipHandle: clips.length > 1 ? 1 : 0,
        time: 0,
        speed: 1,
        flags: 3,
      });
    }
  }

  for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
    const node = gltfScene.nodes[ni]!;
    const parentId = nodeEntities.get(ni)!;
    for (const childIdx of node.children) {
      const childId = nodeEntities.get(childIdx);
      if (childId !== undefined) {
        world.addComponent(childId, Parent, { entity: parentId });
      }
    }
  }

  spawnGround(engine, 80, 0, 0, 0, {
    albedo: [0.15, 0.15, 0.17, 1],
    roughness: 0.25,
    metallic: 0.0,
  });

  const sphereHandle = engine.registerMesh(GPUMesh.create(device, createSphere(0.5, 32, 16)));
  const sphereMaterials = [
    { albedo: [0.95, 0.64, 0.54, 1] as [number, number, number, number], roughness: 0.1, metallic: 1.0 },
    { albedo: [0.1, 0.5, 0.9, 1] as [number, number, number, number], roughness: 0.7, metallic: 0.0 },
    { albedo: [0.9, 0.9, 0.2, 1] as [number, number, number, number], roughness: 0.3, metallic: 0.8 },
  ];
  for (let i = 0; i < sphereMaterials.length; i++) {
    const { handle } = engine.createMaterial(sphereMaterials[i]!);
    const e = world.spawn();
    e.add(LocalTransform, {
      px: -3 + i * 3,
      py: 0.5,
      pz: 4,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    e.add(WorldMatrix, identityWorldMatrix());
    e.add(MeshRef, { handle: sphereHandle });
    e.add(MaterialRef, { handle });
    e.add(Visible, { _tag: 1 });
    engine.setEntityLabel(e.id, ['Copper Sphere', 'Blue Sphere', 'Gold Sphere'][i] ?? `Sphere ${i + 1}`);
  }

  return {
    min: [-40, 0, -40],
    max: [40, 15, 40],
    center: [0, 2, 0],
    radius: 28,
  };
}

function spawnGround(
  engine: Engine,
  size: number,
  centerX: number,
  centerZ: number,
  y: number,
  material: {
    albedo: [number, number, number, number];
    roughness: number;
    metallic: number;
  },
): void {
  const groundHandle = engine.registerMesh(GPUMesh.create(engine.gpu.device, createPlane(size, size, 1, 1)));
  const { handle: groundMatHandle } = engine.createMaterial(material);
  const ground = engine.world.spawn();
  ground.add(LocalTransform, {
    px: centerX,
    py: y,
    pz: centerZ,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  });
  ground.add(WorldMatrix, identityWorldMatrix());
  ground.add(MeshRef, { handle: groundHandle });
  ground.add(MaterialRef, { handle: groundMatHandle });
  ground.add(Visible, { _tag: 1 });
  engine.setEntityLabel(ground.id, 'Ground Plane');
}

function spawnAmbientEmitter(engine: Engine, bounds: SceneBounds): void {
  const emitter = engine.world.spawn();
  emitter.add(LocalTransform, {
    px: bounds.center[0],
    py: Math.max(bounds.min[1] + 1.2, bounds.center[1] + 0.6),
    pz: bounds.center[2],
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  });
  emitter.add(WorldMatrix, identityWorldMatrix());
  emitter.add(ParticleEmitter, {
    rate: 8,
    lifetime: 3,
    speed: 0.4,
    spread: 0.22,
    size: Math.max(0.08, bounds.radius * 0.006),
    maxParticles: 256,
    colorR: 1,
    colorG: 0.76,
    colorB: 0.25,
    colorA: 0.35,
    flags: EmitterFlags.Playing | EmitterFlags.Looping | EmitterFlags.Additive,
    splineEntity: 0,
    terrainEntity: 0,
    biomeFilter: 0xffffffff,
  });
  engine.setEntityLabel(emitter.id, 'Ambient Sparks');
}

function applyEntityOffset(engine: Engine, entityId: number, dx: number, dy: number, dz: number): void {
  if (entityId === 0 || !engine.world.has(entityId) || !engine.world.hasComponent(entityId, LocalTransform)) {
    return;
  }
  engine.world.setField(entityId, LocalTransform, 'px', dx);
  engine.world.setField(entityId, LocalTransform, 'py', dy);
  engine.world.setField(entityId, LocalTransform, 'pz', dz);
}

function offsetBounds(bounds: SceneBounds, dx: number, dy: number, dz: number): SceneBounds {
  return {
    min: [bounds.min[0] + dx, bounds.min[1] + dy, bounds.min[2] + dz],
    max: [bounds.max[0] + dx, bounds.max[1] + dy, bounds.max[2] + dz],
    center: [bounds.center[0] + dx, bounds.center[1] + dy, bounds.center[2] + dz],
    radius: bounds.radius,
  };
}

function humanizeAssetLabel(dir: string, file: string): string {
  const source = dir.trim().length > 0 ? dir : file.replace(/\.[^./?]+$/, '');
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function playBootIntro(): Promise<void> {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
    zIndex: '999999',
  } satisfies Partial<CSSStyleDeclaration>);

  const video = document.createElement('video');
  video.src = BOOT_VIDEO_URL;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  Object.assign(video.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    background: '#000',
  } satisfies Partial<CSSStyleDeclaration>);

  overlay.appendChild(video);
  document.body.appendChild(overlay);

  await new Promise<void>((resolve) => {
    const finish = () => {
      video.pause();
      overlay.remove();
      resolve();
    };

    video.addEventListener('ended', finish, { once: true });
    video.addEventListener('error', finish, { once: true });

    void video.play().catch(() => finish());
  });
}

function applyCameraPreset(editor: Editor, bounds: SceneBounds): void {
  const targetY = Math.max(bounds.center[1] + 1.5, bounds.min[1] + 1.5);
  editor.viewport.camera.target = [bounds.center[0], targetY, bounds.center[2]];
  editor.viewport.camera.distance = Math.max(12, bounds.radius * 0.65);
  editor.viewport.camera.far = Math.max(5000, bounds.radius * 12);
  editor.viewport.camera.yaw = Math.PI * 0.82;
  editor.viewport.camera.pitch = -0.32;
}

function buildPackAssetUrl(baseUrl: string, ...segments: string[]): string {
  return `${baseUrl}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function createBoundsAccumulator() {
  return {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
}

function mergeBounds(
  aggregate: { min: [number, number, number]; max: [number, number, number] },
  bounds: SceneBounds,
): void {
  aggregate.min[0] = Math.min(aggregate.min[0], bounds.min[0]);
  aggregate.min[1] = Math.min(aggregate.min[1], bounds.min[1]);
  aggregate.min[2] = Math.min(aggregate.min[2], bounds.min[2]);
  aggregate.max[0] = Math.max(aggregate.max[0], bounds.max[0]);
  aggregate.max[1] = Math.max(aggregate.max[1], bounds.max[1]);
  aggregate.max[2] = Math.max(aggregate.max[2], bounds.max[2]);
}

function finalizeAggregateBounds(
  aggregate: { min: [number, number, number]; max: [number, number, number] },
): SceneBounds | null {
  if (!Number.isFinite(aggregate.min[0]) || !Number.isFinite(aggregate.max[0])) return null;
  const center: [number, number, number] = [
    (aggregate.min[0] + aggregate.max[0]) * 0.5,
    (aggregate.min[1] + aggregate.max[1]) * 0.5,
    (aggregate.min[2] + aggregate.max[2]) * 0.5,
  ];
  const dx = aggregate.max[0] - center[0];
  const dy = aggregate.max[1] - center[1];
  const dz = aggregate.max[2] - center[2];
  return {
    min: aggregate.min,
    max: aggregate.max,
    center,
    radius: Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz)),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quaternionToEulerXYZ(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const rotX = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const rotY = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const rotZ = Math.atan2(sinyCosp, cosyCosp);
  return [rotX, rotY, rotZ];
}

function identityWorldMatrix() {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

function spawnGrassLayer(
  engine: Engine,
  device: GPUDevice,
  meshData: MeshData,
  options: GrassMaterialParams & { label: string },
): void {
  if (meshData.indices.length === 0) return;

  const grassMeshHandle = engine.registerMesh(GPUMesh.create(device, meshData));
  const grassMaterialHandle = nextGrassMaterialHandle++;
  demoGrassMaterials.set(grassMaterialHandle, engine.pbrRenderer.createGrassMaterial(options));

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

async function loadEmbeddedTexture(
  device: GPUDevice,
  scene: { textures?: Array<{ data: Uint8Array; mimeType: string }> },
  textureIndex: number,
  srgb: boolean,
): Promise<GPUTexture | null> {
  try {
    const texData = scene.textures?.[textureIndex];
    if (!texData || texData.data.length === 0) return null;
    const blob = new Blob([texData.data.buffer as ArrayBuffer], { type: texData.mimeType });
    const bitmap = await createImageBitmap(blob);
    const format: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    return texture;
  } catch (err) {
    console.warn('[EditorDemo] Failed to load embedded texture', textureIndex, err);
    return null;
  }
}

main().catch(console.error);

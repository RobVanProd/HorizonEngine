export {
  GeneratorSeed,
  ChunkCoord,
  ChunkState,
  TerrainChunk,
  HeightfieldMeta,
  BiomeRegion,
  ScatterRule,
  StableAssetRef,
  SplinePath,
  SplineControlPoint,
  SplineKind,
  ChunkLoadState,
} from './components.js';
export { createSeededRandom, fbm2D, hash2D, valueNoise2D, type SeededRandom } from './random.js';
export {
  createSplineEntities,
  readSplinePoints,
  sampleSpline,
  sampleSplinePolyline,
  estimateSplineLength,
  type SplinePoint,
  type SplineSample,
  type CreateSplineOptions,
} from './spline.js';
export {
  generateHeightfield,
  buildTerrainMeshData,
  generateScatterInstances,
  sampleHeight,
  sampleHeightWorld,
  sampleNormal,
  sampleSlopeAt,
  BiomeId,
  type Heightfield,
  type ScatterInstance,
  type ScatterOptions,
  type TerrainGenerationOptions,
} from './terrain.js';
export {
  WorldChunkController,
  type ChunkLifecycleContext,
  type ChunkLifecycleHooks,
} from './chunk-controller.js';
export {
  WorldRegistry,
  getWorldRegistry,
  type TerrainSpawnOptions,
  type SplineSpawnOptions,
  type ScatterSpawnOptions,
  type RegionSample,
} from './runtime.js';

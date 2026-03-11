import { defineComponent } from '@engine/ecs';
import { FieldType } from '@engine/memory';

export const enum SplineKind {
  Generic = 0,
  Road = 1,
  River = 2,
  Fence = 3,
  CameraRail = 4,
}

export const enum ChunkLoadState {
  Unloaded = 0,
  Loading = 1,
  Active = 2,
  CoolingDown = 3,
}

export const GeneratorSeed = defineComponent('GeneratorSeed', {
  value: FieldType.U32,
});

export const ChunkCoord = defineComponent('ChunkCoord', {
  cx: FieldType.I32,
  cz: FieldType.I32,
});

export const ChunkState = defineComponent('ChunkState', {
  state: FieldType.U8,
  revision: FieldType.U32,
});

export const TerrainChunk = defineComponent('TerrainChunk', {
  size: FieldType.F32,
  resolution: FieldType.U32,
  heightScale: FieldType.F32,
  baseHeight: FieldType.F32,
  minHeight: FieldType.F32,
  maxHeight: FieldType.F32,
});

export const HeightfieldMeta = defineComponent('HeightfieldMeta', {
  originX: FieldType.F32,
  originZ: FieldType.F32,
  cellSize: FieldType.F32,
  width: FieldType.U32,
  depth: FieldType.U32,
});

export const BiomeRegion = defineComponent('BiomeRegion', {
  biomeId: FieldType.U32,
  weight: FieldType.F32,
  temperature: FieldType.F32,
  moisture: FieldType.F32,
});

export const ScatterRule = defineComponent('ScatterRule', {
  prototypeMesh: FieldType.U32,
  prototypeMaterial: FieldType.U32,
  density: FieldType.F32,
  minScale: FieldType.F32,
  maxScale: FieldType.F32,
  jitter: FieldType.F32,
  seedOffset: FieldType.U32,
});

export const StableAssetRef = defineComponent('StableAssetRef', {
  assetId: FieldType.U32,
  variant: FieldType.U32,
});

export const SplinePath = defineComponent('SplinePath', {
  closed: FieldType.U8,
  pointCount: FieldType.U32,
  width: FieldType.F32,
  kind: FieldType.U32,
});

export const SplineControlPoint = defineComponent('SplineControlPoint', {
  index: FieldType.U32,
  tx: FieldType.F32,
  ty: FieldType.F32,
  tz: FieldType.F32,
  inX: FieldType.F32,
  inY: FieldType.F32,
  inZ: FieldType.F32,
  outX: FieldType.F32,
  outY: FieldType.F32,
  outZ: FieldType.F32,
});

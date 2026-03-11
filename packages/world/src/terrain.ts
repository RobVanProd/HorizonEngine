import type { MeshData } from '@engine/renderer-webgpu';
import { fbm2D, hash2D } from './random.js';
import type { SplinePoint } from './spline.js';

export const enum BiomeId {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Alpine = 3,
  River = 4,
}

export interface Heightfield {
  width: number;
  depth: number;
  cellSize: number;
  originX: number;
  originZ: number;
  heights: Float32Array;
  moisture: Float32Array;
  temperature: Float32Array;
  biomeIds: Uint8Array;
  minHeight: number;
  maxHeight: number;
}

export interface TerrainGenerationOptions {
  seed: number;
  width: number;
  depth: number;
  cellSize?: number;
  originX?: number;
  originZ?: number;
  baseHeight?: number;
  heightScale?: number;
  octaves?: number;
  roadSpline?: SplinePoint[];
  roadWidth?: number;
}

export interface ScatterInstance {
  position: [number, number, number];
  normal: [number, number, number];
  scale: number;
  rotationY: number;
  biomeId: number;
}

export interface ScatterOptions {
  seed: number;
  density: number;
  minScale?: number;
  maxScale?: number;
  allowedBiomes?: number[];
  minSlope?: number;
  maxSlope?: number;
}

export function generateHeightfield(options: TerrainGenerationOptions): Heightfield {
  const width = options.width;
  const depth = options.depth;
  const cellSize = options.cellSize ?? 2;
  const originX = options.originX ?? 0;
  const originZ = options.originZ ?? 0;
  const heights = new Float32Array(width * depth);
  const moisture = new Float32Array(width * depth);
  const temperature = new Float32Array(width * depth);
  const biomeIds = new Uint8Array(width * depth);
  const baseHeight = options.baseHeight ?? 0;
  const heightScale = options.heightScale ?? 18;
  const octaves = options.octaves ?? 5;

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const wx = originX + x * cellSize;
      const wz = originZ + z * cellSize;
      const ridge = Math.abs(fbm2D(options.seed + 97, wx * 0.008, wz * 0.008, octaves, 2.1, 0.55));
      const broad = fbm2D(options.seed, wx * 0.0025, wz * 0.0025, octaves, 2, 0.5);
      const detail = fbm2D(options.seed + 37, wx * 0.03, wz * 0.03, 3, 2, 0.45) * 0.12;
      let height = baseHeight + (broad * 0.8 + ridge * 0.35 + detail) * heightScale;
      if (options.roadSpline && options.roadSpline.length > 1) {
        const distance = distanceToPolyline(wx, wz, options.roadSpline);
        const widthFalloff = options.roadWidth ?? 5;
        const roadMask = Math.max(0, 1 - distance / widthFalloff);
        height -= roadMask * heightScale * 0.08;
      }

      const idx = z * width + x;
      const m = fbm2D(options.seed + 211, wx * 0.004, wz * 0.004, 4, 2, 0.5) * 0.5 + 0.5;
      const t = 1 - clamp01((height - baseHeight + heightScale * 0.4) / (heightScale * 1.8));
      heights[idx] = height;
      moisture[idx] = clamp01(m);
      temperature[idx] = clamp01(t);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
  }

  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      const slope = sampleSlopeAt(heightfieldProxy(width, depth, cellSize, heights), x, z);
      biomeIds[idx] = classifyBiome(heights[idx]!, moisture[idx]!, temperature[idx]!, slope);
    }
  }

  return {
    width,
    depth,
    cellSize,
    originX,
    originZ,
    heights,
    moisture,
    temperature,
    biomeIds,
    minHeight,
    maxHeight,
  };
}

export function buildTerrainMeshData(heightfield: Heightfield): MeshData {
  const { width, depth, cellSize, originX, originZ } = heightfield;
  const positions = new Float32Array(width * depth * 3);
  const normals = new Float32Array(width * depth * 3);
  const uvs = new Float32Array(width * depth * 2);
  const tangents = new Float32Array(width * depth * 4);

  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      const px = originX + x * cellSize;
      const py = sampleHeight(heightfield, x, z);
      const pz = originZ + z * cellSize;
      positions[idx * 3] = px;
      positions[idx * 3 + 1] = py;
      positions[idx * 3 + 2] = pz;

      const normal = sampleNormal(heightfield, x, z);
      normals[idx * 3] = normal[0];
      normals[idx * 3 + 1] = normal[1];
      normals[idx * 3 + 2] = normal[2];

      uvs[idx * 2] = x / Math.max(1, width - 1);
      uvs[idx * 2 + 1] = z / Math.max(1, depth - 1);
      tangents[idx * 4] = 1;
      tangents[idx * 4 + 1] = 0;
      tangents[idx * 4 + 2] = 0;
      tangents[idx * 4 + 3] = 1;
    }
  }

  const quadCount = (width - 1) * (depth - 1);
  const indices = new Uint32Array(quadCount * 6);
  let ii = 0;
  for (let z = 0; z < depth - 1; z++) {
    for (let x = 0; x < width - 1; x++) {
      const a = z * width + x;
      const b = a + width;
      indices[ii++] = a;
      indices[ii++] = b;
      indices[ii++] = a + 1;
      indices[ii++] = a + 1;
      indices[ii++] = b;
      indices[ii++] = b + 1;
    }
  }

  return { positions, normals, uvs, tangents, indices };
}

export function generateScatterInstances(heightfield: Heightfield, options: ScatterOptions): ScatterInstance[] {
  const instances: ScatterInstance[] = [];
  const minScale = options.minScale ?? 0.8;
  const maxScale = options.maxScale ?? 1.4;
  const allowedBiomes = options.allowedBiomes ?? [BiomeId.Plains, BiomeId.Forest];
  const minSlope = options.minSlope ?? 0;
  const maxSlope = options.maxSlope ?? 0.55;

  for (let z = 0; z < heightfield.depth - 1; z++) {
    for (let x = 0; x < heightfield.width - 1; x++) {
      const idx = z * heightfield.width + x;
      const biomeId = heightfield.biomeIds[idx]!;
      if (!allowedBiomes.includes(biomeId)) continue;
      const slope = sampleSlopeAt(heightfield, x, z);
      if (slope < minSlope || slope > maxSlope) continue;

      const cellSeed = hash2D(options.seed, x, z);
      const chance = (cellSeed & 0xffff) / 0xffff;
      if (chance > options.density) continue;

      const jitterX = (((cellSeed >>> 8) & 0xff) / 255 - 0.5) * heightfield.cellSize;
      const jitterZ = (((cellSeed >>> 16) & 0xff) / 255 - 0.5) * heightfield.cellSize;
      const wx = heightfield.originX + x * heightfield.cellSize + jitterX;
      const wz = heightfield.originZ + z * heightfield.cellSize + jitterZ;
      const h = sampleHeightWorld(heightfield, wx, wz);
      instances.push({
        position: [wx, h, wz],
        normal: sampleNormal(heightfield, x, z),
        scale: minScale + (((cellSeed >>> 24) & 0xff) / 255) * (maxScale - minScale),
        rotationY: ((cellSeed >>> 4) & 0xffff) / 0xffff * Math.PI * 2,
        biomeId,
      });
    }
  }

  return instances;
}

export function sampleHeight(heightfield: Heightfield, x: number, z: number): number {
  const clampedX = Math.max(0, Math.min(heightfield.width - 1, x));
  const clampedZ = Math.max(0, Math.min(heightfield.depth - 1, z));
  return heightfield.heights[clampedZ * heightfield.width + clampedX]!;
}

export function sampleHeightWorld(heightfield: Heightfield, worldX: number, worldZ: number): number {
  const fx = (worldX - heightfield.originX) / heightfield.cellSize;
  const fz = (worldZ - heightfield.originZ) / heightfield.cellSize;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(heightfield.width - 1, x0 + 1);
  const z1 = Math.min(heightfield.depth - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = sampleHeight(heightfield, x0, z0);
  const h10 = sampleHeight(heightfield, x1, z0);
  const h01 = sampleHeight(heightfield, x0, z1);
  const h11 = sampleHeight(heightfield, x1, z1);
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

export function sampleNormal(heightfield: Heightfield, x: number, z: number): [number, number, number] {
  const left = sampleHeight(heightfield, x - 1, z);
  const right = sampleHeight(heightfield, x + 1, z);
  const down = sampleHeight(heightfield, x, z - 1);
  const up = sampleHeight(heightfield, x, z + 1);
  const nx = left - right;
  const ny = heightfield.cellSize * 2;
  const nz = down - up;
  return normalize3([nx, ny, nz]);
}

export function sampleSlopeAt(heightfield: Heightfield, x: number, z: number): number {
  const n = sampleNormal(heightfield, x, z);
  return 1 - n[1];
}

function classifyBiome(height: number, moisture: number, temperature: number, slope: number): number {
  if (slope < 0.06 && moisture > 0.62 && height < 2.5) return BiomeId.River;
  if (height > 10 || temperature < 0.28) return BiomeId.Alpine;
  if (moisture < 0.22 && temperature > 0.58) return BiomeId.Desert;
  if (moisture > 0.48) return BiomeId.Forest;
  return BiomeId.Plains;
}

function heightfieldProxy(width: number, depth: number, cellSize: number, heights: Float32Array): Heightfield {
  return {
    width,
    depth,
    cellSize,
    originX: 0,
    originZ: 0,
    heights,
    moisture: new Float32Array(width * depth),
    temperature: new Float32Array(width * depth),
    biomeIds: new Uint8Array(width * depth),
    minHeight: 0,
    maxHeight: 0,
  };
}

function distanceToPolyline(x: number, z: number, points: SplinePoint[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!.position;
    const b = points[i]!.position;
    best = Math.min(best, pointToSegmentDistance2D(x, z, a[0], a[2], b[0], b[2]));
  }
  return best;
}

function pointToSegmentDistance2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
  const qx = ax + abx * t;
  const qz = az + abz * t;
  return Math.hypot(px - qx, pz - qz);
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

import type { MeshData } from '@engine/renderer-webgpu';
import {
  BiomeId,
  getNormalizedHeight,
  hash2D,
  sampleHeightWorld,
  sampleNormal,
  sampleSlopeAt,
  type Heightfield,
  type SplinePoint,
} from '@engine/world';

export interface GrassFieldOptions {
  seed: number;
  density: number;
  bladesPerCell: number;
  minBladeHeight: number;
  maxBladeHeight: number;
  bladeWidth: number;
  allowedBiomes?: number[];
  minNormalizedHeight?: number;
  maxNormalizedHeight?: number;
  maxSlope?: number;
  avoidSpline?: SplinePoint[];
  avoidSplineRadius?: number;
  avoidCircles?: Array<{ centerX: number; centerZ: number; radius: number }>;
}

export function buildStylizedGrassMesh(heightfield: Heightfield, options: GrassFieldOptions): MeshData {
  const allowedBiomes = options.allowedBiomes ?? [BiomeId.Plains];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const tangents: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (let z = 0; z < heightfield.depth - 1; z++) {
    for (let x = 0; x < heightfield.width - 1; x++) {
      const idx = z * heightfield.width + x;
      const biomeId = heightfield.biomeIds[idx]!;
      if (!allowedBiomes.includes(biomeId)) continue;
      if ((options.maxSlope ?? 0.14) < sampleSlopeAt(heightfield, x, z)) continue;

      const worldY = heightfield.heights[idx]!;
      const normalizedHeight = getNormalizedHeight(heightfield, worldY);
      if (normalizedHeight < (options.minNormalizedHeight ?? 0)) continue;
      if (normalizedHeight > (options.maxNormalizedHeight ?? 1)) continue;

      const cellSeed = hash2D(options.seed, x, z);
      const chance = (cellSeed & 0xffff) / 0xffff;
      if (chance > options.density) continue;

      const bladeCount = 1 + (cellSeed >>> 28) % Math.max(1, options.bladesPerCell);
      for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex++) {
        const bladeSeed = hash2D(cellSeed ^ 0x45d9f3b, bladeIndex, options.seed);
        const px = heightfield.originX + (x + ((bladeSeed >>> 3) & 0xff) / 255) * heightfield.cellSize;
        const pz = heightfield.originZ + (z + ((bladeSeed >>> 11) & 0xff) / 255) * heightfield.cellSize;
        if (isExcluded(px, pz, options)) continue;

        const py = sampleHeightWorld(heightfield, px, pz);
        const hT = ((bladeSeed >>> 19) & 0xff) / 255;
        const bladeHeight = options.minBladeHeight + (options.maxBladeHeight - options.minBladeHeight) * hT;
        const width = options.bladeWidth * (0.75 + (((bladeSeed >>> 7) & 0xff) / 255) * 0.65);
        const phase = ((bladeSeed >>> 23) & 0xff) / 255;
        const normal = sampleNormal(heightfield, x, z);
        const angleA = (((bladeSeed >>> 1) & 0xffff) / 0xffff) * Math.PI * 2;
        const angleB = angleA + Math.PI * 0.5;

        vertexOffset = appendBladeCross(
          positions,
          normals,
          uvs,
          tangents,
          indices,
          vertexOffset,
          px,
          py,
          pz,
          width,
          bladeHeight,
          angleA,
          angleB,
          phase,
          normal,
        );
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    tangents: new Float32Array(tangents),
    indices: new Uint32Array(indices),
  };
}

function appendBladeCross(
  positions: number[],
  normals: number[],
  uvs: number[],
  tangents: number[],
  indices: number[],
  vertexOffset: number,
  px: number,
  py: number,
  pz: number,
  width: number,
  height: number,
  angleA: number,
  angleB: number,
  phase: number,
  terrainNormal: [number, number, number],
): number {
  let nextOffset = vertexOffset;
  nextOffset = appendBlade(positions, normals, uvs, tangents, indices, nextOffset, px, py, pz, width, height, angleA, phase, terrainNormal);
  nextOffset = appendBlade(positions, normals, uvs, tangents, indices, nextOffset, px, py, pz, width * 0.92, height * 0.96, angleB, phase * 0.85 + 0.07, terrainNormal);
  return nextOffset;
}

function appendBlade(
  positions: number[],
  normals: number[],
  uvs: number[],
  tangents: number[],
  indices: number[],
  vertexOffset: number,
  px: number,
  py: number,
  pz: number,
  width: number,
  height: number,
  angle: number,
  phase: number,
  terrainNormal: [number, number, number],
): number {
  const dx = Math.cos(angle) * width * 0.5;
  const dz = Math.sin(angle) * width * 0.5;
  const mdx = dx * 0.45;
  const mdz = dz * 0.45;
  const topLeanX = dx * 0.1;
  const topLeanZ = dz * 0.1;

  const verts = [
    [px - dx, py, pz - dz, 0, 0],
    [px + dx, py, pz + dz, phase, 0],
    [px - mdx, py + height * 0.55, pz - mdz, 0, 0.58],
    [px + mdx, py + height * 0.55, pz + mdz, phase, 0.58],
    [px + topLeanX, py + height, pz + topLeanZ, phase * 0.5 + 0.15, 1],
  ] as const;

  for (const vert of verts) {
    positions.push(vert[0], vert[1], vert[2]);
    normals.push(terrainNormal[0], Math.max(terrainNormal[1], 0.7), terrainNormal[2]);
    uvs.push(vert[3], vert[4]);
    tangents.push(1, 0, 0, 1);
  }

  indices.push(
    vertexOffset + 0, vertexOffset + 1, vertexOffset + 2,
    vertexOffset + 2, vertexOffset + 1, vertexOffset + 3,
    vertexOffset + 2, vertexOffset + 3, vertexOffset + 4,
    vertexOffset + 2, vertexOffset + 1, vertexOffset + 0,
    vertexOffset + 3, vertexOffset + 1, vertexOffset + 2,
    vertexOffset + 4, vertexOffset + 3, vertexOffset + 2,
  );

  return vertexOffset + 5;
}

function isExcluded(worldX: number, worldZ: number, options: GrassFieldOptions): boolean {
  if (options.avoidSpline && options.avoidSpline.length > 1 && (options.avoidSplineRadius ?? 0) > 0) {
    if (distanceToPolyline(worldX, worldZ, options.avoidSpline) <= (options.avoidSplineRadius ?? 0)) return true;
  }
  for (const circle of options.avoidCircles ?? []) {
    if (Math.hypot(worldX - circle.centerX, worldZ - circle.centerZ) <= circle.radius) return true;
  }
  return false;
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

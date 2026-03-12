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
  profile?: 'blade' | 'coverage';
  clusterRadiusMultiplier?: number;
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

  const fieldWidth = Math.max((heightfield.width - 1) * heightfield.cellSize, heightfield.cellSize);
  const fieldDepth = Math.max((heightfield.depth - 1) * heightfield.cellSize, heightfield.cellSize);

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

      const cellCenterX = heightfield.originX + (x + 0.5) * heightfield.cellSize;
      const cellCenterZ = heightfield.originZ + (z + 0.5) * heightfield.cellSize;
      const clusterRadius = heightfield.cellSize * (options.clusterRadiusMultiplier ?? 0.5);
      const bladeCount = Math.max(
        1,
        Math.round(options.bladesPerCell * (0.72 + (((cellSeed >>> 20) & 0xff) / 255) * 0.68)),
      );

      for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex++) {
        const bladeSeed = hash2D(cellSeed ^ 0x45d9f3b, bladeIndex, options.seed);
        const localRadius = clusterRadius * Math.sqrt(((bladeSeed >>> 3) & 0xff) / 255);
        const localAngle = (((bladeSeed >>> 11) & 0xffff) / 0xffff) * Math.PI * 2;
        const px = cellCenterX + Math.cos(localAngle) * localRadius;
        const pz = cellCenterZ + Math.sin(localAngle) * localRadius;
        if (isExcluded(px, pz, options)) continue;

        const py = sampleHeightWorld(heightfield, px, pz);
        const heightT = ((bladeSeed >>> 19) & 0xff) / 255;
        const bladeHeight = options.minBladeHeight + (options.maxBladeHeight - options.minBladeHeight) * heightT;
        const width = options.bladeWidth * (0.82 + (((bladeSeed >>> 7) & 0xff) / 255) * 0.32);
        const fieldU = clamp01((px - heightfield.originX) / fieldWidth);
        const fieldV = clamp01((pz - heightfield.originZ) / fieldDepth);
        const phase = ((bladeSeed >>> 23) & 0xff) / 255;
        const normal = sampleNormal(heightfield, x, z);
        const angle = (((bladeSeed >>> 1) & 0xffff) / 0xffff) * Math.PI * 2;
        const tipBend = ((((bladeSeed >>> 5) ^ 0x7f4a7c15) & 0xffff) / 0xffff) * Math.PI * 2;
        const variation = (((bladeSeed >>> 27) & 0x1f) / 0x1f);

        vertexOffset = appendDemoBlade(
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
          angle,
          tipBend,
          fieldU,
          fieldV,
          phase,
          variation,
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

function appendDemoBlade(
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
  tipBendAngle: number,
  fieldU: number,
  fieldV: number,
  phase: number,
  variation: number,
  terrainNormal: [number, number, number],
): number {
  const halfWidth = width * 0.5;
  const midWidth = width * 0.25;
  const tipOffset = width * (0.18 + variation * 0.22);
  const yawUnitX = Math.sin(angle);
  const yawUnitZ = -Math.cos(angle);
  const tipUnitX = Math.sin(tipBendAngle);
  const tipUnitZ = -Math.cos(tipBendAngle);
  const bladeNormal = blendBladeNormal(angle, terrainNormal);

  const verts = [
    [px + yawUnitX * halfWidth, py, pz + yawUnitZ * halfWidth, 0],
    [px - yawUnitX * halfWidth, py, pz - yawUnitZ * halfWidth, 0],
    [px - yawUnitX * midWidth, py + height * 0.52, pz - yawUnitZ * midWidth, 0.5],
    [px + yawUnitX * midWidth, py + height * 0.52, pz + yawUnitZ * midWidth, 0.5],
    [px + tipUnitX * tipOffset, py + height, pz + tipUnitZ * tipOffset, 1],
  ] as const;

  for (const vert of verts) {
    positions.push(vert[0], vert[1], vert[2]);
    normals.push(bladeNormal[0], bladeNormal[1], bladeNormal[2]);
    uvs.push(fieldU, fieldV);
    tangents.push(vert[3], phase, variation, 1);
  }

  indices.push(
    vertexOffset + 0, vertexOffset + 1, vertexOffset + 2,
    vertexOffset + 2, vertexOffset + 4, vertexOffset + 3,
    vertexOffset + 3, vertexOffset + 0, vertexOffset + 2,
  );

  return vertexOffset + 5;
}

function blendBladeNormal(angle: number, terrainNormal: [number, number, number]): [number, number, number] {
  const planeNormalX = Math.cos(angle);
  const planeNormalZ = Math.sin(angle);
  return normalizeVec3([
    planeNormalX * 0.76 + terrainNormal[0] * 0.2,
    0.82 + terrainNormal[1] * 0.28,
    planeNormalZ * 0.76 + terrainNormal[2] * 0.2,
  ]);
}

function normalizeVec3(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 1e-5) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

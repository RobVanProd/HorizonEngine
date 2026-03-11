import type { Geometry } from '@engine/renderer-webgpu';

export interface MeshletDescriptor {
  readonly indexOffset: number;
  readonly indexCount: number;
  readonly vertexOffset: number;
  readonly vertexCount: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly radius: number;
}

export interface MeshletMesh {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly meshlets: readonly MeshletDescriptor[];
  readonly vertexStride: number;
  readonly totalTriangles: number;
}

const MAX_MESHLET_TRIANGLES = 64;
const MAX_MESHLET_VERTICES = 64;

/**
 * Partition a geometry into meshlets (clusters of triangles) with bounding spheres.
 * Each meshlet contains up to MAX_MESHLET_TRIANGLES triangles.
 *
 * This is a naive sequential partitioner suitable for Phase 1 prototyping.
 * A production implementation would use graph-based clustering for spatial locality.
 */
export function buildMeshlets(geometry: Geometry, maxTriangles = MAX_MESHLET_TRIANGLES): MeshletMesh {
  const { vertices, indices, stride } = geometry;
  const triangleCount = indices.length / 3;
  const meshlets: MeshletDescriptor[] = [];

  // Partition triangles into sequential meshlets
  for (let triStart = 0; triStart < triangleCount; triStart += maxTriangles) {
    const triEnd = Math.min(triStart + maxTriangles, triangleCount);
    const triCount = triEnd - triStart;
    const idxOffset = triStart * 3;
    const idxCount = triCount * 3;

    // Gather unique vertex indices in this meshlet for bounding sphere computation
    const meshletVertexSet = new Set<number>();
    for (let i = idxOffset; i < idxOffset + idxCount; i++) {
      meshletVertexSet.add(indices[i]!);
    }

    // Compute bounding sphere (Ritter's method — fast approximation)
    const sphere = computeBoundingSphere(vertices, stride, meshletVertexSet);

    meshlets.push({
      indexOffset: idxOffset,
      indexCount: idxCount,
      vertexOffset: 0,
      vertexCount: meshletVertexSet.size,
      centerX: sphere.cx,
      centerY: sphere.cy,
      centerZ: sphere.cz,
      radius: sphere.r,
    });
  }

  return {
    vertices,
    indices,
    meshlets,
    vertexStride: stride,
    totalTriangles: triangleCount,
  };
}

/**
 * Compute the overall bounding sphere for an entire geometry.
 */
export function computeMeshBoundingSphere(
  vertices: Float32Array,
  stride: number,
  vertexCount: number,
): { cx: number; cy: number; cz: number; r: number } {
  const allVerts = new Set<number>();
  for (let i = 0; i < vertexCount; i++) allVerts.add(i);
  return computeBoundingSphere(vertices, stride, allVerts);
}

function computeBoundingSphere(
  vertices: Float32Array,
  stride: number,
  vertexSet: Set<number>,
): { cx: number; cy: number; cz: number; r: number } {
  if (vertexSet.size === 0) return { cx: 0, cy: 0, cz: 0, r: 0 };

  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (const vi of vertexSet) {
    cx += vertices[vi * stride]!;
    cy += vertices[vi * stride + 1]!;
    cz += vertices[vi * stride + 2]!;
  }
  const n = vertexSet.size;
  cx /= n; cy /= n; cz /= n;

  // Find max distance from centroid
  let maxR2 = 0;
  for (const vi of vertexSet) {
    const dx = vertices[vi * stride]! - cx;
    const dy = vertices[vi * stride + 1]! - cy;
    const dz = vertices[vi * stride + 2]! - cz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }

  return { cx, cy, cz, r: Math.sqrt(maxR2) };
}

/**
 * Pack meshlet bounding data into a GPU-friendly flat Float32Array.
 * Layout per meshlet (8 floats = 32 bytes):
 *   [centerX, centerY, centerZ, radius, indexOffset (as f32 bits), indexCount (as f32 bits), vertexOffset (as f32 bits), pad]
 */
export function packMeshletBounds(meshlets: readonly MeshletDescriptor[]): Float32Array {
  const data = new Float32Array(meshlets.length * 8);
  const u32View = new Uint32Array(data.buffer);

  for (let i = 0; i < meshlets.length; i++) {
    const m = meshlets[i]!;
    const off = i * 8;
    data[off + 0] = m.centerX;
    data[off + 1] = m.centerY;
    data[off + 2] = m.centerZ;
    data[off + 3] = m.radius;
    u32View[off + 4] = m.indexOffset;
    u32View[off + 5] = m.indexCount;
    u32View[off + 6] = m.vertexOffset;
    u32View[off + 7] = 0;
  }
  return data;
}

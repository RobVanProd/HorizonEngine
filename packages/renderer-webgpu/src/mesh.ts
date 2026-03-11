/**
 * GPU mesh: vertex and index buffers uploaded to the GPU.
 *
 * Vertex layout (48 bytes per vertex):
 *   position: vec3f  (12 bytes)
 *   normal:   vec3f  (12 bytes)
 *   uv:       vec2f  (8 bytes)
 *   tangent:  vec4f  (16 bytes) — xyz=tangent, w=bitangent sign
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  tangents: Float32Array;
  indices: Uint32Array;
  /** 4 joint indices per vertex (optional — present for skinned meshes). */
  joints?: Uint16Array;
  /** 4 joint weights per vertex (optional — present for skinned meshes). */
  weights?: Float32Array;
}

export const PBR_VERTEX_STRIDE = 48;
export const PBR_SKINNED_VERTEX_STRIDE = 72;

export const PBR_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: PBR_VERTEX_STRIDE,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
    { shaderLocation: 3, offset: 32, format: 'float32x4' },  // tangent
  ],
};

export const PBR_SKINNED_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: PBR_SKINNED_VERTEX_STRIDE,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
    { shaderLocation: 3, offset: 32, format: 'float32x4' },  // tangent
    { shaderLocation: 4, offset: 48, format: 'uint16x4' },   // joints
    { shaderLocation: 5, offset: 56, format: 'float32x4' },  // weights
  ],
};

export class GPUMesh {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly skinned: boolean;
  readonly triangleCount: number;
  readonly meshletCount: number;
  readonly boundsMin: [number, number, number];
  readonly boundsMax: [number, number, number];
  readonly boundsRadius: number;

  private constructor(
    vertexBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    vertexCount: number,
    indexCount: number,
    skinned: boolean,
    triangleCount: number,
    meshletCount: number,
    boundsMin: [number, number, number],
    boundsMax: [number, number, number],
    boundsRadius: number,
  ) {
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.vertexCount = vertexCount;
    this.indexCount = indexCount;
    this.skinned = skinned;
    this.triangleCount = triangleCount;
    this.meshletCount = meshletCount;
    this.boundsMin = boundsMin;
    this.boundsMax = boundsMax;
    this.boundsRadius = boundsRadius;
  }

  static create(device: GPUDevice, data: MeshData): GPUMesh {
    const vertexCount = data.positions.length / 3;
    const hasSkin = !!(data.joints && data.weights);
    const interleaved = hasSkin
      ? interleaveSkinnedVertices(data, vertexCount)
      : interleaveVertices(data, vertexCount);
    const bounds = computeBounds(data.positions);

    const vertexBuffer = device.createBuffer({
      size: interleaved.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(vertexBuffer.getMappedRange()).set(new Uint8Array(interleaved));
    vertexBuffer.unmap();

    const indexBuffer = device.createBuffer({
      size: data.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(indexBuffer.getMappedRange()).set(data.indices);
    indexBuffer.unmap();

    return new GPUMesh(
      vertexBuffer,
      indexBuffer,
      vertexCount,
      data.indices.length,
      hasSkin,
      data.indices.length / 3,
      Math.max(1, Math.ceil((data.indices.length / 3) / 64)),
      bounds.min,
      bounds.max,
      bounds.radius,
    );
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
  }
}

function interleaveVertices(data: MeshData, count: number): ArrayBuffer {
  const floatsPerVertex = PBR_VERTEX_STRIDE / 4;
  const out = new Float32Array(count * floatsPerVertex);

  for (let i = 0; i < count; i++) {
    const o = i * floatsPerVertex;
    out[o + 0] = data.positions[i * 3]!;
    out[o + 1] = data.positions[i * 3 + 1]!;
    out[o + 2] = data.positions[i * 3 + 2]!;
    out[o + 3] = data.normals[i * 3]!;
    out[o + 4] = data.normals[i * 3 + 1]!;
    out[o + 5] = data.normals[i * 3 + 2]!;
    out[o + 6] = data.uvs[i * 2]!;
    out[o + 7] = data.uvs[i * 2 + 1]!;
    out[o + 8] = data.tangents[i * 4]!;
    out[o + 9] = data.tangents[i * 4 + 1]!;
    out[o + 10] = data.tangents[i * 4 + 2]!;
    out[o + 11] = data.tangents[i * 4 + 3]!;
  }

  return out.buffer;
}

function interleaveSkinnedVertices(data: MeshData, count: number): ArrayBuffer {
  const bytesPerVertex = PBR_SKINNED_VERTEX_STRIDE;
  const buf = new ArrayBuffer(count * bytesPerVertex);
  const f32View = new DataView(buf);

  for (let i = 0; i < count; i++) {
    const off = i * bytesPerVertex;
    // position (12B)
    f32View.setFloat32(off + 0, data.positions[i * 3]!, true);
    f32View.setFloat32(off + 4, data.positions[i * 3 + 1]!, true);
    f32View.setFloat32(off + 8, data.positions[i * 3 + 2]!, true);
    // normal (12B)
    f32View.setFloat32(off + 12, data.normals[i * 3]!, true);
    f32View.setFloat32(off + 16, data.normals[i * 3 + 1]!, true);
    f32View.setFloat32(off + 20, data.normals[i * 3 + 2]!, true);
    // uv (8B)
    f32View.setFloat32(off + 24, data.uvs[i * 2]!, true);
    f32View.setFloat32(off + 28, data.uvs[i * 2 + 1]!, true);
    // tangent (16B)
    f32View.setFloat32(off + 32, data.tangents[i * 4]!, true);
    f32View.setFloat32(off + 36, data.tangents[i * 4 + 1]!, true);
    f32View.setFloat32(off + 40, data.tangents[i * 4 + 2]!, true);
    f32View.setFloat32(off + 44, data.tangents[i * 4 + 3]!, true);
    // joints (8B — uint16x4)
    f32View.setUint16(off + 48, data.joints![i * 4]!, true);
    f32View.setUint16(off + 50, data.joints![i * 4 + 1]!, true);
    f32View.setUint16(off + 52, data.joints![i * 4 + 2]!, true);
    f32View.setUint16(off + 54, data.joints![i * 4 + 3]!, true);
    // weights (16B)
    f32View.setFloat32(off + 56, data.weights![i * 4]!, true);
    f32View.setFloat32(off + 60, data.weights![i * 4 + 1]!, true);
    f32View.setFloat32(off + 64, data.weights![i * 4 + 2]!, true);
    f32View.setFloat32(off + 68, data.weights![i * 4 + 3]!, true);
  }

  return buf;
}

function computeBounds(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
  radius: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - centerX;
    const dy = positions[i + 1]! - centerY;
    const dz = positions[i + 2]! - centerZ;
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    radius,
  };
}

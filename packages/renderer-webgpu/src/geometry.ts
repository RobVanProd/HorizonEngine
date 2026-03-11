/**
 * Procedural geometry generation. Returns interleaved vertex data
 * as Float32Array with layout: [px, py, pz, nx, ny, nz, u, v] per vertex.
 */

export interface Geometry {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly stride: number;
}

/**
 * Unit cube centered at origin, with normals and UVs.
 */
export function createCubeGeometry(): Geometry {
  const positions = [
    // +X
    0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, -0.5,
    // -X
    -0.5, -0.5,  0.5, -0.5, -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,  0.5,
    // +Y
    -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
    // -Y
    -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
    // +Z
    -0.5, -0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, -0.5,  0.5,
    // -Z
     0.5, -0.5, -0.5,  0.5,  0.5, -0.5, -0.5,  0.5, -0.5, -0.5, -0.5, -0.5,
  ];

  const normals = [
    1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ];

  const uvs = [
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ];

  const vertexCount = 24;
  const stride = 8;
  const vertices = new Float32Array(vertexCount * stride);

  for (let i = 0; i < vertexCount; i++) {
    const vi = i * stride;
    vertices[vi + 0] = positions[i * 3 + 0]!;
    vertices[vi + 1] = positions[i * 3 + 1]!;
    vertices[vi + 2] = positions[i * 3 + 2]!;
    vertices[vi + 3] = normals[i * 3 + 0]!;
    vertices[vi + 4] = normals[i * 3 + 1]!;
    vertices[vi + 5] = normals[i * 3 + 2]!;
    vertices[vi + 6] = uvs[i * 2 + 0]!;
    vertices[vi + 7] = uvs[i * 2 + 1]!;
  }

  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);

  return { vertices, indices, vertexCount, indexCount: 36, stride };
}

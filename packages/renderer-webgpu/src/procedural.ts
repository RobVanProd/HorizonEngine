import type { MeshData } from './mesh.js';

/**
 * UV sphere with analytically computed tangents.
 */
export function createSphere(radius = 1, segments = 64, rings = 32): MeshData {
  const vertCount = (rings + 1) * (segments + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const tangents = new Float32Array(vertCount * 4);

  let vi = 0;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      const nx = sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;

      positions[vi * 3] = nx * radius;
      positions[vi * 3 + 1] = ny * radius;
      positions[vi * 3 + 2] = nz * radius;

      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;

      uvs[vi * 2] = s / segments;
      uvs[vi * 2 + 1] = r / rings;

      // Tangent = d(position)/d(theta), normalized
      const tx = -sinTheta;
      const ty = 0;
      const tz = cosTheta;
      tangents[vi * 4] = tx;
      tangents[vi * 4 + 1] = ty;
      tangents[vi * 4 + 2] = tz;
      tangents[vi * 4 + 3] = 1.0; // bitangent sign

      vi++;
    }
  }

  const triCount = rings * segments * 2;
  const indices = new Uint32Array(triCount * 3);
  let ii = 0;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;

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

/**
 * Torus with analytically computed tangents.
 */
export function createTorus(majorRadius = 1, minorRadius = 0.4, segments = 64, rings = 32): MeshData {
  const vertCount = (rings + 1) * (segments + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const tangents = new Float32Array(vertCount * 4);

  let vi = 0;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      const cx = (majorRadius + minorRadius * cosTheta) * cosPhi;
      const cy = minorRadius * sinTheta;
      const cz = (majorRadius + minorRadius * cosTheta) * sinPhi;

      const nx = cosTheta * cosPhi;
      const ny = sinTheta;
      const nz = cosTheta * sinPhi;

      positions[vi * 3] = cx;
      positions[vi * 3 + 1] = cy;
      positions[vi * 3 + 2] = cz;

      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;

      uvs[vi * 2] = s / segments;
      uvs[vi * 2 + 1] = r / rings;

      // Tangent along the major circle direction
      tangents[vi * 4] = -sinPhi;
      tangents[vi * 4 + 1] = 0;
      tangents[vi * 4 + 2] = cosPhi;
      tangents[vi * 4 + 3] = 1.0;

      vi++;
    }
  }

  const triCount = rings * segments * 2;
  const indices = new Uint32Array(triCount * 3);
  let ii = 0;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;

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

/**
 * Ground plane in XZ with Y-up normal.
 */
export function createPlane(width = 10, depth = 10, segW = 1, segD = 1): MeshData {
  const vertCount = (segW + 1) * (segD + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const tangents = new Float32Array(vertCount * 4);

  let vi = 0;
  for (let z = 0; z <= segD; z++) {
    for (let x = 0; x <= segW; x++) {
      positions[vi * 3] = (x / segW - 0.5) * width;
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = (z / segD - 0.5) * depth;

      normals[vi * 3] = 0;
      normals[vi * 3 + 1] = 1;
      normals[vi * 3 + 2] = 0;

      uvs[vi * 2] = x / segW;
      uvs[vi * 2 + 1] = z / segD;

      tangents[vi * 4] = 1;
      tangents[vi * 4 + 1] = 0;
      tangents[vi * 4 + 2] = 0;
      tangents[vi * 4 + 3] = 1;

      vi++;
    }
  }

  const indices = new Uint32Array(segW * segD * 6);
  let ii = 0;
  for (let z = 0; z < segD; z++) {
    for (let x = 0; x < segW; x++) {
      const a = z * (segW + 1) + x;
      const b = a + segW + 1;

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

/**
 * Frustum plane extraction from a view-projection matrix.
 *
 * Planes are stored as vec4 (nx, ny, nz, d) in a format suitable for
 * both CPU testing and GPU uniform upload.
 *
 * Plane order: Left, Right, Bottom, Top, Near, Far
 */
export interface FrustumPlanes {
  readonly planes: Float32Array;
}

/**
 * Extract 6 frustum planes from a column-major view-projection matrix.
 * Each plane is normalized to unit-length normal.
 * Returns 6 * 4 = 24 floats as a flat Float32Array.
 */
export function extractFrustumPlanes(vp: Float32Array): FrustumPlanes {
  const planes = new Float32Array(24);

  // Column-major indexing: vp[col*4 + row]
  // Row 0: vp[0], vp[4], vp[8],  vp[12]
  // Row 1: vp[1], vp[5], vp[9],  vp[13]
  // Row 2: vp[2], vp[6], vp[10], vp[14]
  // Row 3: vp[3], vp[7], vp[11], vp[15]

  // Left:   row3 + row0
  setPlane(planes, 0,
    vp[3]! + vp[0]!,
    vp[7]! + vp[4]!,
    vp[11]! + vp[8]!,
    vp[15]! + vp[12]!,
  );

  // Right:  row3 - row0
  setPlane(planes, 1,
    vp[3]! - vp[0]!,
    vp[7]! - vp[4]!,
    vp[11]! - vp[8]!,
    vp[15]! - vp[12]!,
  );

  // Bottom: row3 + row1
  setPlane(planes, 2,
    vp[3]! + vp[1]!,
    vp[7]! + vp[5]!,
    vp[11]! + vp[9]!,
    vp[15]! + vp[13]!,
  );

  // Top:    row3 - row1
  setPlane(planes, 3,
    vp[3]! - vp[1]!,
    vp[7]! - vp[5]!,
    vp[11]! - vp[9]!,
    vp[15]! - vp[13]!,
  );

  // Near:   row3 + row2
  setPlane(planes, 4,
    vp[3]! + vp[2]!,
    vp[7]! + vp[6]!,
    vp[11]! + vp[10]!,
    vp[15]! + vp[14]!,
  );

  // Far:    row3 - row2
  setPlane(planes, 5,
    vp[3]! - vp[2]!,
    vp[7]! - vp[6]!,
    vp[11]! - vp[10]!,
    vp[15]! - vp[14]!,
  );

  return { planes };
}

function setPlane(out: Float32Array, index: number, a: number, b: number, c: number, d: number): void {
  const len = Math.sqrt(a * a + b * b + c * c);
  const off = index * 4;
  out[off + 0] = a / len;
  out[off + 1] = b / len;
  out[off + 2] = c / len;
  out[off + 3] = d / len;
}

/**
 * CPU-side frustum-sphere test. Returns true if the sphere is at least partially inside.
 */
export function frustumContainsSphere(
  frustum: FrustumPlanes,
  cx: number, cy: number, cz: number, radius: number,
): boolean {
  const p = frustum.planes;
  for (let i = 0; i < 6; i++) {
    const off = i * 4;
    const dist = p[off]! * cx + p[off + 1]! * cy + p[off + 2]! * cz + p[off + 3]!;
    if (dist < -radius) return false;
  }
  return true;
}

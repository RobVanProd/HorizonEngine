/**
 * Minimal math utilities for matrix operations.
 * All matrices are column-major Float32Arrays compatible with WebGPU uniform layout.
 */

export function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const m = new Float32Array(16);
  const f = 1.0 / Math.tan(fovY / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

export function mat4LookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const fz0 = zx / len, fz1 = zy / len, fz2 = zz / len;

  const xx = up[1] * fz2 - up[2] * fz1;
  const xy = up[2] * fz0 - up[0] * fz2;
  const xz = up[0] * fz1 - up[1] * fz0;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  const fx0 = xx / len, fx1 = xy / len, fx2 = xz / len;

  const ux = fz1 * fx2 - fz2 * fx1;
  const uy = fz2 * fx0 - fz0 * fx2;
  const uz = fz0 * fx1 - fz1 * fx0;

  const m = new Float32Array(16);
  m[0] = fx0; m[1] = ux; m[2] = fz0; m[3] = 0;
  m[4] = fx1; m[5] = uy; m[6] = fz1; m[7] = 0;
  m[8] = fx2; m[9] = uz; m[10] = fz2; m[11] = 0;
  m[12] = -(fx0 * eye[0] + fx1 * eye[1] + fx2 * eye[2]);
  m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  m[14] = -(fz0 * eye[0] + fz1 * eye[1] + fz2 * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + j]! * b[i * 4 + k]!;
      }
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

export function mat4Translation(x: number, y: number, z: number): Float32Array {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function mat4Scale(sx: number, sy: number, sz: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
  return m;
}

export function mat4RotationY(angle: number): Float32Array {
  const m = mat4Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

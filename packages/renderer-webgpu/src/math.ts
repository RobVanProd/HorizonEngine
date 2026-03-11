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

export function mat4Inverse(m: Float32Array): Float32Array {
  const out = new Float32Array(16);
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-8) return mat4Identity();
  const id = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return out;
}

export function mat4Ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
  const m = new Float32Array(16);
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  m[0] = -2 * lr;
  m[5] = -2 * bt;
  m[10] = nf;
  m[12] = (left + right) * lr;
  m[13] = (top + bottom) * bt;
  m[14] = near * nf;
  m[15] = 1;
  return m;
}

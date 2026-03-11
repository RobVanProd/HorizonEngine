import type { Skeleton, AnimationClip, JointPose, Joint } from './types.js';

// ─── Quaternion helpers ──────────────────────────────────────────

function quatSlerp(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  t: number,
  out: [number, number, number, number],
): void {
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }

  if (dot > 0.9995) {
    out[0] = ax + t * (bx - ax);
    out[1] = ay + t * (by - ay);
    out[2] = az + t * (bz - az);
    out[3] = aw + t * (bw - aw);
  } else {
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinTheta;
    const wb = Math.sin(t * theta) / sinTheta;
    out[0] = wa * ax + wb * bx;
    out[1] = wa * ay + wb * by;
    out[2] = wa * az + wb * bz;
    out[3] = wa * aw + wb * bw;
  }

  const len = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2 + out[3] ** 2) || 1;
  out[0] /= len; out[1] /= len; out[2] /= len; out[3] /= len;
}

function quatToMat4(qx: number, qy: number, qz: number, qw: number, out: Float32Array, off: number): void {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  out[off + 0] = 1 - (yy + zz); out[off + 1] = xy + wz;       out[off + 2] = xz - wy;       out[off + 3] = 0;
  out[off + 4] = xy - wz;       out[off + 5] = 1 - (xx + zz); out[off + 6] = yz + wx;       out[off + 7] = 0;
  out[off + 8] = xz + wy;       out[off + 9] = yz - wx;       out[off + 10] = 1 - (xx + yy); out[off + 11] = 0;
  out[off + 12] = 0;             out[off + 13] = 0;             out[off + 14] = 0;             out[off + 15] = 1;
}

// ─── Matrix helpers ──────────────────────────────────────────────

function mat4Mul(a: Float32Array, aO: number, b: Float32Array, bO: number, out: Float32Array, oO: number): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[aO + k * 4 + j]! * b[bO + i * 4 + k]!;
      out[oO + i * 4 + j] = s;
    }
  }
}

// ─── Keyframe binary search ─────────────────────────────────────

function findKeyframe(times: Float32Array, t: number): [number, number, number] {
  if (t <= times[0]!) return [0, 0, 0];
  if (t >= times[times.length - 1]!) return [times.length - 1, times.length - 1, 0];

  let lo = 0, hi = times.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid; else hi = mid;
  }

  const tA = times[lo]!, tB = times[hi]!;
  const frac = tB > tA ? (t - tA) / (tB - tA) : 0;
  return [lo, hi, frac];
}

// ─── Clip sampling ──────────────────────────────────────────────

const _defaultPose: JointPose = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

const _tempQuat: [number, number, number, number] = [0, 0, 0, 1];

/**
 * Sample all channels of a clip at the given time.
 * Returns an array of per-joint local poses (indexed by joint index).
 * Joints without channels keep their rest pose from the skeleton.
 */
export function sampleClip(clip: AnimationClip, time: number, skeleton: Skeleton): JointPose[] {
  const jointCount = skeleton.joints.length;
  const poses: JointPose[] = new Array(jointCount);
  for (let i = 0; i < jointCount; i++) {
    const j = skeleton.joints[i]!;
    poses[i] = {
      translation: [j.restTranslation[0], j.restTranslation[1], j.restTranslation[2]],
      rotation: [j.restRotation[0], j.restRotation[1], j.restRotation[2], j.restRotation[3]],
      scale: [j.restScale[0], j.restScale[1], j.restScale[2]],
    };
  }

  for (const ch of clip.channels) {
    const pose = poses[ch.jointIndex]!;
    const [iA, iB, frac] = findKeyframe(ch.times, time);

    if (ch.path === 'translation' || ch.path === 'scale') {
      const stride = 3;
      const a0 = iA * stride, b0 = iB * stride;
      const v = ch.values;
      const arr = ch.path === 'translation' ? pose.translation : pose.scale;

      if (ch.interpolation === 'STEP' || frac === 0) {
        arr[0] = v[a0]!; arr[1] = v[a0 + 1]!; arr[2] = v[a0 + 2]!;
      } else {
        arr[0] = v[a0]! + frac * (v[b0]! - v[a0]!);
        arr[1] = v[a0 + 1]! + frac * (v[b0 + 1]! - v[a0 + 1]!);
        arr[2] = v[a0 + 2]! + frac * (v[b0 + 2]! - v[a0 + 2]!);
      }
    } else if (ch.path === 'rotation') {
      const stride = 4;
      const a0 = iA * stride, b0 = iB * stride;
      const v = ch.values;

      if (ch.interpolation === 'STEP' || frac === 0) {
        pose.rotation[0] = v[a0]!; pose.rotation[1] = v[a0 + 1]!;
        pose.rotation[2] = v[a0 + 2]!; pose.rotation[3] = v[a0 + 3]!;
      } else {
        quatSlerp(
          v[a0]!, v[a0 + 1]!, v[a0 + 2]!, v[a0 + 3]!,
          v[b0]!, v[b0 + 1]!, v[b0 + 2]!, v[b0 + 3]!,
          frac, _tempQuat,
        );
        pose.rotation[0] = _tempQuat[0];
        pose.rotation[1] = _tempQuat[1];
        pose.rotation[2] = _tempQuat[2];
        pose.rotation[3] = _tempQuat[3];
      }
    }
  }

  return poses;
}

// ─── Skin matrix computation ────────────────────────────────────

const _localMat = new Float32Array(16);
const _worldMat = new Float32Array(256 * 16); // up to 256 joints
const _tempMat = new Float32Array(16);

/**
 * Compute final joint skinning matrices from sampled poses.
 *
 * For each joint j:
 *   worldMatrix[j] = worldMatrix[parent[j]] * localMatrix(pose[j])
 *   outMatrices[j] = worldMatrix[j] * inverseBindMatrix[j]
 */
export function computeSkinMatrices(
  skeleton: Skeleton,
  poses: JointPose[],
  outMatrices: Float32Array,
): void {
  const joints = skeleton.joints;
  const count = joints.length;

  for (let j = 0; j < count; j++) {
    const pose = poses[j] ?? _defaultPose;
    const [tx, ty, tz] = pose.translation;
    const [qx, qy, qz, qw] = pose.rotation;
    const [sx, sy, sz] = pose.scale;

    quatToMat4(qx, qy, qz, qw, _localMat, 0);

    _localMat[0] *= sx; _localMat[1] *= sx; _localMat[2] *= sx;
    _localMat[4] *= sy; _localMat[5] *= sy; _localMat[6] *= sy;
    _localMat[8] *= sz; _localMat[9] *= sz; _localMat[10] *= sz;
    _localMat[12] = tx; _localMat[13] = ty; _localMat[14] = tz;

    const wOff = j * 16;
    const joint = joints[j]!;

    if (joint.parentIndex < 0) {
      _worldMat.set(_localMat, wOff);
    } else {
      mat4Mul(_worldMat, joint.parentIndex * 16, _localMat, 0, _worldMat, wOff);
    }

    mat4Mul(_worldMat, wOff, joint.inverseBindMatrix, 0, outMatrices, wOff);
  }
}

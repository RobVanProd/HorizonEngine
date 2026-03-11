import { describe, it, expect } from 'vitest';
import { mat4Perspective, mat4LookAt, mat4Multiply } from '@engine/renderer-webgpu';
import { extractFrustumPlanes, frustumContainsSphere } from './frustum.js';

describe('Frustum', () => {
  const eye: [number, number, number] = [0, 10, 30];
  const target: [number, number, number] = [0, 0, 0];
  const up: [number, number, number] = [0, 1, 0];

  const proj = mat4Perspective(Math.PI / 4, 16 / 9, 0.1, 500);
  const view = mat4LookAt(eye, target, up);
  const vp = mat4Multiply(proj, view);
  const frustum = extractFrustumPlanes(vp);

  it('should contain objects at the target point', () => {
    expect(frustumContainsSphere(frustum, 0, 0, 0, 1)).toBe(true);
  });

  it('should contain objects near the camera', () => {
    expect(frustumContainsSphere(frustum, 0, 10, 28, 0.5)).toBe(true);
  });

  it('should reject objects far behind the camera', () => {
    expect(frustumContainsSphere(frustum, 0, 0, 100, 1)).toBe(false);
  });

  it('should reject objects far to the side', () => {
    expect(frustumContainsSphere(frustum, 500, 0, 0, 1)).toBe(false);
  });

  it('should contain large sphere overlapping frustum', () => {
    expect(frustumContainsSphere(frustum, 200, 0, 0, 500)).toBe(true);
  });

  it('should reject objects beyond far plane', () => {
    expect(frustumContainsSphere(frustum, 0, 0, -600, 1)).toBe(false);
  });

  it('should extract 6 planes with 24 floats', () => {
    expect(frustum.planes.length).toBe(24);
    // Each plane normal should be approximately unit length
    for (let i = 0; i < 6; i++) {
      const nx = frustum.planes[i * 4]!;
      const ny = frustum.planes[i * 4 + 1]!;
      const nz = frustum.planes[i * 4 + 2]!;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(len).toBeCloseTo(1.0, 4);
    }
  });
});

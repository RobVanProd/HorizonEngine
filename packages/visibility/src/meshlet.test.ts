import { describe, it, expect } from 'vitest';
import { createCubeGeometry } from '@engine/renderer-webgpu';
import { buildMeshlets, packMeshletBounds, computeMeshBoundingSphere } from './meshlet.js';

describe('Meshlet Builder', () => {
  const geometry = createCubeGeometry();

  it('should partition geometry into meshlets', () => {
    const mesh = buildMeshlets(geometry, 4);
    expect(mesh.meshlets.length).toBeGreaterThan(0);

    let totalIndices = 0;
    for (const m of mesh.meshlets) {
      totalIndices += m.indexCount;
      expect(m.indexCount).toBeLessThanOrEqual(4 * 3);
      expect(m.indexCount % 3).toBe(0);
    }
    expect(totalIndices).toBe(geometry.indexCount);
  });

  it('should compute valid bounding spheres', () => {
    const mesh = buildMeshlets(geometry, 64);
    for (const m of mesh.meshlets) {
      expect(m.radius).toBeGreaterThan(0);
      expect(isFinite(m.centerX)).toBe(true);
      expect(isFinite(m.centerY)).toBe(true);
      expect(isFinite(m.centerZ)).toBe(true);
    }
  });

  it('should respect max triangles per meshlet', () => {
    const mesh = buildMeshlets(geometry, 2);
    for (const m of mesh.meshlets) {
      expect(m.indexCount / 3).toBeLessThanOrEqual(2);
    }
    expect(mesh.meshlets.length).toBe(Math.ceil(geometry.indexCount / 3 / 2));
  });

  it('should pack meshlet bounds into flat array', () => {
    const mesh = buildMeshlets(geometry, 64);
    const packed = packMeshletBounds(mesh.meshlets);
    expect(packed.length).toBe(mesh.meshlets.length * 8);
    expect(packed[0]).toBeCloseTo(mesh.meshlets[0]!.centerX);
    expect(packed[3]).toBeCloseTo(mesh.meshlets[0]!.radius);
  });

  it('should compute mesh-level bounding sphere', () => {
    const bounds = computeMeshBoundingSphere(geometry.vertices, geometry.stride, geometry.vertexCount);
    expect(bounds.r).toBeGreaterThan(0);
    expect(bounds.cx).toBeCloseTo(0, 1);
    expect(bounds.cy).toBeCloseTo(0, 1);
    expect(bounds.cz).toBeCloseTo(0, 1);
    // Unit cube: half-diagonal = sqrt(0.5^2 * 3) ≈ 0.866
    expect(bounds.r).toBeCloseTo(0.866, 1);
  });
});

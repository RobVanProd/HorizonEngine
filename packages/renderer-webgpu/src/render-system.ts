/**
 * ECS-driven PBR render system.
 *
 * Queries all entities with WorldMatrix + MeshRef + MaterialRef + Visible,
 * reads their world matrix, and issues drawMesh calls on the PBRRenderer.
 */

import type { World, Query } from '@engine/ecs';
import { WorldMatrix, MeshRef, MaterialRef, WaterRef, GrassRef, Visible, SkeletonRef } from '@engine/ecs';
import type { FrameContext } from '@engine/scheduler';
import type { PBRRenderer } from './pbr-pipeline.js';
import type { GPUMesh } from './mesh.js';
import type { PBRMaterial } from './pbr-material.js';
import type { WaterMaterial } from './water-material.js';
import type { GrassMaterial } from './grass-material.js';
import type { SceneLighting } from './pbr-pipeline.js';

export interface RenderRegistries {
  meshes: Map<number, GPUMesh>;
  materials: Map<number, PBRMaterial>;
  waterMaterials?: Map<number, WaterMaterial>;
  grassMaterials?: Map<number, GrassMaterial>;
}

export interface RenderSystemContext {
  renderer: PBRRenderer;
  registries: RenderRegistries;
  getCamera: () => { vp: Float32Array; eye: [number, number, number] };
  getLighting: () => SceneLighting;
  getSkinMatrices?: (entityId: number) => Float32Array | undefined;
  afterMainPass?: (pass: GPURenderPassEncoder) => void;
}

const _mat = new Float32Array(16);
const _planes = new Float32Array(24);
const WM_FIELDS = [
  'm0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7',
  'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15',
] as const;

/**
 * Create the PBR render system. Returns the query and a system function
 * suitable for `scheduler.addSystem(Phase.RENDER, sys.render)`.
 */
export function createRenderSystem(
  world: World,
  ctx: RenderSystemContext,
): { query: Query; render: (fc: FrameContext) => void } {
  const query = world.query(WorldMatrix, MeshRef, MaterialRef, Visible);
  const waterQuery = world.query(WorldMatrix, MeshRef, WaterRef, Visible);
  const grassQuery = world.query(WorldMatrix, MeshRef, GrassRef, Visible);

  function render(_fc: FrameContext): void {
    const cam = ctx.getCamera();
    ctx.renderer.setCamera(cam.vp, cam.eye);
    ctx.renderer.setLighting(ctx.getLighting());
    ctx.renderer.beginFrame();
    extractFrustumPlanes(cam.vp, _planes);

    query.each((arch, count) => {
      const meshHandles = arch.getColumn(MeshRef, 'handle');
      const matHandles = arch.getColumn(MaterialRef, 'handle');
      const hasSkelRef = arch.hasComponent(SkeletonRef);
      const entityIds = arch.entities.data as Uint32Array;

      const wmCols = WM_FIELDS.map(f => arch.getColumn(WorldMatrix, f));

      for (let i = 0; i < count; i++) {
        const mesh = ctx.registries.meshes.get(meshHandles[i]!);
        const mat = ctx.registries.materials.get(matHandles[i]!);
        if (!mesh || !mat) continue;

        for (let c = 0; c < 16; c++) _mat[c] = wmCols[c]![i]!;
        if (!isMeshVisible(_mat, mesh.boundsMin, mesh.boundsMax, mesh.boundsRadius, _planes)) {
          ctx.renderer.recordCulledMesh(mesh);
          continue;
        }

        if (hasSkelRef && mesh.skinned && ctx.getSkinMatrices) {
          const jointMatrices = ctx.getSkinMatrices(entityIds[i]!);
          if (jointMatrices) {
            ctx.renderer.drawSkinnedMesh(mesh, mat, _mat, jointMatrices);
            continue;
          }
        }

        ctx.renderer.drawMesh(mesh, mat, _mat);
      }
    });

    if (ctx.registries.waterMaterials) {
      waterQuery.each((arch, count) => {
        const meshHandles = arch.getColumn(MeshRef, 'handle');
        const waterHandles = arch.getColumn(WaterRef, 'handle');
        const wmCols = WM_FIELDS.map(f => arch.getColumn(WorldMatrix, f));

        for (let i = 0; i < count; i++) {
          const mesh = ctx.registries.meshes.get(meshHandles[i]!);
          const waterMat = ctx.registries.waterMaterials!.get(waterHandles[i]!);
          if (!mesh || !waterMat) continue;

          for (let c = 0; c < 16; c++) _mat[c] = wmCols[c]![i]!;
          if (!isMeshVisible(_mat, mesh.boundsMin, mesh.boundsMax, mesh.boundsRadius, _planes)) {
            ctx.renderer.recordCulledMesh(mesh);
            continue;
          }

          ctx.renderer.drawWaterMesh(mesh, waterMat, _mat);
        }
      });
    }

    if (ctx.registries.grassMaterials) {
      grassQuery.each((arch, count) => {
        const meshHandles = arch.getColumn(MeshRef, 'handle');
        const grassHandles = arch.getColumn(GrassRef, 'handle');
        const wmCols = WM_FIELDS.map(f => arch.getColumn(WorldMatrix, f));

        for (let i = 0; i < count; i++) {
          const mesh = ctx.registries.meshes.get(meshHandles[i]!);
          const grassMat = ctx.registries.grassMaterials!.get(grassHandles[i]!);
          if (!mesh || !grassMat) continue;

          for (let c = 0; c < 16; c++) _mat[c] = wmCols[c]![i]!;
          if (!isMeshVisible(_mat, mesh.boundsMin, mesh.boundsMax, mesh.boundsRadius, _planes)) {
            ctx.renderer.recordCulledMesh(mesh);
            continue;
          }

          ctx.renderer.drawGrassMesh(mesh, grassMat, _mat);
        }
      });
    }

    ctx.renderer.endFrame(ctx.afterMainPass);
  }

  return { query, render };
}

function isMeshVisible(
  model: Float32Array,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
  radius: number,
  planes: Float32Array,
): boolean {
  const lx = (boundsMin[0] + boundsMax[0]) * 0.5;
  const ly = (boundsMin[1] + boundsMax[1]) * 0.5;
  const lz = (boundsMin[2] + boundsMax[2]) * 0.5;
  const cx = model[0]! * lx + model[4]! * ly + model[8]! * lz + model[12]!;
  const cy = model[1]! * lx + model[5]! * ly + model[9]! * lz + model[13]!;
  const cz = model[2]! * lx + model[6]! * ly + model[10]! * lz + model[14]!;
  const sx = Math.hypot(model[0]!, model[1]!, model[2]!);
  const sy = Math.hypot(model[4]!, model[5]!, model[6]!);
  const sz = Math.hypot(model[8]!, model[9]!, model[10]!);
  const scaledRadius = radius * Math.max(sx, sy, sz, 1);
  for (let i = 0; i < 6; i++) {
    const offset = i * 4;
    const distance =
      planes[offset]! * cx +
      planes[offset + 1]! * cy +
      planes[offset + 2]! * cz +
      planes[offset + 3]!;
    if (distance < -scaledRadius) return false;
  }
  return true;
}

function extractFrustumPlanes(vp: Float32Array, out: Float32Array): void {
  setPlane(out, 0, vp[3]! + vp[0]!, vp[7]! + vp[4]!, vp[11]! + vp[8]!, vp[15]! + vp[12]!);
  setPlane(out, 4, vp[3]! - vp[0]!, vp[7]! - vp[4]!, vp[11]! - vp[8]!, vp[15]! - vp[12]!);
  setPlane(out, 8, vp[3]! + vp[1]!, vp[7]! + vp[5]!, vp[11]! + vp[9]!, vp[15]! + vp[13]!);
  setPlane(out, 12, vp[3]! - vp[1]!, vp[7]! - vp[5]!, vp[11]! - vp[9]!, vp[15]! - vp[13]!);
  setPlane(out, 16, vp[3]! + vp[2]!, vp[7]! + vp[6]!, vp[11]! + vp[10]!, vp[15]! + vp[14]!);
  setPlane(out, 20, vp[3]! - vp[2]!, vp[7]! - vp[6]!, vp[11]! - vp[10]!, vp[15]! - vp[14]!);
}

function setPlane(out: Float32Array, offset: number, a: number, b: number, c: number, d: number): void {
  const len = Math.hypot(a, b, c) || 1;
  out[offset] = a / len;
  out[offset + 1] = b / len;
  out[offset + 2] = c / len;
  out[offset + 3] = d / len;
}

/**
 * ECS-driven PBR render system.
 *
 * Queries all entities with WorldMatrix + MeshRef + MaterialRef + Visible,
 * reads their world matrix, and issues drawMesh calls on the PBRRenderer.
 */

import type { World, Query } from '@engine/ecs';
import { WorldMatrix, MeshRef, MaterialRef, Visible } from '@engine/ecs';
import type { FrameContext } from '@engine/scheduler';
import type { PBRRenderer } from './pbr-pipeline.js';
import type { GPUMesh } from './mesh.js';
import type { PBRMaterial } from './pbr-material.js';
import type { SceneLighting } from './pbr-pipeline.js';

export interface RenderRegistries {
  meshes: Map<number, GPUMesh>;
  materials: Map<number, PBRMaterial>;
}

export interface RenderSystemContext {
  renderer: PBRRenderer;
  registries: RenderRegistries;
  getCamera: () => { vp: Float32Array; eye: [number, number, number] };
  getLighting: () => SceneLighting;
}

const _mat = new Float32Array(16);
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

  function render(_fc: FrameContext): void {
    const cam = ctx.getCamera();
    ctx.renderer.setCamera(cam.vp, cam.eye);
    ctx.renderer.setLighting(ctx.getLighting());
    ctx.renderer.beginFrame();

    query.each((arch, count) => {
      const meshHandles = arch.getColumn(MeshRef, 'handle');
      const matHandles = arch.getColumn(MaterialRef, 'handle');

      const wmCols = WM_FIELDS.map(f => arch.getColumn(WorldMatrix, f));

      for (let i = 0; i < count; i++) {
        const mesh = ctx.registries.meshes.get(meshHandles[i]!);
        const mat = ctx.registries.materials.get(matHandles[i]!);
        if (!mesh || !mat) continue;

        for (let c = 0; c < 16; c++) _mat[c] = wmCols[c]![i]!;
        ctx.renderer.drawMesh(mesh, mat, _mat);
      }
    });

    ctx.renderer.endFrame();
  }

  return { query, render };
}

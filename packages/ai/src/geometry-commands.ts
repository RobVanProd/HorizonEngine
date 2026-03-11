import type { Engine } from '@engine/core';
import type { CommandRouter } from './command-router.js';

export function registerGeometryCommands(router: CommandRouter, engine: Engine): void {
  router.register({
    action: 'geometry.getStats',
    description: 'Inspect renderer geometry scalability stats and per-mesh meshlet counts',
    params: {},
  }, () => {
    const meshes = [...engine.meshes.entries()].map(([handle, mesh]) => ({
      handle,
      triangles: mesh.triangleCount,
      meshlets: mesh.meshletCount,
      radius: mesh.boundsRadius,
    }));
    return {
      ok: true,
      data: {
        frame: engine.pbrRenderer.frameStats,
        meshes,
      },
    };
  });
}

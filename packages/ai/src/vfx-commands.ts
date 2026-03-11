import type { Engine } from '@engine/core';
import { LocalTransform, WorldMatrix } from '@engine/ecs';
import { EmitterFlags, ParticleEmitter, getEffectsRuntime } from '@engine/effects';
import type { CommandRouter } from './command-router.js';

export function registerVfxCommands(router: CommandRouter, engine: Engine): void {
  const runtime = getEffectsRuntime(engine);

  router.register({
    action: 'vfx.createEmitter',
    description: 'Create a particle emitter with optional spline/terrain/biome awareness',
    params: {
      position: { type: 'array', description: '[x, y, z] emitter position', items: { type: 'number' } },
      rate: { type: 'number', description: 'Particles per second', default: 12 },
      lifetime: { type: 'number', description: 'Particle lifetime in seconds', default: 2.5 },
      speed: { type: 'number', description: 'Initial upward speed', default: 0.8 },
      spread: { type: 'number', description: 'Radial velocity spread', default: 0.25 },
      size: { type: 'number', description: 'Billboard size', default: 0.18 },
      color: { type: 'array', description: '[r, g, b, a] particle color', items: { type: 'number' } },
      maxParticles: { type: 'number', description: 'Maximum live particles', default: 256 },
      additive: { type: 'boolean', description: 'Use additive blending' },
      splineEntityId: { type: 'number', description: 'Optional spline entity to emit along' },
      terrainEntityId: { type: 'number', description: 'Optional terrain entity to emit across' },
      biomeFilter: { type: 'number', description: 'Optional biome filter when terrain-aware' },
    },
  }, (params) => {
    const pos = (params['position'] as number[] | undefined) ?? [0, 1, 0];
    const color = (params['color'] as number[] | undefined) ?? [1, 0.75, 0.2, 0.6];
    let flags = EmitterFlags.Playing | EmitterFlags.Looping;
    if (params['additive'] !== false) flags |= EmitterFlags.Additive;
    if (params['splineEntityId'] !== undefined) flags |= EmitterFlags.FollowSpline;
    if (params['terrainEntityId'] !== undefined) flags |= EmitterFlags.FollowTerrain;
    if (params['biomeFilter'] !== undefined) flags |= EmitterFlags.BiomeAware;

    const entity = engine.world.spawn();
    entity.add(LocalTransform, {
      px: pos[0] ?? 0,
      py: pos[1] ?? 1,
      pz: pos[2] ?? 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    entity.add(WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
    entity.add(ParticleEmitter, {
      rate: Number(params['rate'] ?? 12),
      lifetime: Number(params['lifetime'] ?? 2.5),
      speed: Number(params['speed'] ?? 0.8),
      spread: Number(params['spread'] ?? 0.25),
      size: Number(params['size'] ?? 0.18),
      maxParticles: Number(params['maxParticles'] ?? 256),
      colorR: color[0] ?? 1,
      colorG: color[1] ?? 0.75,
      colorB: color[2] ?? 0.2,
      colorA: color[3] ?? 0.6,
      flags,
      splineEntity: Number(params['splineEntityId'] ?? 0),
      terrainEntity: Number(params['terrainEntityId'] ?? 0),
      biomeFilter: Number(params['biomeFilter'] ?? 0xffffffff),
    });
    return { ok: true, data: { entityId: entity.id } };
  });

  router.register({
    action: 'vfx.inspectEmitters',
    description: 'Inspect particle emitter counts currently simulated by the VFX runtime',
    params: {},
  }, () => {
    return { ok: true, data: runtime.inspectEmitters() };
  });
}

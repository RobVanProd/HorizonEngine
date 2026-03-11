import { describe, expect, it } from 'vitest';
import { World } from '@engine/ecs';
import { LocalTransform, WorldMatrix } from '@engine/ecs';
import { ParticleEmitter, EmitterFlags } from './components.js';
import { EffectsRuntime } from './runtime.js';

describe('effects runtime', () => {
  it('spawns particles from active emitters', () => {
    const world = new World();
    const engineStub: any = {
      world,
      meshes: new Map(),
      materials: new Map(),
      audioClips: new Map(),
    };
    const entity = world.spawn();
    entity.add(LocalTransform, {
      px: 0, py: 0, pz: 0,
      rotX: 0, rotY: 0, rotZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    entity.add(WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
    entity.add(ParticleEmitter, {
      rate: 20,
      lifetime: 2,
      speed: 1,
      spread: 0.2,
      size: 0.3,
      maxParticles: 64,
      colorR: 1,
      colorG: 0.5,
      colorB: 0.1,
      colorA: 0.8,
      flags: EmitterFlags.Playing | EmitterFlags.Looping,
      splineEntity: 0,
      terrainEntity: 0,
      biomeFilter: 0xffffffff,
    });

    const runtime = new EffectsRuntime(engineStub);
    runtime.update(0.5);
    const buckets = runtime.getBuckets();
    expect(buckets.alpha.length + buckets.additive.length).toBeGreaterThan(0);
  });
});

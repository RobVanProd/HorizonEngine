import { defineComponent } from '@engine/ecs';
import { FieldType } from '@engine/memory';

export const enum EmitterFlags {
  Playing = 1 << 0,
  Looping = 1 << 1,
  Additive = 1 << 2,
  FollowSpline = 1 << 3,
  FollowTerrain = 1 << 4,
  BiomeAware = 1 << 5,
}

export const ParticleEmitter = defineComponent('ParticleEmitter', {
  rate: FieldType.F32,
  lifetime: FieldType.F32,
  speed: FieldType.F32,
  spread: FieldType.F32,
  size: FieldType.F32,
  maxParticles: FieldType.U32,
  colorR: FieldType.F32,
  colorG: FieldType.F32,
  colorB: FieldType.F32,
  colorA: FieldType.F32,
  flags: FieldType.U32,
  splineEntity: FieldType.U32,
  terrainEntity: FieldType.U32,
  biomeFilter: FieldType.U32,
});

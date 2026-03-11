import type { Engine } from '@engine/core';
import { LocalTransform } from '@engine/ecs';
import { getWorldRegistry, sampleSpline, type SplinePoint } from '@engine/world';
import { EmitterFlags, ParticleEmitter } from './components.js';

export interface Particle {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  color: [number, number, number, number];
  additive: boolean;
}

export interface ParticleBuckets {
  alpha: Particle[];
  additive: Particle[];
}

export class EffectsRuntime {
  private _engine: Engine;
  private _particles = new Map<number, Particle[]>();
  private _spawnCarry = new Map<number, number>();

  constructor(engine: Engine) {
    this._engine = engine;
  }

  update(dt: number): void {
    const world = this._engine.world;
    const registry = getWorldRegistry(this._engine);
    const query = world.query(LocalTransform, ParticleEmitter);

    query.each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      const px = arch.getColumn(LocalTransform, 'px') as Float32Array;
      const py = arch.getColumn(LocalTransform, 'py') as Float32Array;
      const pz = arch.getColumn(LocalTransform, 'pz') as Float32Array;
      const rate = arch.getColumn(ParticleEmitter, 'rate') as Float32Array;
      const lifetime = arch.getColumn(ParticleEmitter, 'lifetime') as Float32Array;
      const speed = arch.getColumn(ParticleEmitter, 'speed') as Float32Array;
      const spread = arch.getColumn(ParticleEmitter, 'spread') as Float32Array;
      const size = arch.getColumn(ParticleEmitter, 'size') as Float32Array;
      const maxParticles = arch.getColumn(ParticleEmitter, 'maxParticles') as Uint32Array;
      const colorR = arch.getColumn(ParticleEmitter, 'colorR') as Float32Array;
      const colorG = arch.getColumn(ParticleEmitter, 'colorG') as Float32Array;
      const colorB = arch.getColumn(ParticleEmitter, 'colorB') as Float32Array;
      const colorA = arch.getColumn(ParticleEmitter, 'colorA') as Float32Array;
      const flags = arch.getColumn(ParticleEmitter, 'flags') as Uint32Array;
      const splineEntity = arch.getColumn(ParticleEmitter, 'splineEntity') as Uint32Array;
      const terrainEntity = arch.getColumn(ParticleEmitter, 'terrainEntity') as Uint32Array;
      const biomeFilter = arch.getColumn(ParticleEmitter, 'biomeFilter') as Uint32Array;

      for (let i = 0; i < count; i++) {
        const entityId = ids[i]!;
        const list = this._particles.get(entityId) ?? [];
        const color: [number, number, number, number] = [
          colorR[i]!,
          colorG[i]!,
          colorB[i]!,
          colorA[i]!,
        ];
        const emitterFlags = flags[i]!;
        const additive = (emitterFlags & EmitterFlags.Additive) !== 0;
        const terrainId = terrainEntity[i]!;
        const splineId = splineEntity[i]!;

        for (let p = list.length - 1; p >= 0; p--) {
          const particle = list[p]!;
          particle.age += dt;
          if (particle.age >= particle.life) {
            list.splice(p, 1);
            continue;
          }
          particle.px += particle.vx * dt;
          particle.py += particle.vy * dt;
          particle.pz += particle.vz * dt;
          particle.vy -= 0.35 * dt;
        }

        if ((emitterFlags & EmitterFlags.Playing) !== 0) {
          const carry = this._spawnCarry.get(entityId) ?? 0;
          const totalToSpawn = carry + rate[i]! * dt;
          const spawnCount = Math.min(
            Math.floor(totalToSpawn),
            Math.max(0, maxParticles[i]! - list.length),
          );
          this._spawnCarry.set(entityId, totalToSpawn - spawnCount);

          for (let spawnIndex = 0; spawnIndex < spawnCount; spawnIndex++) {
            const origin = this._resolveSpawnOrigin(
              entityId,
              [px[i]!, py[i]!, pz[i]!],
              emitterFlags,
              splineId,
              terrainId,
              biomeFilter[i]!,
              registry,
            );
            const theta = (hash(entityId, spawnIndex, list.length) % 6283) / 1000;
            const radial = (hash(entityId + 17, spawnIndex, list.length) % 1000) / 1000 * spread[i]!;
            list.push({
              px: origin[0],
              py: origin[1],
              pz: origin[2],
              vx: Math.cos(theta) * radial,
              vy: speed[i]!,
              vz: Math.sin(theta) * radial,
              age: 0,
              life: lifetime[i]!,
              size: size[i]!,
              color,
              additive,
            });
          }
        }

        this._particles.set(entityId, list);
      }
    });
  }

  getBuckets(): ParticleBuckets {
    const alpha: Particle[] = [];
    const additive: Particle[] = [];
    for (const particles of this._particles.values()) {
      for (const particle of particles) {
        (particle.additive ? additive : alpha).push(particle);
      }
    }
    return { alpha, additive };
  }

  inspectEmitters(): Array<{ entityId: number; count: number }> {
    return [...this._particles.entries()].map(([entityId, particles]) => ({
      entityId,
      count: particles.length,
    }));
  }

  private _resolveSpawnOrigin(
    entityId: number,
    fallback: [number, number, number],
    flags: number,
    splineEntity: number,
    terrainEntity: number,
    biomeFilter: number,
    registry: ReturnType<typeof getWorldRegistry>,
  ): [number, number, number] {
    if ((flags & EmitterFlags.FollowSpline) !== 0 && splineEntity !== 0) {
      const points = registry.readSpline(splineEntity);
      if (points.length > 1) {
        const t = (hash(entityId, splineEntity, points.length) % 1000) / 1000;
        return sampleSpline(points, t).position;
      }
    }

    if ((flags & EmitterFlags.FollowTerrain) !== 0 && terrainEntity !== 0) {
      const terrain = registry.terrains.get(terrainEntity);
      if (terrain) {
        const field = terrain.heightfield;
        for (let attempts = 0; attempts < 8; attempts++) {
          const hx = hash(entityId + attempts, terrainEntity, field.width) % field.width;
          const hz = hash(entityId + attempts * 13, terrainEntity, field.depth) % field.depth;
          const biomeId = field.biomeIds[hz * field.width + hx]!;
          if ((flags & EmitterFlags.BiomeAware) !== 0 && biomeFilter !== 0xffffffff && biomeId !== biomeFilter) {
            continue;
          }
          return [
            field.originX + hx * field.cellSize,
            field.heights[hz * field.width + hx]! + 0.2,
            field.originZ + hz * field.cellSize,
          ];
        }
      }
    }

    return fallback;
  }
}

const RUNTIMES = new WeakMap<Engine, EffectsRuntime>();

export function getEffectsRuntime(engine: Engine): EffectsRuntime {
  let runtime = RUNTIMES.get(engine);
  if (!runtime) {
    runtime = new EffectsRuntime(engine);
    RUNTIMES.set(engine, runtime);
  }
  return runtime;
}

function hash(a: number, b: number, c: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

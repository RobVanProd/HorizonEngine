import { describe, it, expect, beforeEach } from 'vitest';
import { FieldType } from '@engine/memory';
import { World, defineComponent, resetComponentIdCounter } from './index.js';

const Position = defineComponent('Position', {
  x: FieldType.F32,
  y: FieldType.F32,
  z: FieldType.F32,
});

const Velocity = defineComponent('Velocity', {
  x: FieldType.F32,
  y: FieldType.F32,
  z: FieldType.F32,
});

const Health = defineComponent('Health', {
  current: FieldType.F32,
  max: FieldType.F32,
});

describe('World', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  it('should spawn entities', () => {
    const e1 = world.spawn().id;
    const e2 = world.spawn().id;
    expect(world.entityCount).toBe(2);
    expect(world.has(e1)).toBe(true);
    expect(world.has(e2)).toBe(true);
  });

  it('should add components and read fields', () => {
    const e = world.spawn()
      .add(Position, { x: 10, y: 20, z: 30 })
      .id;

    expect(world.hasComponent(e, Position)).toBe(true);
    expect(world.getField(e, Position, 'x')).toBeCloseTo(10);
    expect(world.getField(e, Position, 'y')).toBeCloseTo(20);
    expect(world.getField(e, Position, 'z')).toBeCloseTo(30);
  });

  it('should handle multiple components', () => {
    const e = world.spawn()
      .add(Position, { x: 1, y: 2, z: 3 })
      .add(Velocity, { x: 4, y: 5, z: 6 })
      .id;

    expect(world.hasComponent(e, Position)).toBe(true);
    expect(world.hasComponent(e, Velocity)).toBe(true);
    expect(world.getField(e, Position, 'x')).toBeCloseTo(1);
    expect(world.getField(e, Velocity, 'x')).toBeCloseTo(4);
  });

  it('should destroy entities', () => {
    const e1 = world.spawn().add(Position, { x: 1, y: 0, z: 0 }).id;
    const e2 = world.spawn().add(Position, { x: 2, y: 0, z: 0 }).id;

    expect(world.destroy(e1)).toBe(true);
    expect(world.entityCount).toBe(1);
    expect(world.has(e1)).toBe(false);
    expect(world.has(e2)).toBe(true);
    expect(world.getField(e2, Position, 'x')).toBeCloseTo(2);
  });

  it('should remove components', () => {
    const e = world.spawn()
      .add(Position, { x: 10, y: 20, z: 30 })
      .add(Velocity, { x: 1, y: 0, z: 0 })
      .id;

    world.removeComponent(e, Velocity);
    expect(world.hasComponent(e, Velocity)).toBe(false);
    expect(world.hasComponent(e, Position)).toBe(true);
    expect(world.getField(e, Position, 'x')).toBeCloseTo(10);
  });

  it('should batch-spawn entities', () => {
    const ids = world.spawnBatch(1000, [Position, Velocity]);
    expect(ids.length).toBe(1000);
    expect(world.entityCount).toBe(1000);
  });

  it('should query entities by component', () => {
    world.spawn().add(Position, { x: 1, y: 0, z: 0 });
    world.spawn().add(Position, { x: 2, y: 0, z: 0 }).add(Velocity, { x: 0, y: 0, z: 0 });
    world.spawn().add(Velocity, { x: 3, y: 0, z: 0 });

    const posOnly = world.query(Position);
    const posVel = world.query(Position, Velocity);
    const velOnly = world.query(Velocity);

    expect(posOnly.entityCount).toBe(2);
    expect(posVel.entityCount).toBe(1);
    expect(velOnly.entityCount).toBe(2);
  });

  it('should iterate query archetypes with typed arrays', () => {
    const ids = world.spawnBatch(100, [Position, Velocity]);
    for (let i = 0; i < ids.length; i++) {
      world.setField(ids[i]!, Position, 'x', i);
      world.setField(ids[i]!, Velocity, 'x', 1);
    }

    const q = world.query(Position, Velocity);
    const dt = 1 / 60;

    q.each((arch, count) => {
      const px = arch.getColumn(Position, 'x');
      const vx = arch.getColumn(Velocity, 'x');
      for (let i = 0; i < count; i++) {
        px[i] += vx[i]! * dt;
      }
    });

    expect(world.getField(ids[0]!, Position, 'x')).toBeCloseTo(0 + dt);
    expect(world.getField(ids[50]!, Position, 'x')).toBeCloseTo(50 + dt);
  });
});

import { describe, expect, it } from 'vitest';
import type { Engine } from '@engine/core';
import {
  AudioSource,
  AnimationPlayer,
  HierarchyDepth,
  LocalTransform,
  Parent,
  Visible,
  World,
  WorldMatrix,
} from '@engine/ecs';
import { SceneSerializer } from './scene-serializer.js';

function createEngineStub(): { engine: Engine; world: World } {
  const world = new World();
  const engine = { world } as Engine;
  return { engine, world };
}

function identityWorldMatrix() {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

describe('SceneSerializer', () => {
  it('serializes stable parent ids and skips transient runtime fields', () => {
    const { engine, world } = createEngineStub();
    const serializer = new SceneSerializer(engine);

    const root = world.spawn().id;
    world.addComponent(root, LocalTransform, {
      px: 1, py: 2, pz: 3,
      rotX: 0.1, rotY: 0.2, rotZ: 0.3,
      scaleX: 1, scaleY: 2, scaleZ: 3,
    });
    world.addComponent(root, WorldMatrix, identityWorldMatrix());
    world.addComponent(root, Visible, { _tag: 1 });
    world.addComponent(root, AnimationPlayer, {
      clipHandle: 7,
      time: 9.5,
      speed: 1.25,
      flags: 3,
    });

    const child = world.spawn().id;
    world.addComponent(child, LocalTransform, {
      px: 4, py: 5, pz: 6,
      rotX: 0.4, rotY: 0.5, rotZ: 0.6,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    world.addComponent(child, Parent, { entity: root });
    world.addComponent(child, HierarchyDepth, { depth: 1 });
    world.addComponent(child, WorldMatrix, identityWorldMatrix());
    world.addComponent(child, AudioSource, {
      clipHandle: 11,
      soundId: 99,
      volume: 0.8,
      refDistance: 1,
      maxDistance: 20,
      rolloff: 1,
      flags: 5,
    });

    const scene = serializer.serialize('Test');
    expect(scene.entities).toHaveLength(2);

    const rootEntity = scene.entities.find((entity) => entity.id === root);
    const childEntity = scene.entities.find((entity) => entity.id === child);
    expect(rootEntity?.components['AnimationPlayer']).toEqual({
      clipHandle: 7,
      speed: 1.25,
      flags: 3,
    });
    expect(childEntity?.parentId).toBe(root);
    expect(childEntity?.components['AudioSource']?.['clipHandle']).toBe(11);
    expect(childEntity?.components['AudioSource']?.['volume']).toBeCloseTo(0.8);
    expect(childEntity?.components['AudioSource']?.['refDistance']).toBe(1);
    expect(childEntity?.components['AudioSource']?.['maxDistance']).toBe(20);
    expect(childEntity?.components['AudioSource']?.['rolloff']).toBe(1);
    expect(childEntity?.components['AudioSource']?.['flags']).toBe(5);
  });

  it('replace-loads scenes with parent remap and runtime support components', () => {
    const { engine, world } = createEngineStub();
    const serializer = new SceneSerializer(engine);

    const root = world.spawn().id;
    world.addComponent(root, LocalTransform, {
      px: 0, py: 1, pz: 2,
      rotX: 0.2, rotY: 0.4, rotZ: 0.6,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    world.addComponent(root, WorldMatrix, identityWorldMatrix());
    world.addComponent(root, Visible, { _tag: 1 });

    const child = world.spawn().id;
    world.addComponent(child, LocalTransform, {
      px: 2, py: 3, pz: 4,
      rotX: 0.1, rotY: 0.3, rotZ: 0.5,
      scaleX: 2, scaleY: 2, scaleZ: 2,
    });
    world.addComponent(child, Parent, { entity: root });
    world.addComponent(child, HierarchyDepth, { depth: 1 });
    world.addComponent(child, WorldMatrix, identityWorldMatrix());

    const scene = serializer.serialize('RoundTrip');

    const extra = world.spawn().id;
    world.addComponent(extra, LocalTransform, {
      px: 9, py: 9, pz: 9,
      rotX: 0, rotY: 0, rotZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    world.addComponent(extra, WorldMatrix, identityWorldMatrix());

    serializer.deserialize(scene, { replace: true });

    expect(world.has(root)).toBe(false);
    expect(world.has(child)).toBe(false);
    expect(world.has(extra)).toBe(false);
    expect(world.entityCount).toBe(2);

    const loadedIds: number[] = [];
    world.query(LocalTransform).each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) loadedIds.push(ids[i]!);
    });

    const loadedRoot = loadedIds.find((id) => world.getField(id, LocalTransform, 'pz') === 2);
    const loadedChild = loadedIds.find((id) => world.getField(id, LocalTransform, 'pz') === 4);
    expect(loadedRoot).toBeDefined();
    expect(loadedChild).toBeDefined();
    expect(loadedRoot).not.toBe(root);
    expect(loadedChild).not.toBe(child);

    expect(world.hasComponent(loadedRoot!, WorldMatrix)).toBe(true);
    expect(world.hasComponent(loadedChild!, WorldMatrix)).toBe(true);
    expect(world.hasComponent(loadedChild!, Parent)).toBe(true);
    expect(world.hasComponent(loadedChild!, HierarchyDepth)).toBe(true);
    expect(world.getField(loadedChild!, Parent, 'entity')).toBe(loadedRoot);
    expect(world.getField(loadedChild!, HierarchyDepth, 'depth')).toBe(1);
    expect(world.getField(loadedRoot!, LocalTransform, 'rotX')).toBeCloseTo(0.2);
    expect(world.getField(loadedRoot!, LocalTransform, 'rotZ')).toBeCloseTo(0.6);
  });
});

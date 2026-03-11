import { describe, it, expect, beforeEach } from 'vitest';
import { FieldType } from '@engine/memory';
import { World, defineComponent, CommandBuffer } from './index.js';

const Position = defineComponent('CmdPos', {
  x: FieldType.F32,
  y: FieldType.F32,
});

const Tag = defineComponent('CmdTag', {
  value: FieldType.U32,
});

describe('CommandBuffer', () => {
  let world: World;
  let cmd: CommandBuffer;

  beforeEach(() => {
    world = new World();
    cmd = new CommandBuffer();
  });

  it('should defer and flush spawn commands', () => {
    cmd.spawn([Position], { x: 10, y: 20 });
    cmd.spawn([Position], { x: 30, y: 40 });
    expect(world.entityCount).toBe(0);

    cmd.flush(world);
    expect(world.entityCount).toBe(2);
  });

  it('should defer and flush destroy commands', () => {
    const e = world.spawn().add(Position, { x: 1, y: 2 }).id;
    expect(world.entityCount).toBe(1);

    cmd.destroy(e);
    expect(world.entityCount).toBe(1);

    cmd.flush(world);
    expect(world.entityCount).toBe(0);
  });

  it('should defer addComponent', () => {
    const e = world.spawn().add(Position, { x: 1, y: 2 }).id;
    expect(world.hasComponent(e, Tag)).toBe(false);

    cmd.addComponent(e, Tag, { value: 42 });
    cmd.flush(world);
    expect(world.hasComponent(e, Tag)).toBe(true);
    expect(world.getField(e, Tag, 'value')).toBe(42);
  });

  it('should defer removeComponent', () => {
    const e = world.spawn().add(Position, { x: 1, y: 2 }).add(Tag, { value: 5 }).id;
    cmd.removeComponent(e, Tag);
    cmd.flush(world);
    expect(world.hasComponent(e, Tag)).toBe(false);
    expect(world.hasComponent(e, Position)).toBe(true);
  });

  it('should report command count and clear after flush', () => {
    cmd.spawn([Position]);
    cmd.spawn([Position]);
    cmd.destroy(999);
    expect(cmd.length).toBe(3);

    cmd.flush(world);
    expect(cmd.length).toBe(0);
  });
});

import type { Engine } from '@engine/core';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener, Parent,
} from '@engine/ecs';
import type { ComponentDef } from '@engine/ecs';
import type { CommandRouter } from './command-router.js';

const COMPONENT_MAP: Record<string, ComponentDef> = {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener, Parent,
};

/**
 * Registers advanced scene manipulation commands.
 */
export function registerAdvancedCommands(router: CommandRouter, engine: Engine): void {
  const world = engine.world;

  // ─── scene.getHierarchy ───────────────────────────────────────
  router.register(
    {
      action: 'scene.getHierarchy',
      description: 'Get the full scene hierarchy as a tree of entity IDs with parent/child relationships',
      params: {
        rootOnly: { type: 'boolean', description: 'Only return root entities (no parent)', default: false },
      },
    },
    (params) => {
      const rootOnly = (params['rootOnly'] as boolean) ?? false;
      const parentQuery = world.query(Parent);
      const childOf = new Map<number, number>();
      const children = new Map<number, number[]>();

      parentQuery.each((arch, count) => {
        const parentCol = arch.getColumn(Parent, 'entity') as Uint32Array;
        const ids = arch.entities.data as Uint32Array;
        for (let i = 0; i < count; i++) {
          const childId = ids[i]!;
          const parentId = parentCol[i]!;
          childOf.set(childId, parentId);
          if (!children.has(parentId)) children.set(parentId, []);
          children.get(parentId)!.push(childId);
        }
      });

      // Collect all entity IDs
      const allIds = new Set<number>();
      const visQ = world.query(Visible);
      visQ.each((arch, count) => {
        const ids = arch.entities.data as Uint32Array;
        for (let i = 0; i < count; i++) allIds.add(ids[i]!);
      });
      for (const [c, p] of childOf) { allIds.add(c); allIds.add(p); }

      interface TreeNode { id: number; children: TreeNode[] }

      function buildTree(id: number): TreeNode {
        const childIds = children.get(id) ?? [];
        return { id, children: childIds.map(c => buildTree(c)) };
      }

      const roots = Array.from(allIds).filter(id => !childOf.has(id) && world.has(id));
      const tree = rootOnly
        ? roots.map(id => ({ id, children: [] as TreeNode[] }))
        : roots.map(id => buildTree(id));

      return { ok: true, data: { rootCount: roots.length, totalEntities: allIds.size, hierarchy: tree } };
    },
  );

  // ─── scene.addComponent ───────────────────────────────────────
  router.register(
    {
      action: 'scene.addComponent',
      description: 'Add a component to an entity by component name',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        component: { type: 'string', required: true, description: 'Component name (e.g. "Visible", "MeshRef")' },
        values: { type: 'object', description: 'Initial field values' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };

      const compName = params['component'] as string;
      const comp = COMPONENT_MAP[compName];
      if (!comp) return { ok: false, error: `Unknown component: ${compName}. Available: ${Object.keys(COMPONENT_MAP).join(', ')}` };

      const values = (params['values'] as Record<string, number>) ?? {};
      world.addComponent(id, comp, values);
      return { ok: true, data: { entityId: id, added: compName } };
    },
  );

  // ─── scene.removeComponent ────────────────────────────────────
  router.register(
    {
      action: 'scene.removeComponent',
      description: 'Remove a component from an entity by component name',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        component: { type: 'string', required: true, description: 'Component name to remove' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };

      const compName = params['component'] as string;
      const comp = COMPONENT_MAP[compName];
      if (!comp) return { ok: false, error: `Unknown component: ${compName}` };

      world.removeComponent(id, comp);
      return { ok: true, data: { entityId: id, removed: compName } };
    },
  );

  // ─── animation.play ───────────────────────────────────────────
  router.register(
    {
      action: 'animation.play',
      description: 'Start or resume animation on an entity with AnimationPlayer',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        clipHandle: { type: 'number', description: 'Clip handle to play (omit to keep current)' },
        speed: { type: 'number', description: 'Playback speed multiplier', default: 1.0 },
        loop: { type: 'boolean', description: 'Loop the animation', default: true },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      if (!world.hasComponent(id, AnimationPlayer)) {
        return { ok: false, error: `Entity ${id} has no AnimationPlayer` };
      }

      if (params['clipHandle'] !== undefined) {
        world.setField(id, AnimationPlayer, 'clipHandle', params['clipHandle'] as number);
      }
      if (params['speed'] !== undefined) {
        world.setField(id, AnimationPlayer, 'speed', params['speed'] as number);
      }

      let flags = 1; // playing
      if ((params['loop'] as boolean) !== false) flags |= 2; // looping
      world.setField(id, AnimationPlayer, 'flags', flags);
      world.setField(id, AnimationPlayer, 'time', 0);

      return { ok: true, data: { entityId: id, playing: true } };
    },
  );

  // ─── animation.stop ───────────────────────────────────────────
  router.register(
    {
      action: 'animation.stop',
      description: 'Stop animation on an entity',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      if (!world.hasComponent(id, AnimationPlayer)) {
        return { ok: false, error: `Entity ${id} has no AnimationPlayer` };
      }

      world.setField(id, AnimationPlayer, 'flags', 0);
      return { ok: true, data: { entityId: id, playing: false } };
    },
  );

  // ─── animation.list ───────────────────────────────────────────
  router.register(
    {
      action: 'animation.list',
      description: 'List all entities with AnimationPlayer and their current animation state',
      params: {},
    },
    () => {
      const q = world.query(AnimationPlayer);
      const entities: Array<{
        entityId: number;
        clipHandle: number;
        time: number;
        speed: number;
        playing: boolean;
        looping: boolean;
      }> = [];

      q.each((arch, count) => {
        const ids = arch.entities.data as Uint32Array;
        const clips = arch.getColumn(AnimationPlayer, 'clipHandle') as Uint32Array;
        const times = arch.getColumn(AnimationPlayer, 'time') as Float32Array;
        const speeds = arch.getColumn(AnimationPlayer, 'speed') as Float32Array;
        const flags = arch.getColumn(AnimationPlayer, 'flags') as Uint32Array;

        for (let i = 0; i < count; i++) {
          entities.push({
            entityId: ids[i]!,
            clipHandle: clips[i]!,
            time: times[i]!,
            speed: speeds[i]!,
            playing: (flags[i]! & 1) !== 0,
            looping: (flags[i]! & 2) !== 0,
          });
        }
      });

      return { ok: true, data: { count: entities.length, entities } };
    },
  );
}

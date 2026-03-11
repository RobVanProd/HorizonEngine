import type { Engine } from '@engine/core';
import { LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible, Parent, HierarchyDepth } from '@engine/ecs';
import type { CommandResult, CommandSchema } from './types.js';
import type { CommandRouter } from './command-router.js';

interface EntityInfo {
  id: number;
  components: string[];
}

/**
 * Registers scene-manipulation commands onto a CommandRouter.
 * Provides spawn, destroy, transform, material, query, inspect, camera, and lighting commands.
 */
export function registerSceneCommands(router: CommandRouter, engine: Engine): void {
  const world = engine.world;

  // ─── scene.spawn ───────────────────────────────────────────────────
  router.register(
    {
      action: 'scene.spawn',
      description: 'Spawn a new entity with optional position, rotation, scale, and visibility',
      params: {
        position: { type: 'array', description: 'XYZ position [x, y, z]', items: { type: 'number' } },
        rotation: { type: 'array', description: 'Euler rotation in radians [x, y, z]', items: { type: 'number' } },
        scale: { type: 'array', description: 'Scale [x, y, z]', items: { type: 'number' } },
        visible: { type: 'boolean', description: 'Whether the entity is visible', default: true },
        meshHandle: { type: 'number', description: 'Mesh handle from engine.meshes registry' },
        materialHandle: { type: 'number', description: 'Material handle from engine.materials registry' },
      },
    },
    (params) => {
      const eb = world.spawn();
      const id = eb.id;

      const pos = params['position'] as number[] | undefined;
      const rot = params['rotation'] as number[] | undefined;
      const scl = params['scale'] as number[] | undefined;

      eb.add(LocalTransform, {
        px: pos?.[0] ?? 0, py: pos?.[1] ?? 0, pz: pos?.[2] ?? 0,
        rotY: rot?.[1] ?? 0,
        scaleX: scl?.[0] ?? 1, scaleY: scl?.[1] ?? 1, scaleZ: scl?.[2] ?? 1,
      });
      eb.add(WorldMatrix);

      if (params['meshHandle'] !== undefined) {
        eb.add(MeshRef, { handle: params['meshHandle'] as number });
      }
      if (params['materialHandle'] !== undefined) {
        eb.add(MaterialRef, { handle: params['materialHandle'] as number });
      }
      if (params['visible'] !== false) {
        eb.add(Visible);
      }

      return { ok: true, data: { entityId: id } };
    },
  );

  // ─── scene.destroy ────────────────────────────────────────────────
  router.register(
    {
      action: 'scene.destroy',
      description: 'Destroy an entity by its ID',
      params: {
        entityId: { type: 'number', description: 'Entity ID to destroy', required: true },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      const ok = world.destroy(id);
      return ok
        ? { ok: true, data: { destroyed: id } }
        : { ok: false, error: `Entity ${id} not found` };
    },
  );

  // ─── scene.setPosition ────────────────────────────────────────────
  router.register(
    {
      action: 'scene.setPosition',
      description: 'Set the position of an entity',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        position: { type: 'array', required: true, description: '[x, y, z]', items: { type: 'number' } },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      const pos = params['position'] as number[];
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      world.setField(id, LocalTransform, 'px', pos[0]!);
      world.setField(id, LocalTransform, 'py', pos[1]!);
      world.setField(id, LocalTransform, 'pz', pos[2]!);
      return { ok: true, data: { entityId: id, position: pos } };
    },
  );

  // ─── scene.setRotation ────────────────────────────────────────────
  router.register(
    {
      action: 'scene.setRotation',
      description: 'Set the rotation of an entity (Euler angles in radians)',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        rotation: { type: 'array', required: true, description: '[rx, ry, rz] radians', items: { type: 'number' } },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      const rot = params['rotation'] as number[];
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      world.setField(id, LocalTransform, 'rotY', rot[1]!);
      return { ok: true, data: { entityId: id, rotation: rot } };
    },
  );

  // ─── scene.setScale ───────────────────────────────────────────────
  router.register(
    {
      action: 'scene.setScale',
      description: 'Set the scale of an entity',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        scale: { type: 'array', required: true, description: '[sx, sy, sz]', items: { type: 'number' } },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      const scl = params['scale'] as number[];
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      world.setField(id, LocalTransform, 'scaleX', scl[0]!);
      world.setField(id, LocalTransform, 'scaleY', scl[1]!);
      world.setField(id, LocalTransform, 'scaleZ', scl[2]!);
      return { ok: true, data: { entityId: id, scale: scl } };
    },
  );

  // ─── scene.setMaterial ────────────────────────────────────────────
  router.register(
    {
      action: 'scene.setMaterial',
      description: 'Update PBR material properties on an entity (albedo, metallic, roughness, emissive)',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        albedo: { type: 'array', description: '[r, g, b, a] in 0-1 range', items: { type: 'number' } },
        metallic: { type: 'number', description: 'Metallic factor 0-1' },
        roughness: { type: 'number', description: 'Roughness factor 0-1' },
        emissive: { type: 'array', description: '[r, g, b] emissive color', items: { type: 'number' } },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      if (!world.hasComponent(id, MaterialRef)) return { ok: false, error: `Entity ${id} has no MaterialRef` };

      const matHandle = world.getField(id, MaterialRef, 'handle');
      const mat = engine.materials.get(matHandle);
      if (!mat) return { ok: false, error: `Material handle ${matHandle} not found in registry` };

      const updates: Record<string, unknown> = {};
      if (params['albedo']) updates['albedo'] = params['albedo'];
      if (params['metallic'] !== undefined) updates['metallic'] = params['metallic'];
      if (params['roughness'] !== undefined) updates['roughness'] = params['roughness'];
      if (params['emissive']) updates['emissive'] = params['emissive'];

      mat.updateParams(updates as Parameters<typeof mat.updateParams>[0]);
      return { ok: true, data: { entityId: id, updated: Object.keys(updates) } };
    },
  );

  // ─── scene.getMaterial ────────────────────────────────────────────
  router.register(
    {
      action: 'scene.getMaterial',
      description: 'Get PBR material properties of an entity',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      if (!world.hasComponent(id, MaterialRef)) return { ok: false, error: `Entity ${id} has no MaterialRef` };

      const matHandle = world.getField(id, MaterialRef, 'handle');
      const mat = engine.materials.get(matHandle);
      if (!mat) return { ok: false, error: `Material handle ${matHandle} not found` };

      return {
        ok: true,
        data: {
          entityId: id,
          albedo: Array.from(mat.albedo),
          metallic: mat.metallic,
          roughness: mat.roughness,
          emissive: Array.from(mat.emissive),
          ao: mat.ao,
        },
      };
    },
  );

  // ─── scene.query ──────────────────────────────────────────────────
  router.register(
    {
      action: 'scene.query',
      description: 'Query entities by component names. Returns matching entity IDs.',
      params: {
        components: { type: 'array', description: 'Component names to filter by (e.g. ["MeshRef", "Visible"])', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max entities to return', default: 100 },
      },
    },
    (params) => {
      const compNames = (params['components'] as string[] | undefined) ?? [];
      const limit = (params['limit'] as number) ?? 100;
      const entities: EntityInfo[] = [];

      const compLookup = getComponentLookup();
      const filterComps = compNames.map(n => compLookup.get(n)).filter(Boolean);

      if (filterComps.length === 0 && compNames.length > 0) {
        return { ok: false, error: `Unknown component(s): ${compNames.join(', ')}` };
      }

      // Use a temporary query or iterate archetypes
      const q = filterComps.length > 0
        ? world.query(...(filterComps as any[]))
        : null;

      if (q) {
        q.each((arch, count) => {
          if (entities.length >= limit) return;
          const ids = arch.entities.data as Uint32Array;
          const archComps = arch.components.map(c => c.name);
          for (let i = 0; i < count && entities.length < limit; i++) {
            entities.push({ id: ids[i]!, components: archComps });
          }
        });
      }

      return { ok: true, data: { count: entities.length, entities } };
    },
  );

  // ─── scene.inspect ────────────────────────────────────────────────
  router.register(
    {
      action: 'scene.inspect',
      description: 'Inspect a specific entity, returning all its component data',
      params: {
        entityId: { type: 'number', required: true, description: 'Entity ID to inspect' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };

      const data: Record<string, Record<string, number>> = {};
      const allComps = getComponentLookup();

      for (const [name, comp] of allComps) {
        if (world.hasComponent(id, comp)) {
          const fields: Record<string, number> = {};
          for (const fieldName of comp.fieldNames) {
            fields[fieldName] = world.getField(id, comp, fieldName);
          }
          data[name] = fields;
        }
      }

      return { ok: true, data: { entityId: id, components: data } };
    },
  );

  // ─── camera.set ───────────────────────────────────────────────────
  router.register(
    {
      action: 'camera.set',
      description: 'Set camera position and look-at target',
      params: {
        eye: { type: 'array', required: true, description: 'Camera position [x, y, z]', items: { type: 'number' } },
        target: { type: 'array', description: 'Look-at target [x, y, z]', items: { type: 'number' } },
      },
    },
    (params) => {
      const eye = params['eye'] as [number, number, number];
      engine.setCamera(engine['_cameraVP'], eye);
      return { ok: true, data: { eye } };
    },
  );

  // ─── camera.get ───────────────────────────────────────────────────
  router.register(
    {
      action: 'camera.get',
      description: 'Get current camera position',
      params: {},
    },
    () => {
      return { ok: true, data: { eye: engine.cameraEye } };
    },
  );

  // ─── lighting.set ─────────────────────────────────────────────────
  router.register(
    {
      action: 'lighting.set',
      description: 'Update scene lighting parameters',
      params: {
        direction: { type: 'array', description: 'Light direction [x, y, z]', items: { type: 'number' } },
        color: { type: 'array', description: 'Light color [r, g, b]', items: { type: 'number' } },
        intensity: { type: 'number', description: 'Light intensity multiplier' },
        ambient: { type: 'array', description: 'Ambient color [r, g, b]', items: { type: 'number' } },
        envIntensity: { type: 'number', description: 'Environment/IBL intensity multiplier' },
      },
    },
    (params) => {
      const l = { ...engine.lighting };
      if (params['direction']) l.direction = params['direction'] as [number, number, number];
      if (params['color']) l.color = params['color'] as [number, number, number];
      if (params['intensity'] !== undefined) l.intensity = params['intensity'] as number;
      if (params['ambient']) l.ambient = params['ambient'] as [number, number, number];
      if (params['envIntensity'] !== undefined) l.envIntensity = params['envIntensity'] as number;
      engine.lighting = l;
      return { ok: true, data: l };
    },
  );

  // ─── lighting.get ─────────────────────────────────────────────────
  router.register(
    {
      action: 'lighting.get',
      description: 'Get current scene lighting parameters',
      params: {},
    },
    () => {
      return { ok: true, data: engine.lighting };
    },
  );
}

// Cached component lookup
let _compLookup: Map<string, any> | null = null;

function getComponentLookup(): Map<string, any> {
  if (_compLookup) return _compLookup;
  _compLookup = new Map();
  _compLookup.set('LocalTransform', LocalTransform);
  _compLookup.set('WorldMatrix', WorldMatrix);
  _compLookup.set('MeshRef', MeshRef);
  _compLookup.set('MaterialRef', MaterialRef);
  _compLookup.set('Visible', Visible);
  _compLookup.set('Parent', Parent);
  _compLookup.set('HierarchyDepth', HierarchyDepth);
  return _compLookup;
}

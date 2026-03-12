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
      description: 'Spawn a new entity with optional position, rotation, scale, visibility, mesh, material, and label',
      params: {
        position: { type: 'array', description: 'XYZ position [x, y, z]', items: { type: 'number' } },
        rotation: { type: 'array', description: 'Euler rotation in radians [x, y, z]', items: { type: 'number' } },
        scale: { type: 'array', description: 'Scale [x, y, z]', items: { type: 'number' } },
        visible: { type: 'boolean', description: 'Whether the entity is visible', default: true },
        meshHandle: { type: 'number', description: 'Mesh handle from engine.meshes registry' },
        materialHandle: { type: 'number', description: 'Material handle from engine.materials registry' },
        label: { type: 'string', description: 'Human-readable label for hierarchy and AI observability' },
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
        rotX: rot?.[0] ?? 0,
        rotY: rot?.[1] ?? 0,
        rotZ: rot?.[2] ?? 0,
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
      const label = params['label'] as string | undefined;
      if (label != null && String(label).trim()) {
        engine.setEntityLabel(id, String(label).trim());
      }

      return { ok: true, data: { entityId: id, label: engine.getEntityLabel(id) ?? undefined } };
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
      world.setField(id, LocalTransform, 'rotX', rot[0]!);
      world.setField(id, LocalTransform, 'rotY', rot[1]!);
      world.setField(id, LocalTransform, 'rotZ', rot[2]!);
      return { ok: true, data: { entityId: id, rotation: rot } };
    },
  );

  // ─── scene.setLabel ───────────────────────────────────────────────
  router.register(
    {
      action: 'scene.setLabel',
      description: 'Set a human-readable label for an entity (for hierarchy and AI observability)',
      params: {
        entityId: { type: 'number', required: true, description: 'Target entity' },
        label: { type: 'string', required: true, description: 'Label text' },
      },
    },
    (params) => {
      const id = params['entityId'] as number;
      const label = String(params['label'] ?? '').trim();
      if (!world.has(id)) return { ok: false, error: `Entity ${id} not found` };
      engine.setEntityLabel(id, label || null);
      return { ok: true, data: { entityId: id, label: engine.getEntityLabel(id) ?? undefined } };
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

  // ─── scene.list ───────────────────────────────────────────────────
  router.register(
    {
      action: 'scene.list',
      description: 'List renderable entities with labels, positions, mesh bounds, and sizes. Use for AI to understand scene contents and generate coherent levels.',
      params: {
        components: { type: 'array', description: 'Filter by component names (e.g. ["MeshRef", "Visible"]). Default: MeshRef, Visible', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max entities to return', default: 200 },
      },
    },
    (params) => {
      const compNames = (params['components'] as string[] | undefined) ?? ['MeshRef', 'Visible'];
      const limit = (params['limit'] as number) ?? 200;
      const compLookup = getComponentLookup();
      const filterComps = compNames.map(n => compLookup.get(n)).filter(Boolean);
      if (filterComps.length === 0 && compNames.length > 0) {
        return { ok: false, error: `Unknown component(s): ${compNames.join(', ')}` };
      }

      const q = filterComps.length > 0 ? world.query(...(filterComps as any[])) : null;
      const items: Array<{
        entityId: number;
        label: string;
        position: [number, number, number];
        scale: [number, number, number];
        meshHandle?: number;
        materialHandle?: number;
        boundsMin?: [number, number, number];
        boundsMax?: [number, number, number];
        triangles?: number;
        radius?: number;
      }> = [];

      if (q) {
        q.each((arch, count) => {
          if (items.length >= limit) return;
          const ids = arch.entities.data as Uint32Array;
          for (let i = 0; i < count && items.length < limit; i++) {
            const id = ids[i]!;
            const label = engine.getEntityLabel(id) ?? `Entity #${id}`;
            let position: [number, number, number] = [0, 0, 0];
            let scale: [number, number, number] = [1, 1, 1];
            let meshHandle: number | undefined;
            let materialHandle: number | undefined;

            if (world.hasComponent(id, LocalTransform)) {
              position = [
                world.getField(id, LocalTransform, 'px'),
                world.getField(id, LocalTransform, 'py'),
                world.getField(id, LocalTransform, 'pz'),
              ];
              scale = [
                world.getField(id, LocalTransform, 'scaleX'),
                world.getField(id, LocalTransform, 'scaleY'),
                world.getField(id, LocalTransform, 'scaleZ'),
              ];
            }
            if (world.hasComponent(id, MeshRef)) {
              meshHandle = world.getField(id, MeshRef, 'handle');
            }
            if (world.hasComponent(id, MaterialRef)) {
              materialHandle = world.getField(id, MaterialRef, 'handle');
            }

            const entry: (typeof items)[0] = { entityId: id, label, position, scale };
            if (meshHandle !== undefined) {
              entry.meshHandle = meshHandle;
              const mesh = engine.meshes.get(meshHandle);
              if (mesh) {
                entry.boundsMin = [mesh.boundsMin[0], mesh.boundsMin[1], mesh.boundsMin[2]];
                entry.boundsMax = [mesh.boundsMax[0], mesh.boundsMax[1], mesh.boundsMax[2]];
                entry.triangles = mesh.triangleCount;
                entry.radius = mesh.boundsRadius;
              }
            }
            if (materialHandle !== undefined) entry.materialHandle = materialHandle;
            items.push(entry);
          }
        });
      }

      return { ok: true, data: { count: items.length, entities: items } };
    },
  );

  router.register(
    {
      action: 'scene.layoutSummary',
      description: 'Summarize the current scene layout as top-down bounds, an occupancy heatmap, and the biggest landmarks. Use this when AI needs spatial context rather than raw entity lists.',
      params: {
        gridSize: { type: 'number', description: 'Top-down occupancy grid resolution', default: 12 },
        limit: { type: 'number', description: 'Max renderable entities to sample', default: 5000 },
      },
    },
    (params) => {
      const gridSize = clampInt((params['gridSize'] as number | undefined) ?? 12, 4, 32);
      const limit = clampInt((params['limit'] as number | undefined) ?? 5000, 1, 20000);
      const q = world.query(MeshRef, Visible);
      const entries: Array<{
        entityId: number;
        label: string;
        x: number;
        z: number;
        radius: number;
        triangles: number;
      }> = [];

      q.each((arch, count) => {
        if (entries.length >= limit) return;
        const ids = arch.entities.data as Uint32Array;
        for (let i = 0; i < count && entries.length < limit; i++) {
          const id = ids[i]!;
          const meshHandle = world.getField(id, MeshRef, 'handle');
          const mesh = engine.meshes.get(meshHandle);
          if (!mesh) continue;

          let x = 0;
          let z = 0;
          let scale = 1;
          if (world.hasComponent(id, LocalTransform)) {
            x = world.getField(id, LocalTransform, 'px');
            z = world.getField(id, LocalTransform, 'pz');
            scale = Math.max(
              Math.abs(world.getField(id, LocalTransform, 'scaleX')),
              Math.abs(world.getField(id, LocalTransform, 'scaleY')),
              Math.abs(world.getField(id, LocalTransform, 'scaleZ')),
            );
          }

          entries.push({
            entityId: id,
            label: engine.getEntityLabel(id) ?? `Entity #${id}`,
            x,
            z,
            radius: Math.max(0.25, mesh.boundsRadius * Math.max(scale, 0.01)),
            triangles: mesh.triangleCount,
          });
        }
      });

      if (entries.length === 0) {
        return { ok: true, data: { count: 0, bounds: null, occupancy: [], landmarks: [], labelCounts: [] } };
      }

      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const entry of entries) {
        minX = Math.min(minX, entry.x - entry.radius);
        minZ = Math.min(minZ, entry.z - entry.radius);
        maxX = Math.max(maxX, entry.x + entry.radius);
        maxZ = Math.max(maxZ, entry.z + entry.radius);
      }

      const spanX = Math.max(1e-3, maxX - minX);
      const spanZ = Math.max(1e-3, maxZ - minZ);
      const grid = new Float32Array(gridSize * gridSize);
      const labelCounts = new Map<string, number>();

      for (const entry of entries) {
        labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1);
        const gx = clampInt(Math.floor(((entry.x - minX) / spanX) * gridSize), 0, gridSize - 1);
        const gz = clampInt(Math.floor(((entry.z - minZ) / spanZ) * gridSize), 0, gridSize - 1);
        const weight = 1 + Math.min(entry.radius * 0.2, 6) + Math.min(entry.triangles / 4000, 6);
        grid[gz * gridSize + gx]! += weight;
      }

      let maxWeight = 0;
      for (let i = 0; i < grid.length; i++) maxWeight = Math.max(maxWeight, grid[i]!);
      const occupancy: number[][] = [];
      for (let z = 0; z < gridSize; z++) {
        const row: number[] = [];
        for (let x = 0; x < gridSize; x++) {
          const value = grid[z * gridSize + x]!;
          row.push(maxWeight > 0 ? Number((value / maxWeight).toFixed(3)) : 0);
        }
        occupancy.push(row);
      }

      const landmarks = [...entries]
        .sort((a, b) => (b.triangles + b.radius * 10) - (a.triangles + a.radius * 10))
        .slice(0, 12)
        .map((entry) => ({
          entityId: entry.entityId,
          label: entry.label,
          position: [entry.x, entry.z],
          radius: Number(entry.radius.toFixed(2)),
          triangles: entry.triangles,
        }));

      const labelSummary = [...labelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([label, count]) => ({ label, count }));

      return {
        ok: true,
        data: {
          count: entries.length,
          cameraEye: engine.cameraEye,
          bounds: {
            min: [Number(minX.toFixed(2)), Number(minZ.toFixed(2))],
            max: [Number(maxX.toFixed(2)), Number(maxZ.toFixed(2))],
            size: [Number(spanX.toFixed(2)), Number(spanZ.toFixed(2))],
          },
          occupancy,
          landmarks,
          labelCounts: labelSummary,
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

      const label = engine.getEntityLabel(id);
      return { ok: true, data: { entityId: id, label: label ?? undefined, components: data } };
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
        shadowBias: { type: 'number', description: 'Shadow comparison bias for directional shadows' },
        debugView: { type: 'string', description: 'Lighting debug view', enum: ['lit', 'normals', 'shadow', 'lightComplexity'] },
        pointLights: {
          type: 'array',
          description: 'Point lights [{ position:[x,y,z], color:[r,g,b], intensity, range }]',
          items: {
            type: 'object',
            properties: {
              position: { type: 'array', items: { type: 'number' }, required: true },
              color: { type: 'array', items: { type: 'number' }, required: true },
              intensity: { type: 'number', required: true },
              range: { type: 'number', required: true },
            },
          },
        },
      },
    },
    (params) => {
      const l = { ...engine.lighting };
      if (params['direction']) l.direction = params['direction'] as [number, number, number];
      if (params['color']) l.color = params['color'] as [number, number, number];
      if (params['intensity'] !== undefined) l.intensity = params['intensity'] as number;
      if (params['ambient']) l.ambient = params['ambient'] as [number, number, number];
      if (params['envIntensity'] !== undefined) l.envIntensity = params['envIntensity'] as number;
      if (params['shadowBias'] !== undefined) l.shadowBias = params['shadowBias'] as number;
      if (params['debugView'] !== undefined) l.debugView = params['debugView'] as any;
      if (params['pointLights']) l.pointLights = params['pointLights'] as any;
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

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

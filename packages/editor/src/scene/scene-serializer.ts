import type { Engine } from '@engine/core';
import type { World, ComponentDef } from '@engine/ecs';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  Parent, SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
} from '@engine/ecs';

export interface SerializedEntity {
  id: number;
  components: Record<string, Record<string, number>>;
}

export interface SerializedScene {
  version: 1;
  name: string;
  entities: SerializedEntity[];
  metadata?: Record<string, unknown>;
}

const SERIALIZABLE_COMPONENTS: ComponentDef[] = [
  LocalTransform, MeshRef, MaterialRef, Visible, Parent,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
];

// Skip volatile runtime components
const SKIP_COMPONENTS: ComponentDef[] = [WorldMatrix];

export class SceneSerializer {
  private _engine: Engine;

  constructor(engine: Engine) {
    this._engine = engine;
  }

  serialize(name = 'Untitled'): SerializedScene {
    const world = this._engine.world;
    const entities: SerializedEntity[] = [];

    const allIds = new Set<number>();
    const q = world.query(Visible);
    q.each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) allIds.add(ids[i]!);
    });

    // Also add non-visible entities that have any serializable component
    for (const comp of SERIALIZABLE_COMPONENTS) {
      const cq = world.query(comp);
      cq.each((arch, count) => {
        const ids = arch.entities.data as Uint32Array;
        for (let i = 0; i < count; i++) allIds.add(ids[i]!);
      });
    }

    for (const id of allIds) {
      if (!world.has(id)) continue;
      const components: Record<string, Record<string, number>> = {};

      for (const comp of SERIALIZABLE_COMPONENTS) {
        if (!world.hasComponent(id, comp)) continue;
        const fields: Record<string, number> = {};
        for (const fieldName of comp.fieldNames) {
          fields[fieldName] = world.getField(id, comp, fieldName);
        }
        components[comp.name] = fields;
      }

      if (Object.keys(components).length > 0) {
        entities.push({ id, components });
      }
    }

    return { version: 1, name, entities };
  }

  deserialize(scene: SerializedScene): void {
    const world = this._engine.world;

    const compMap = new Map<string, ComponentDef>();
    for (const comp of SERIALIZABLE_COMPONENTS) compMap.set(comp.name, comp);

    for (const se of scene.entities) {
      const eid = world.spawn().id;

      for (const [compName, fields] of Object.entries(se.components)) {
        const comp = compMap.get(compName);
        if (!comp) continue;

        world.addComponent(eid, comp);
        for (const [fieldName, value] of Object.entries(fields)) {
          if (comp.fieldNames.includes(fieldName as any)) {
            world.setField(eid, comp, fieldName as any, value);
          }
        }
      }
    }
  }

  toJSON(name = 'Untitled'): string {
    return JSON.stringify(this.serialize(name), null, 2);
  }

  fromJSON(json: string): void {
    const scene = JSON.parse(json) as SerializedScene;
    if (scene.version !== 1) throw new Error(`Unsupported scene version: ${scene.version}`);
    this.deserialize(scene);
  }

  downloadScene(name = 'scene'): void {
    const json = this.toJSON(name);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.hscene`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async loadSceneFile(): Promise<void> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.hscene,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return resolve();
        const text = await file.text();
        this.fromJSON(text);
        resolve();
      });
      input.click();
    });
  }
}

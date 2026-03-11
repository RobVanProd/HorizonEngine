import type { ComponentDef, FieldSchema } from './component.js';
import type { World } from './world.js';

const enum CommandType {
  Spawn = 0,
  Destroy = 1,
  AddComponent = 2,
  RemoveComponent = 3,
  SetField = 4,
}

interface SpawnCommand {
  type: CommandType.Spawn;
  components: ComponentDef[];
  values: Map<string, number>;
  outId?: number;
}

interface DestroyCommand {
  type: CommandType.Destroy;
  entityId: number;
}

interface AddComponentCommand {
  type: CommandType.AddComponent;
  entityId: number;
  component: ComponentDef;
  values: Map<string, number>;
}

interface RemoveComponentCommand {
  type: CommandType.RemoveComponent;
  entityId: number;
  component: ComponentDef;
}

interface SetFieldCommand {
  type: CommandType.SetField;
  entityId: number;
  component: ComponentDef;
  fieldName: string;
  value: number;
}

type Command = SpawnCommand | DestroyCommand | AddComponentCommand | RemoveComponentCommand | SetFieldCommand;

/**
 * Deferred command buffer for structural ECS mutations.
 *
 * Systems running in parallel cannot safely spawn/destroy entities or
 * add/remove components (these are structural changes that move data
 * between archetypes). Instead, systems push commands into a CommandBuffer,
 * which is flushed on the main thread at a designated sync point.
 */
export class CommandBuffer {
  private _commands: Command[] = [];

  get length(): number {
    return this._commands.length;
  }

  spawn(components: ComponentDef[], values?: Record<string, number>): void {
    this._commands.push({
      type: CommandType.Spawn,
      components,
      values: new Map(values ? Object.entries(values) : []),
    });
  }

  destroy(entityId: number): void {
    this._commands.push({ type: CommandType.Destroy, entityId });
  }

  addComponent<S extends FieldSchema>(
    entityId: number,
    component: ComponentDef<S>,
    values?: Partial<Record<keyof S, number>>,
  ): void {
    this._commands.push({
      type: CommandType.AddComponent,
      entityId,
      component,
      values: new Map(values ? Object.entries(values) as [string, number][] : []),
    });
  }

  removeComponent(entityId: number, component: ComponentDef): void {
    this._commands.push({ type: CommandType.RemoveComponent, entityId, component });
  }

  setField(entityId: number, component: ComponentDef, fieldName: string, value: number): void {
    this._commands.push({ type: CommandType.SetField, entityId, component, fieldName, value });
  }

  /**
   * Apply all queued commands to the world, then clear the buffer.
   * Must be called from the main thread at a safe sync point.
   */
  flush(world: World): number {
    const count = this._commands.length;
    for (const cmd of this._commands) {
      switch (cmd.type) {
        case CommandType.Spawn: {
          const ids = world.spawnBatch(1, cmd.components);
          cmd.outId = ids[0];
          for (const [key, value] of cmd.values) {
            // key format: "ComponentName.fieldName" or just "fieldName"
            for (const comp of cmd.components) {
              if (comp.fieldNames.includes(key)) {
                world.setField(ids[0]!, comp, key, value);
              }
            }
          }
          break;
        }
        case CommandType.Destroy:
          world.destroy(cmd.entityId);
          break;
        case CommandType.AddComponent: {
          const vals: Record<string, number> = {};
          for (const [k, v] of cmd.values) vals[k] = v;
          world.addComponent(cmd.entityId, cmd.component, vals);
          break;
        }
        case CommandType.RemoveComponent:
          world.removeComponent(cmd.entityId, cmd.component);
          break;
        case CommandType.SetField:
          world.setField(cmd.entityId, cmd.component, cmd.fieldName, cmd.value);
          break;
      }
    }
    this._commands.length = 0;
    return count;
  }

  clear(): void {
    this._commands.length = 0;
  }
}

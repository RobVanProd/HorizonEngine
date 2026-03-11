import { Archetype } from './archetype.js';
import { type ComponentDef, componentMask, type FieldSchema } from './component.js';
import { Query } from './query.js';

interface EntityRecord {
  archetype: Archetype;
  row: number;
}

/**
 * The World is the top-level ECS container.
 * It manages entities, archetypes, and queries.
 */
export class World {
  private _entities: Map<number, EntityRecord> = new Map();
  private _archetypes: Map<bigint, Archetype> = new Map();
  private _queries: Query[] = [];
  private _nextEntityId = 1;
  private _shared: boolean;

  /** Root archetype with no components (for entities awaiting component assignment) */
  private _emptyArchetype: Archetype;

  constructor(options?: { shared?: boolean }) {
    this._shared = options?.shared ?? false;
    this._emptyArchetype = new Archetype(0n, [], this._shared);
    this._archetypes.set(0n, this._emptyArchetype);
  }

  get entityCount(): number {
    return this._entities.size;
  }

  get archetypeCount(): number {
    return this._archetypes.size;
  }

  /**
   * Create a new entity with no components. Returns an EntityBuilder for chaining.
   */
  spawn(): EntityBuilder {
    const id = this._nextEntityId++;
    const row = this._emptyArchetype.append(id);
    this._entities.set(id, { archetype: this._emptyArchetype, row });
    return new EntityBuilder(this, id);
  }

  /**
   * Batch-spawn entities directly into a target archetype.
   * Much faster than spawning + adding components individually.
   */
  spawnBatch(count: number, components: ComponentDef[]): number[] {
    const mask = componentMask(components);
    const archetype = this._getOrCreateArchetype(mask, components);
    const ids: number[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const id = this._nextEntityId++;
      const row = archetype.append(id);
      this._entities.set(id, { archetype, row });
      ids[i] = id;
    }
    return ids;
  }

  /**
   * Destroy an entity, removing it from its archetype.
   */
  destroy(entityId: number): boolean {
    const record = this._entities.get(entityId);
    if (!record) return false;

    const movedEntity = record.archetype.remove(record.row);
    this._entities.delete(entityId);

    if (movedEntity !== -1) {
      const movedRecord = this._entities.get(movedEntity);
      if (movedRecord) {
        movedRecord.row = record.row;
      }
    }
    return true;
  }

  /**
   * Add a component to an entity, moving it to a new archetype.
   */
  addComponent<S extends FieldSchema>(
    entityId: number,
    comp: ComponentDef<S>,
    values?: Partial<Record<keyof S, number>>,
  ): void {
    const record = this._entities.get(entityId);
    if (!record) throw new Error(`Entity ${entityId} not found`);

    const currentArch = record.archetype;
    if (currentArch.hasComponent(comp)) return;

    const newMask = currentArch.mask | (1n << BigInt(comp.id));
    const newComponents = [...currentArch.components, comp];
    const newArch = this._getOrCreateArchetype(newMask, newComponents);

    const newRow = newArch.append(entityId);
    newArch.copyFrom(currentArch, record.row, newRow);

    if (values) {
      for (const fieldName of comp.fieldNames) {
        const val = values[fieldName as keyof S];
        if (val !== undefined) {
          newArch.setField(comp, fieldName, newRow, val);
        }
      }
    }

    const movedEntity = currentArch.remove(record.row);
    if (movedEntity !== -1) {
      const movedRecord = this._entities.get(movedEntity);
      if (movedRecord) movedRecord.row = record.row;
    }

    record.archetype = newArch;
    record.row = newRow;
  }

  /**
   * Remove a component from an entity, moving it to a new archetype.
   */
  removeComponent(entityId: number, comp: ComponentDef): void {
    const record = this._entities.get(entityId);
    if (!record) throw new Error(`Entity ${entityId} not found`);

    const currentArch = record.archetype;
    if (!currentArch.hasComponent(comp)) return;

    const newMask = currentArch.mask & ~(1n << BigInt(comp.id));
    const newComponents = currentArch.components.filter(c => c.id !== comp.id);
    const newArch = this._getOrCreateArchetype(newMask, newComponents);

    const newRow = newArch.append(entityId);
    newArch.copyFrom(currentArch, record.row, newRow);

    const movedEntity = currentArch.remove(record.row);
    if (movedEntity !== -1) {
      const movedRecord = this._entities.get(movedEntity);
      if (movedRecord) movedRecord.row = record.row;
    }

    record.archetype = newArch;
    record.row = newRow;
  }

  /**
   * Read a component field value for an entity.
   */
  getField<S extends FieldSchema>(
    entityId: number,
    comp: ComponentDef<S>,
    fieldName: string & keyof S,
  ): number {
    const record = this._entities.get(entityId);
    if (!record) throw new Error(`Entity ${entityId} not found`);
    return record.archetype.getColumn(comp, fieldName)[record.row] as number;
  }

  /**
   * Write a component field value for an entity.
   */
  setField<S extends FieldSchema>(
    entityId: number,
    comp: ComponentDef<S>,
    fieldName: string & keyof S,
    value: number,
  ): void {
    const record = this._entities.get(entityId);
    if (!record) throw new Error(`Entity ${entityId} not found`);
    record.archetype.setField(comp, fieldName, record.row, value);
  }

  /**
   * Register a query. The query is matched against all existing and future archetypes.
   */
  registerQuery(query: Query): Query {
    this._queries.push(query);
    for (const arch of this._archetypes.values()) {
      query.tryMatch(arch);
    }
    return query;
  }

  /**
   * Create a registered query for the given components.
   */
  query(...components: ComponentDef[]): Query {
    const q = new Query(components);
    return this.registerQuery(q);
  }

  /**
   * Check if an entity exists.
   */
  has(entityId: number): boolean {
    return this._entities.has(entityId);
  }

  /**
   * Check if an entity has a specific component.
   */
  hasComponent(entityId: number, comp: ComponentDef): boolean {
    const record = this._entities.get(entityId);
    return record ? record.archetype.hasComponent(comp) : false;
  }

  private _getOrCreateArchetype(mask: bigint, components: readonly ComponentDef[]): Archetype {
    let arch = this._archetypes.get(mask);
    if (arch) return arch;

    arch = new Archetype(mask, components, this._shared);
    this._archetypes.set(mask, arch);

    for (const query of this._queries) {
      query.tryMatch(arch);
    }
    return arch;
  }
}

/**
 * Fluent builder for adding components to a newly spawned entity.
 */
export class EntityBuilder {
  private _world: World;
  private _id: number;

  constructor(world: World, id: number) {
    this._world = world;
    this._id = id;
  }

  get id(): number {
    return this._id;
  }

  add<S extends FieldSchema>(comp: ComponentDef<S>, values?: Partial<Record<keyof S, number>>): this {
    this._world.addComponent(this._id, comp, values);
    return this;
  }
}

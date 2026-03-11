import { TypedColumn, TYPED_ARRAY_CTOR, type TypedArray } from '@engine/memory';
import type { ComponentDef, FieldSchema } from './component.js';

const DEFAULT_ARCHETYPE_CAPACITY = 64;

export interface ColumnHandle {
  readonly componentId: number;
  readonly fieldName: string;
  readonly column: TypedColumn;
}

/**
 * An Archetype stores all entities that share an identical set of components.
 * Data is stored in Structure-of-Arrays layout: one TypedColumn per field per component.
 */
export class Archetype {
  readonly mask: bigint;
  readonly components: readonly ComponentDef[];

  /** Entity IDs stored in this archetype */
  readonly entities: TypedColumn;

  private _columns: Map<string, TypedColumn> = new Map();
  private _count = 0;

  constructor(mask: bigint, components: readonly ComponentDef[], shared = false) {
    this.mask = mask;
    this.components = components;
    this.entities = new TypedColumn(8 /* F32 repurposed — actually U32 */, DEFAULT_ARCHETYPE_CAPACITY, shared);

    // We'll use a Uint32Array-backed column for entity IDs
    // Overwrite: create proper U32 column
    (this as { entities: TypedColumn }).entities = new TypedColumn(4 /* U32 */, DEFAULT_ARCHETYPE_CAPACITY, shared);

    for (const comp of components) {
      for (let fi = 0; fi < comp.fieldNames.length; fi++) {
        const fieldName = comp.fieldNames[fi]!;
        const fieldType = comp.fieldTypes[fi]!;
        const key = columnKey(comp.id, fieldName);
        this._columns.set(key, new TypedColumn(fieldType, DEFAULT_ARCHETYPE_CAPACITY, shared));
      }
    }
  }

  get count(): number {
    return this._count;
  }

  hasComponent(comp: ComponentDef): boolean {
    return (this.mask & (1n << BigInt(comp.id))) !== 0n;
  }

  /**
   * Get the raw typed array for a specific component field.
   * This is the hot-path accessor used in systems.
   */
  getColumn<S extends FieldSchema>(comp: ComponentDef<S>, fieldName: string & keyof S): TypedArray {
    const col = this._columns.get(columnKey(comp.id, fieldName));
    if (!col) throw new Error(`Column not found: ${comp.name}.${fieldName}`);
    return col.data;
  }

  /**
   * Get all columns for a component as a record of field name -> typed array.
   */
  getColumns<S extends FieldSchema>(comp: ComponentDef<S>): { [K in keyof S]: TypedArray } {
    const result: Record<string, TypedArray> = {};
    for (const fieldName of comp.fieldNames) {
      result[fieldName] = this.getColumn(comp, fieldName);
    }
    return result as { [K in keyof S]: TypedArray };
  }

  /**
   * Append an entity to this archetype. Returns the row index.
   */
  append(entityId: number): number {
    const row = this._count;
    this.entities.push(entityId);
    for (const col of this._columns.values()) {
      col.push(0);
    }
    this._count++;
    return row;
  }

  /**
   * Set a component field value for an entity at the given row.
   */
  setField(comp: ComponentDef, fieldName: string, row: number, value: number): void {
    const col = this._columns.get(columnKey(comp.id, fieldName));
    if (!col) throw new Error(`Column not found: ${comp.name}.${fieldName}`);
    col.set(row, value);
  }

  /**
   * Swap-remove an entity at the given row.
   * Returns the entity ID that was moved into the vacated slot, or -1 if it was the last row.
   */
  remove(row: number): number {
    const last = this._count - 1;
    const movedEntity = row !== last ? (this.entities.data[last] as number) : -1;

    this.entities.swapRemove(row);
    for (const col of this._columns.values()) {
      col.swapRemove(row);
    }
    this._count--;
    return movedEntity;
  }

  /**
   * Copy all component data for one entity from another archetype row.
   * Only copies columns that exist in both archetypes.
   */
  copyFrom(sourceArchetype: Archetype, sourceRow: number, destRow: number): void {
    for (const comp of this.components) {
      if (!sourceArchetype.hasComponent(comp)) continue;
      for (const fieldName of comp.fieldNames) {
        const srcCol = sourceArchetype._columns.get(columnKey(comp.id, fieldName));
        const dstCol = this._columns.get(columnKey(comp.id, fieldName));
        if (srcCol && dstCol) {
          dstCol.set(destRow, srcCol.data[sourceRow] as number);
        }
      }
    }
  }
}

function columnKey(componentId: number, fieldName: string): string {
  return `${componentId}:${fieldName}`;
}

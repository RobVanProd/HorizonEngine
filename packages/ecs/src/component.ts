import { FieldType, FIELD_BYTE_SIZE } from '@engine/memory';

export type FieldSchema = Readonly<Record<string, FieldType>>;

export interface ComponentDef<S extends FieldSchema = FieldSchema> {
  readonly id: number;
  readonly name: string;
  readonly schema: S;
  readonly fieldNames: readonly string[];
  readonly fieldTypes: readonly FieldType[];
  readonly fieldByteSizes: readonly number[];
}

let nextComponentId = 0;

/**
 * Define a new component type with a typed field schema.
 *
 * Example:
 *   const Position = defineComponent('Position', { x: FieldType.F32, y: FieldType.F32, z: FieldType.F32 });
 */
export function defineComponent<S extends FieldSchema>(name: string, schema: S): ComponentDef<S> {
  const id = nextComponentId++;
  const fieldNames = Object.keys(schema);
  const fieldTypes = fieldNames.map(k => schema[k]!);
  const fieldByteSizes = fieldTypes.map(t => FIELD_BYTE_SIZE[t]);

  return Object.freeze({
    id,
    name,
    schema,
    fieldNames: Object.freeze(fieldNames),
    fieldTypes: Object.freeze(fieldTypes),
    fieldByteSizes: Object.freeze(fieldByteSizes),
  });
}

export function resetComponentIdCounter(): void {
  nextComponentId = 0;
}

/**
 * Create a bitmask for a set of component definitions.
 * Supports up to 64 component types via BigInt.
 */
export function componentMask(components: readonly ComponentDef[]): bigint {
  let mask = 0n;
  for (const c of components) {
    mask |= 1n << BigInt(c.id);
  }
  return mask;
}

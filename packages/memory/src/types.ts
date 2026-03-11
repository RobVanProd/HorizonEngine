export const enum FieldType {
  U8 = 1,
  U16 = 2,
  U32 = 4,
  I8 = 5,
  I16 = 6,
  I32 = 7,
  F32 = 8,
  F64 = 9,
}

export const FIELD_BYTE_SIZE: Record<FieldType, number> = {
  [FieldType.U8]: 1,
  [FieldType.U16]: 2,
  [FieldType.U32]: 4,
  [FieldType.I8]: 1,
  [FieldType.I16]: 2,
  [FieldType.I32]: 4,
  [FieldType.F32]: 4,
  [FieldType.F64]: 8,
};

export const FIELD_ALIGNMENT: Record<FieldType, number> = {
  [FieldType.U8]: 1,
  [FieldType.U16]: 2,
  [FieldType.U32]: 4,
  [FieldType.I8]: 1,
  [FieldType.I16]: 2,
  [FieldType.I32]: 4,
  [FieldType.F32]: 4,
  [FieldType.F64]: 8,
};

export type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

export type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array;

export const TYPED_ARRAY_CTOR: Record<FieldType, TypedArrayConstructor> = {
  [FieldType.U8]: Uint8Array,
  [FieldType.U16]: Uint16Array,
  [FieldType.U32]: Uint32Array,
  [FieldType.I8]: Int8Array,
  [FieldType.I16]: Int16Array,
  [FieldType.I32]: Int32Array,
  [FieldType.F32]: Float32Array,
  [FieldType.F64]: Float64Array,
};

export type TypedArrayFor<T extends FieldType> =
  T extends FieldType.U8 ? Uint8Array :
  T extends FieldType.U16 ? Uint16Array :
  T extends FieldType.U32 ? Uint32Array :
  T extends FieldType.I8 ? Int8Array :
  T extends FieldType.I16 ? Int16Array :
  T extends FieldType.I32 ? Int32Array :
  T extends FieldType.F32 ? Float32Array :
  T extends FieldType.F64 ? Float64Array :
  never;

export interface FieldDef {
  readonly name: string;
  readonly type: FieldType;
  readonly offset: number;
}

export interface ComponentSchema {
  readonly name: string;
  readonly id: number;
  readonly fields: readonly FieldDef[];
  readonly stride: number;
}

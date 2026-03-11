import { allocateBuffer } from './allocator.js';
import { type FieldType, FIELD_BYTE_SIZE, TYPED_ARRAY_CTOR, type TypedArray, type TypedArrayConstructor } from './types.js';

const GROWTH_FACTOR = 2;
const MIN_CAPACITY = 16;

/**
 * A single column of typed data backed by a (Shared)ArrayBuffer.
 * Used as the storage primitive for SoA ECS columns.
 */
export class TypedColumn<T extends FieldType = FieldType> {
  readonly fieldType: T;
  readonly elementBytes: number;
  private _Ctor: TypedArrayConstructor;
  private _buffer: ArrayBuffer | SharedArrayBuffer;
  private _view: TypedArray;
  private _capacity: number;
  private _length: number;
  private _shared: boolean;

  constructor(fieldType: T, initialCapacity: number = MIN_CAPACITY, shared = false) {
    this.fieldType = fieldType;
    this.elementBytes = FIELD_BYTE_SIZE[fieldType];
    this._Ctor = TYPED_ARRAY_CTOR[fieldType];
    this._shared = shared;
    this._capacity = Math.max(initialCapacity, MIN_CAPACITY);
    this._length = 0;
    this._buffer = allocateBuffer(this._capacity * this.elementBytes, shared);
    this._view = new this._Ctor(this._buffer as ArrayBuffer, 0, this._capacity);
  }

  get length(): number {
    return this._length;
  }

  get capacity(): number {
    return this._capacity;
  }

  get data(): TypedArray {
    return this._view;
  }

  get buffer(): ArrayBuffer | SharedArrayBuffer {
    return this._buffer;
  }

  ensureCapacity(required: number): void {
    if (required <= this._capacity) return;

    let newCap = this._capacity;
    while (newCap < required) newCap *= GROWTH_FACTOR;

    const newBuffer = allocateBuffer(newCap * this.elementBytes, this._shared);
    const newView = new this._Ctor(newBuffer as ArrayBuffer, 0, newCap);
    newView.set(this._view.subarray(0, this._length));

    this._buffer = newBuffer;
    this._view = newView;
    this._capacity = newCap;
  }

  push(value: number): number {
    const idx = this._length;
    this.ensureCapacity(idx + 1);
    this._view[idx] = value;
    this._length++;
    return idx;
  }

  set(index: number, value: number): void {
    this._view[index] = value;
  }

  get at(): (index: number) => number {
    const view = this._view;
    return (index: number) => view[index]!;
  }

  /**
   * Swap-remove: move the last element into the given index, shrink length by 1.
   * Returns the index that was moved from (old last index), or -1 if it was already last.
   */
  swapRemove(index: number): number {
    const last = this._length - 1;
    if (index !== last) {
      this._view[index] = this._view[last]!;
    }
    this._length--;
    return index !== last ? last : -1;
  }

  setLength(newLength: number): void {
    this.ensureCapacity(newLength);
    this._length = newLength;
  }

  clear(): void {
    this._length = 0;
  }
}

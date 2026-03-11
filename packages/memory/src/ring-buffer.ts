/**
 * Lock-free SPSC (single-producer, single-consumer) ring buffer
 * backed by SharedArrayBuffer for cross-worker communication.
 *
 * Layout in the SharedArrayBuffer:
 *   [0]: write head (u32, atomic)
 *   [1]: read head  (u32, atomic)
 *   [2..]: data slots (u32 each)
 */
export class RingBuffer {
  private _control: Int32Array;
  private _data: Uint32Array;
  private _mask: number;
  readonly capacity: number;

  constructor(capacityPowerOf2: number, buffer?: SharedArrayBuffer) {
    this.capacity = capacityPowerOf2;
    this._mask = capacityPowerOf2 - 1;

    if ((capacityPowerOf2 & this._mask) !== 0) {
      throw new Error('RingBuffer capacity must be a power of 2');
    }

    const totalBytes = (2 + capacityPowerOf2) * 4;
    const sab = buffer ?? new SharedArrayBuffer(totalBytes);
    this._control = new Int32Array(sab, 0, 2);
    this._data = new Uint32Array(sab, 8, capacityPowerOf2);
  }

  get buffer(): SharedArrayBuffer {
    return this._control.buffer as SharedArrayBuffer;
  }

  tryPush(value: number): boolean {
    const writeHead = Atomics.load(this._control, 0);
    const readHead = Atomics.load(this._control, 1);

    if (writeHead - readHead >= this.capacity) return false;

    this._data[writeHead & this._mask] = value;
    Atomics.store(this._control, 0, writeHead + 1);
    return true;
  }

  tryPop(): number | null {
    const readHead = Atomics.load(this._control, 1);
    const writeHead = Atomics.load(this._control, 0);

    if (readHead >= writeHead) return null;

    const value = this._data[readHead & this._mask]!;
    Atomics.store(this._control, 1, readHead + 1);
    return value;
  }

  get available(): number {
    return Atomics.load(this._control, 0) - Atomics.load(this._control, 1);
  }

  get freeSlots(): number {
    return this.capacity - this.available;
  }
}

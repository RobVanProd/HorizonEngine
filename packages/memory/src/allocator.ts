let sharedAvailable: boolean | null = null;

export function isSharedMemoryAvailable(): boolean {
  if (sharedAvailable === null) {
    try {
      sharedAvailable =
        typeof SharedArrayBuffer !== 'undefined' &&
        typeof Atomics !== 'undefined';
    } catch {
      sharedAvailable = false;
    }
  }
  return sharedAvailable;
}

export function allocateBuffer(byteLength: number, forceShared = false): ArrayBuffer | SharedArrayBuffer {
  const useShared = forceShared || isSharedMemoryAvailable();
  if (useShared && typeof SharedArrayBuffer !== 'undefined') {
    return new SharedArrayBuffer(byteLength);
  }
  return new ArrayBuffer(byteLength);
}

export function isSharedBuffer(buffer: ArrayBuffer | SharedArrayBuffer): buffer is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
}

const DEFAULT_INITIAL_CAPACITY = 64;
const GROWTH_FACTOR = 2;

/**
 * A growable buffer that doubles capacity when full.
 * Optionally backs onto SharedArrayBuffer for cross-worker access.
 */
export class GrowableBuffer {
  private _buffer: ArrayBuffer | SharedArrayBuffer;
  private _byteLength: number;
  private _capacity: number;
  private _shared: boolean;

  constructor(initialCapacityBytes: number = DEFAULT_INITIAL_CAPACITY * 4, shared = false) {
    this._capacity = Math.max(initialCapacityBytes, 16);
    this._byteLength = 0;
    this._shared = shared;
    this._buffer = allocateBuffer(this._capacity, shared);
  }

  get buffer(): ArrayBuffer | SharedArrayBuffer {
    return this._buffer;
  }

  get byteLength(): number {
    return this._byteLength;
  }

  get capacity(): number {
    return this._capacity;
  }

  ensureCapacity(requiredBytes: number): void {
    if (requiredBytes <= this._capacity) return;

    let newCapacity = this._capacity;
    while (newCapacity < requiredBytes) {
      newCapacity *= GROWTH_FACTOR;
    }

    const newBuffer = allocateBuffer(newCapacity, this._shared);
    new Uint8Array(newBuffer).set(new Uint8Array(this._buffer, 0, this._byteLength));
    this._buffer = newBuffer;
    this._capacity = newCapacity;
  }

  grow(additionalBytes: number): number {
    const offset = this._byteLength;
    this.ensureCapacity(this._byteLength + additionalBytes);
    this._byteLength += additionalBytes;
    return offset;
  }

  shrinkTo(byteLength: number): void {
    this._byteLength = Math.min(byteLength, this._byteLength);
  }
}

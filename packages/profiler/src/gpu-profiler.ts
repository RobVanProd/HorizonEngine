/**
 * GPU timing via WebGPU timestamp queries.
 * Wraps the timestamp-query feature for measuring GPU pass durations.
 *
 * Usage:
 *   const gp = new GpuProfiler(device);
 *   const pass = encoder.beginRenderPass({ ...gp.timestampWrites('myPass') });
 *   ...
 *   pass.end();
 *   gp.resolve(encoder);
 *   device.queue.submit([encoder.finish()]);
 *   await gp.readResults(); // logs timing
 */
export class GpuProfiler {
  private _device: GPUDevice;
  private _querySet: GPUQuerySet | null = null;
  private _resolveBuffer: GPUBuffer | null = null;
  private _readBuffer: GPUBuffer | null = null;
  private _labels: string[] = [];
  private _nextSlot = 0;
  private _maxQueries: number;
  private _supported: boolean;

  readonly results: Map<string, number> = new Map();

  constructor(device: GPUDevice, maxQueries: number = 64) {
    this._device = device;
    this._maxQueries = maxQueries;
    this._supported = device.features.has('timestamp-query');

    if (this._supported) {
      this._querySet = device.createQuerySet({
        type: 'timestamp',
        count: maxQueries,
      });

      const byteSize = maxQueries * 8;
      this._resolveBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this._readBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }
  }

  get supported(): boolean {
    return this._supported;
  }

  beginFrame(): void {
    this._nextSlot = 0;
    this._labels.length = 0;
  }

  /**
   * Returns a timestampWrites descriptor for a render or compute pass.
   */
  timestampWrites(label: string): GPURenderPassTimestampWrites | undefined {
    if (!this._supported || !this._querySet) return undefined;

    const beginIdx = this._nextSlot;
    const endIdx = this._nextSlot + 1;
    this._nextSlot += 2;
    this._labels.push(label);

    if (endIdx >= this._maxQueries) {
      console.warn('GpuProfiler: exceeded max query slots');
      return undefined;
    }

    return {
      querySet: this._querySet,
      beginningOfPassWriteIndex: beginIdx,
      endOfPassWriteIndex: endIdx,
    };
  }

  /**
   * Resolve timestamp queries into the resolve buffer. Call after all passes.
   */
  resolve(encoder: GPUCommandEncoder): void {
    if (!this._supported || !this._querySet || !this._resolveBuffer || !this._readBuffer) return;
    if (this._nextSlot === 0) return;

    encoder.resolveQuerySet(this._querySet, 0, this._nextSlot, this._resolveBuffer, 0);
    encoder.copyBufferToBuffer(
      this._resolveBuffer, 0,
      this._readBuffer, 0,
      this._nextSlot * 8,
    );
  }

  /**
   * Map the read buffer and extract timing results (in milliseconds).
   */
  async readResults(): Promise<Map<string, number>> {
    this.results.clear();
    if (!this._supported || !this._readBuffer || this._labels.length === 0) return this.results;

    await this._readBuffer.mapAsync(GPUMapMode.READ);
    const data = new BigUint64Array(this._readBuffer.getMappedRange());

    for (let i = 0; i < this._labels.length; i++) {
      const begin = data[i * 2]!;
      const end = data[i * 2 + 1]!;
      const ns = Number(end - begin);
      this.results.set(this._labels[i]!, ns / 1_000_000);
    }

    this._readBuffer.unmap();
    return this.results;
  }

  destroy(): void {
    this._querySet?.destroy();
    this._resolveBuffer?.destroy();
    this._readBuffer?.destroy();
  }
}

/**
 * Worker pool that executes compute kernels across multiple Web Workers.
 *
 * Kernels are self-contained functions that operate on SharedArrayBuffer-backed
 * typed arrays. They are serialized as function body strings and reconstructed
 * inside each worker via `new Function()`.
 *
 * This enables true parallel simulation: workers read/write the same memory
 * as the main thread with zero serialization overhead.
 */

export type KernelFn = (
  start: number,
  end: number,
  buffers: Record<string, SharedArrayBuffer>,
  params: Record<string, number>,
) => void;

interface PendingJob {
  resolve: () => void;
  reject: (err: Error) => void;
  remaining: number;
}

const WORKER_SOURCE = /* js */ `
'use strict';
const kernels = Object.create(null);

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'register': {
      try {
        kernels[msg.name] = new Function('start', 'end', 'buffers', 'params', msg.body);
      } catch (err) {
        self.postMessage({ type: 'error', jobId: -1, message: 'Kernel compilation failed: ' + err.message });
      }
      break;
    }
    case 'run': {
      const { jobId, name, start, end, buffers, params } = msg;
      try {
        if (!kernels[name]) throw new Error('Unknown kernel: ' + name);
        kernels[name](start, end, buffers, params);
        self.postMessage({ type: 'done', jobId });
      } catch (err) {
        self.postMessage({ type: 'error', jobId, message: err.message });
      }
      break;
    }
  }
};

self.postMessage({ type: 'ready' });
`;

export class WorkerPool {
  private _workers: Worker[] = [];
  private _ready: Promise<void>[] = [];
  private _pendingJobs: Map<number, PendingJob> = new Map();
  private _nextJobId = 1;
  private _kernelBodies: Map<string, string> = new Map();
  private _initialized = false;
  readonly size: number;

  constructor(size?: number) {
    this.size = size ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1);
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(url);
      const ready = new Promise<void>((resolve) => {
        const onMessage = (e: MessageEvent) => {
          if (e.data.type === 'ready') {
            worker.removeEventListener('message', onMessage);
            resolve();
          }
        };
        worker.addEventListener('message', onMessage);
      });

      worker.addEventListener('message', (e) => this._onWorkerMessage(e));
      worker.addEventListener('error', (e) => {
        console.error(`[WorkerPool] Worker ${i} error:`, e.message);
      });

      this._workers.push(worker);
      this._ready.push(ready);
    }

    await Promise.all(this._ready);
    URL.revokeObjectURL(url);

    // Send any already-registered kernels
    for (const [name, body] of this._kernelBodies) {
      this._broadcastKernel(name, body);
    }

    this._initialized = true;
  }

  /**
   * Register a compute kernel. The function must be self-contained —
   * no closures over external variables. Only `start`, `end`, `buffers`, `params`
   * and built-in globals (Math, Float32Array, etc.) are available.
   */
  registerKernel(name: string, fn: KernelFn): void {
    const body = extractFunctionBody(fn);
    this._kernelBodies.set(name, body);
    if (this._initialized) {
      this._broadcastKernel(name, body);
    }
  }

  /**
   * Dispatch a kernel across all workers, splitting the range [0, count).
   * Each worker processes a sub-range. Returns when all workers finish.
   */
  dispatch(
    kernelName: string,
    count: number,
    buffers: Record<string, SharedArrayBuffer>,
    params: Record<string, number> = {},
  ): Promise<void> {
    if (count === 0) return Promise.resolve();
    if (!this._initialized) {
      throw new Error('WorkerPool not initialized');
    }

    const jobId = this._nextJobId++;
    const workerCount = Math.min(this.size, count);
    const chunkSize = Math.ceil(count / workerCount);

    return new Promise<void>((resolve, reject) => {
      this._pendingJobs.set(jobId, { resolve, reject, remaining: workerCount });

      for (let i = 0; i < workerCount; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, count);

        this._workers[i]!.postMessage({
          type: 'run',
          jobId,
          name: kernelName,
          start,
          end,
          buffers,
          params,
        });
      }
    });
  }

  /**
   * Execute a kernel on the main thread (single-threaded fallback).
   */
  executeLocal(
    kernelName: string,
    count: number,
    buffers: Record<string, SharedArrayBuffer>,
    params: Record<string, number> = {},
  ): void {
    const body = this._kernelBodies.get(kernelName);
    if (!body) throw new Error(`Unknown kernel: ${kernelName}`);
    const fn = new Function('start', 'end', 'buffers', 'params', body) as KernelFn;
    fn(0, count, buffers, params);
  }

  terminate(): void {
    for (const w of this._workers) w.terminate();
    this._workers.length = 0;
    this._pendingJobs.clear();
  }

  private _broadcastKernel(name: string, body: string): void {
    for (const w of this._workers) {
      w.postMessage({ type: 'register', name, body });
    }
  }

  private _onWorkerMessage(e: MessageEvent): void {
    const msg = e.data;
    if (msg.type === 'done' || msg.type === 'error') {
      const job = this._pendingJobs.get(msg.jobId);
      if (!job) return;

      if (msg.type === 'error') {
        this._pendingJobs.delete(msg.jobId);
        job.reject(new Error(`Worker kernel error: ${msg.message}`));
        return;
      }

      job.remaining--;
      if (job.remaining <= 0) {
        this._pendingJobs.delete(msg.jobId);
        job.resolve();
      }
    }
  }
}

function extractFunctionBody(fn: Function): string {
  const src = fn.toString();
  const braceStart = src.indexOf('{');
  if (braceStart === -1) {
    // Arrow function without braces: (a, b) => expression
    const arrowIdx = src.indexOf('=>');
    if (arrowIdx !== -1) {
      return 'return (' + src.substring(arrowIdx + 2).trim() + ');';
    }
    throw new Error('Cannot extract kernel body');
  }
  return src.substring(braceStart + 1, src.lastIndexOf('}'));
}

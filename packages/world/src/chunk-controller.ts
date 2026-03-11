import { SpatialGrid, type StreamingEvent } from '@engine/streaming';
import { hash2D } from './random.js';

export interface ChunkLifecycleContext {
  cx: number;
  cz: number;
  seed: number;
}

export interface ChunkLifecycleHooks {
  onActivate?: (ctx: ChunkLifecycleContext) => void | Promise<void>;
  onDeactivate?: (ctx: ChunkLifecycleContext) => void | Promise<void>;
}

export class WorldChunkController {
  readonly grid: SpatialGrid;
  readonly seed: number;
  private _hooks: ChunkLifecycleHooks;

  constructor(seed: number, cellSize = 64, activeRadius = 256, hooks: ChunkLifecycleHooks = {}) {
    this.seed = seed >>> 0;
    this.grid = new SpatialGrid(cellSize, activeRadius);
    this._hooks = hooks;
  }

  async updateFocus(x: number, z: number): Promise<readonly StreamingEvent[]> {
    const events = this.grid.updateFocus(x, z);
    for (const event of events) {
      const ctx = this._makeContext(event.cx, event.cz);
      if (event.type === 'activate') {
        await this._hooks.onActivate?.(ctx);
      } else {
        await this._hooks.onDeactivate?.(ctx);
      }
    }
    return events;
  }

  trackEntity(entityId: number, x: number, z: number): void {
    this.grid.updateEntity(entityId, x, z);
  }

  untrackEntity(entityId: number): void {
    this.grid.removeEntity(entityId);
  }

  getCellSeed(cx: number, cz: number): number {
    return hash2D(this.seed, cx, cz);
  }

  private _makeContext(cx: number, cz: number): ChunkLifecycleContext {
    return { cx, cz, seed: this.getCellSeed(cx, cz) };
  }
}

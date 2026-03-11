/**
 * Spatial partitioning grid for world streaming.
 *
 * The world is divided into square cells of a fixed size. Entities are
 * assigned to cells by their XZ position. A focus point (typically the
 * camera or player) determines which cells are "active". Cells outside
 * the active radius are deactivated, releasing simulation budget.
 *
 * This is the metadata layer — it tracks which cells are loaded, active,
 * and which entities belong to each cell. Actual loading/unloading of
 * heavy resources (geometry, textures) is handled by higher-level systems.
 */

export interface CellCoord {
  readonly cx: number;
  readonly cz: number;
}

export const enum CellState {
  Unloaded = 0,
  Loading = 1,
  Active = 2,
  Deactivating = 3,
}

export interface CellInfo {
  readonly cx: number;
  readonly cz: number;
  state: CellState;
  readonly entities: Set<number>;
}

export interface StreamingEvent {
  readonly type: 'activate' | 'deactivate';
  readonly cx: number;
  readonly cz: number;
}

export class SpatialGrid {
  readonly cellSize: number;
  readonly activeRadius: number;
  private _cells: Map<string, CellInfo> = new Map();
  private _entityCells: Map<number, string> = new Map();
  private _events: StreamingEvent[] = [];

  private _focusX = 0;
  private _focusZ = 0;
  private _activeRadiusCells: number;

  constructor(cellSize: number = 64, activeRadius: number = 256) {
    this.cellSize = cellSize;
    this.activeRadius = activeRadius;
    this._activeRadiusCells = Math.ceil(activeRadius / cellSize);
  }

  /**
   * Update the focus point. Typically called once per frame with camera position.
   * Returns streaming events (cells that need activation or deactivation).
   */
  updateFocus(x: number, z: number): readonly StreamingEvent[] {
    this._focusX = x;
    this._focusZ = z;
    this._events.length = 0;

    const fcx = Math.floor(x / this.cellSize);
    const fcz = Math.floor(z / this.cellSize);
    const r = this._activeRadiusCells;

    // Mark cells that should be active
    const shouldBeActive = new Set<string>();
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.sqrt(dx * dx + dz * dz) * this.cellSize;
        if (dist <= this.activeRadius) {
          shouldBeActive.add(cellKey(fcx + dx, fcz + dz));
        }
      }
    }

    // Activate new cells
    for (const key of shouldBeActive) {
      let cell = this._cells.get(key);
      if (!cell) {
        const [cx, cz] = parseCellKey(key);
        cell = { cx, cz, state: CellState.Unloaded, entities: new Set() };
        this._cells.set(key, cell);
      }
      if (cell.state !== CellState.Active) {
        cell.state = CellState.Active;
        this._events.push({ type: 'activate', cx: cell.cx, cz: cell.cz });
      }
    }

    // Deactivate cells that are no longer in range
    for (const [key, cell] of this._cells) {
      if (cell.state === CellState.Active && !shouldBeActive.has(key)) {
        cell.state = CellState.Deactivating;
        this._events.push({ type: 'deactivate', cx: cell.cx, cz: cell.cz });
      }
    }

    return this._events;
  }

  /**
   * Assign or update an entity's cell based on its world position.
   */
  updateEntity(entityId: number, x: number, z: number): void {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const newKey = cellKey(cx, cz);
    const oldKey = this._entityCells.get(entityId);

    if (oldKey === newKey) return;

    // Remove from old cell
    if (oldKey) {
      const oldCell = this._cells.get(oldKey);
      oldCell?.entities.delete(entityId);
    }

    // Add to new cell
    let cell = this._cells.get(newKey);
    if (!cell) {
      cell = { cx, cz, state: CellState.Unloaded, entities: new Set() };
      this._cells.set(newKey, cell);
    }
    cell.entities.add(entityId);
    this._entityCells.set(entityId, newKey);
  }

  removeEntity(entityId: number): void {
    const key = this._entityCells.get(entityId);
    if (key) {
      this._cells.get(key)?.entities.delete(entityId);
      this._entityCells.delete(entityId);
    }
  }

  /**
   * Check if an entity is in an active cell.
   */
  isEntityActive(entityId: number): boolean {
    const key = this._entityCells.get(entityId);
    if (!key) return false;
    return this._cells.get(key)?.state === CellState.Active;
  }

  getCell(cx: number, cz: number): CellInfo | undefined {
    return this._cells.get(cellKey(cx, cz));
  }

  getCellAt(x: number, z: number): CellInfo | undefined {
    return this.getCell(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
  }

  get activeCellCount(): number {
    let count = 0;
    for (const cell of this._cells.values()) {
      if (cell.state === CellState.Active) count++;
    }
    return count;
  }

  get totalCellCount(): number {
    return this._cells.size;
  }

  get trackedEntityCount(): number {
    return this._entityCells.size;
  }

  /**
   * Get all entity IDs in active cells.
   */
  getActiveEntities(): number[] {
    const result: number[] = [];
    for (const cell of this._cells.values()) {
      if (cell.state === CellState.Active) {
        for (const id of cell.entities) result.push(id);
      }
    }
    return result;
  }

  /**
   * Purge deactivated cells that have no entities.
   */
  purgeEmpty(): number {
    let purged = 0;
    for (const [key, cell] of this._cells) {
      if (cell.state === CellState.Deactivating && cell.entities.size === 0) {
        this._cells.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function parseCellKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [parseInt(key.substring(0, i), 10), parseInt(key.substring(i + 1), 10)];
}

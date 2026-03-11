export type SelectionCallback = (ids: ReadonlySet<number>) => void;

/**
 * Manages the set of currently selected entity IDs.
 */
export class Selection {
  private _ids = new Set<number>();
  private _callbacks: SelectionCallback[] = [];

  get ids(): ReadonlySet<number> { return this._ids; }
  get count(): number { return this._ids.size; }
  get first(): number | null { return this._ids.size > 0 ? this._ids.values().next().value! : null; }

  select(id: number, additive = false): void {
    if (!additive) this._ids.clear();
    this._ids.add(id);
    this._notify();
  }

  deselect(id: number): void {
    this._ids.delete(id);
    this._notify();
  }

  toggle(id: number): void {
    if (this._ids.has(id)) this._ids.delete(id);
    else this._ids.add(id);
    this._notify();
  }

  clear(): void {
    if (this._ids.size === 0) return;
    this._ids.clear();
    this._notify();
  }

  has(id: number): boolean { return this._ids.has(id); }

  set(ids: Iterable<number>): void {
    this._ids.clear();
    for (const id of ids) this._ids.add(id);
    this._notify();
  }

  onChange(cb: SelectionCallback): void {
    this._callbacks.push(cb);
  }

  private _notify(): void {
    for (const cb of this._callbacks) cb(this._ids);
  }
}

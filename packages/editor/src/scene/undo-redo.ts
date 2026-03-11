export interface UndoCommand {
  label: string;
  execute(): void;
  undo(): void;
}

/**
 * Command-pattern undo/redo stack.
 */
export class UndoRedoStack {
  private _undoStack: UndoCommand[] = [];
  private _redoStack: UndoCommand[] = [];
  private _maxSize = 100;
  private _onChangeCallbacks: Array<() => void> = [];

  get canUndo(): boolean { return this._undoStack.length > 0; }
  get canRedo(): boolean { return this._redoStack.length > 0; }
  get undoLabel(): string | null { return this._undoStack.length > 0 ? this._undoStack[this._undoStack.length - 1]!.label : null; }
  get redoLabel(): string | null { return this._redoStack.length > 0 ? this._redoStack[this._redoStack.length - 1]!.label : null; }

  execute(cmd: UndoCommand): void {
    cmd.execute();
    this._undoStack.push(cmd);
    if (this._undoStack.length > this._maxSize) this._undoStack.shift();
    this._redoStack.length = 0;
    this._notify();
  }

  undo(): void {
    const cmd = this._undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this._redoStack.push(cmd);
    this._notify();
  }

  redo(): void {
    const cmd = this._redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this._undoStack.push(cmd);
    this._notify();
  }

  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._notify();
  }

  onChange(cb: () => void): void {
    this._onChangeCallbacks.push(cb);
  }

  private _notify(): void {
    for (const cb of this._onChangeCallbacks) cb();
  }
}

/** Helper: create a command for changing a single numeric field on an entity. */
export function fieldChangeCommand(
  world: { getField(id: number, comp: any, field: any): number; setField(id: number, comp: any, field: any, value: number): void },
  entityId: number,
  comp: any,
  field: string,
  oldValue: number,
  newValue: number,
): UndoCommand {
  return {
    label: `Set ${comp.name}.${field}`,
    execute: () => world.setField(entityId, comp, field, newValue),
    undo: () => world.setField(entityId, comp, field, oldValue),
  };
}

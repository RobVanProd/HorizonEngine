export const enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2,
}

export const enum KeyState {
  Up = 0,
  Down = 1,
  JustPressed = 2,
  JustReleased = 3,
}

/**
 * Polling-based input system. Call update() once per frame before reading state.
 * Tracks keyboard, mouse position, mouse buttons, and mouse delta.
 */
export class InputState {
  private _keys: Map<string, KeyState> = new Map();
  private _mouseButtons: Uint8Array = new Uint8Array(5);
  private _mouseX = 0;
  private _mouseY = 0;
  private _mouseDeltaX = 0;
  private _mouseDeltaY = 0;
  private _scrollDelta = 0;
  private _pendingKeyDown: Set<string> = new Set();
  private _pendingKeyUp: Set<string> = new Set();
  private _pendingMouseDown: Set<number> = new Set();
  private _pendingMouseUp: Set<number> = new Set();
  private _accumulatedDX = 0;
  private _accumulatedDY = 0;
  private _accumulatedScroll = 0;

  private _boundHandlers: (() => void) | null = null;

  attach(target: HTMLElement): void {
    const onKeyDown = (e: KeyboardEvent) => {
      this._pendingKeyDown.add(e.code);
      this._pendingKeyUp.delete(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this._pendingKeyUp.add(e.code);
      this._pendingKeyDown.delete(e.code);
    };
    const onMouseMove = (e: MouseEvent) => {
      this._mouseX = e.clientX;
      this._mouseY = e.clientY;
      this._accumulatedDX += e.movementX;
      this._accumulatedDY += e.movementY;
    };
    const onMouseDown = (e: MouseEvent) => {
      this._pendingMouseDown.add(e.button);
    };
    const onMouseUp = (e: MouseEvent) => {
      this._pendingMouseUp.add(e.button);
    };
    const onWheel = (e: WheelEvent) => {
      this._accumulatedScroll += e.deltaY;
    };
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    target.addEventListener('mousemove', onMouseMove);
    target.addEventListener('mousedown', onMouseDown);
    target.addEventListener('mouseup', onMouseUp);
    target.addEventListener('wheel', onWheel, { passive: true });
    target.addEventListener('contextmenu', onContextMenu);

    this._boundHandlers = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
    };
  }

  detach(): void {
    this._boundHandlers?.();
    this._boundHandlers = null;
  }

  /**
   * Must be called once per frame to transition edge-triggered states.
   */
  update(): void {
    for (const [key, state] of this._keys) {
      if (state === KeyState.JustPressed) this._keys.set(key, KeyState.Down);
      else if (state === KeyState.JustReleased) this._keys.set(key, KeyState.Up);
    }

    for (const key of this._pendingKeyDown) {
      this._keys.set(key, KeyState.JustPressed);
    }
    for (const key of this._pendingKeyUp) {
      this._keys.set(key, KeyState.JustReleased);
    }
    this._pendingKeyDown.clear();
    this._pendingKeyUp.clear();

    for (let i = 0; i < 5; i++) {
      const current = this._mouseButtons[i]!;
      if (current === KeyState.JustPressed) this._mouseButtons[i] = KeyState.Down;
      else if (current === KeyState.JustReleased) this._mouseButtons[i] = KeyState.Up;
    }
    for (const btn of this._pendingMouseDown) {
      this._mouseButtons[btn] = KeyState.JustPressed;
    }
    for (const btn of this._pendingMouseUp) {
      this._mouseButtons[btn] = KeyState.JustReleased;
    }
    this._pendingMouseDown.clear();
    this._pendingMouseUp.clear();

    this._mouseDeltaX = this._accumulatedDX;
    this._mouseDeltaY = this._accumulatedDY;
    this._scrollDelta = this._accumulatedScroll;
    this._accumulatedDX = 0;
    this._accumulatedDY = 0;
    this._accumulatedScroll = 0;
  }

  isKeyDown(code: string): boolean {
    const s = this._keys.get(code);
    return s === KeyState.Down || s === KeyState.JustPressed;
  }

  isKeyJustPressed(code: string): boolean {
    return this._keys.get(code) === KeyState.JustPressed;
  }

  isKeyJustReleased(code: string): boolean {
    return this._keys.get(code) === KeyState.JustReleased;
  }

  isMouseDown(button: MouseButton): boolean {
    const s = this._mouseButtons[button]!;
    return s === KeyState.Down || s === KeyState.JustPressed;
  }

  get mouseX(): number { return this._mouseX; }
  get mouseY(): number { return this._mouseY; }
  get mouseDeltaX(): number { return this._mouseDeltaX; }
  get mouseDeltaY(): number { return this._mouseDeltaY; }
  get scrollDelta(): number { return this._scrollDelta; }
}

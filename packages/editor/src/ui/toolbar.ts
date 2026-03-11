import { COLORS, FONT, SIZES, el } from './theme.js';
import { Icons } from './icons.js';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type PlayState = 'stopped' | 'playing' | 'paused';

export interface ToolbarEvents {
  onToolChange?: (tool: ToolMode) => void;
  onPlayStateChange?: (state: PlayState) => void;
  onSnap?: (enabled: boolean) => void;
  onGridToggle?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export class Toolbar {
  readonly root: HTMLDivElement;
  private _tool: ToolMode = 'select';
  private _playState: PlayState = 'stopped';
  private _snap = false;
  private _toolButtons = new Map<ToolMode, HTMLButtonElement>();
  private _playBtn!: HTMLButtonElement;
  private _pauseBtn!: HTMLButtonElement;
  private _stopBtn!: HTMLButtonElement;
  private _events: ToolbarEvents;

  constructor(events: ToolbarEvents = {}) {
    this._events = events;

    this.root = el('div', {
      display: 'flex', alignItems: 'center',
      height: `${SIZES.toolbarHeight}px`,
      background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}`,
      padding: '0 8px', gap: '4px', userSelect: 'none',
    });

    // Tool group
    const toolGroup = this._createGroup();
    this._addToolBtn(toolGroup, 'select', Icons.cursor(), 'Select (Q)');
    this._addToolBtn(toolGroup, 'translate', Icons.move(), 'Translate (W)');
    this._addToolBtn(toolGroup, 'rotate', Icons.rotate(), 'Rotate (E)');
    this._addToolBtn(toolGroup, 'scale', Icons.scale(), 'Scale (R)');
    this.root.appendChild(toolGroup);

    this._addSep();

    // Grid & snap
    const viewGroup = this._createGroup();
    const gridBtn = this._createBtn(Icons.grid(), 'Toggle Grid');
    gridBtn.addEventListener('click', () => events.onGridToggle?.());
    viewGroup.appendChild(gridBtn);

    const snapBtn = this._createBtn(el('span'), 'Toggle Snap (X)');
    snapBtn.firstElementChild!.textContent = 'S';
    Object.assign((snapBtn.firstElementChild as HTMLElement).style, {
      fontWeight: '700', fontSize: FONT.size.xs,
    });
    snapBtn.addEventListener('click', () => {
      this._snap = !this._snap;
      snapBtn.classList.toggle('active', this._snap);
      events.onSnap?.(this._snap);
    });
    viewGroup.appendChild(snapBtn);
    this.root.appendChild(viewGroup);

    this._addSep();

    // Undo / Redo
    const histGroup = this._createGroup();
    const undoBtn = this._createBtn(Icons.undo(), 'Undo (Ctrl+Z)');
    undoBtn.addEventListener('click', () => events.onUndo?.());
    histGroup.appendChild(undoBtn);
    const redoBtn = this._createBtn(Icons.redo(), 'Redo (Ctrl+Shift+Z)');
    redoBtn.addEventListener('click', () => events.onRedo?.());
    histGroup.appendChild(redoBtn);
    this.root.appendChild(histGroup);

    // Spacer
    this.root.appendChild(el('div', { flex: '1' }));

    // Play controls — centered
    const playGroup = this._createGroup();
    this._playBtn = this._createBtn(Icons.play(), 'Play');
    this._playBtn.addEventListener('click', () => this._setPlayState('playing'));
    playGroup.appendChild(this._playBtn);

    this._pauseBtn = this._createBtn(Icons.pause(), 'Pause');
    this._pauseBtn.addEventListener('click', () => this._setPlayState('paused'));
    playGroup.appendChild(this._pauseBtn);

    this._stopBtn = this._createBtn(Icons.stop(), 'Stop');
    this._stopBtn.addEventListener('click', () => this._setPlayState('stopped'));
    playGroup.appendChild(this._stopBtn);
    this.root.appendChild(playGroup);

    // Spacer
    this.root.appendChild(el('div', { flex: '1' }));

    this._updateToolHighlight();
    this._updatePlayHighlight();
  }

  get tool(): ToolMode { return this._tool; }
  get playState(): PlayState { return this._playState; }
  get snap(): boolean { return this._snap; }

  setTool(tool: ToolMode): void {
    this._tool = tool;
    this._updateToolHighlight();
    this._events.onToolChange?.(tool);
  }

  private _setPlayState(state: PlayState): void {
    this._playState = state;
    this._updatePlayHighlight();
    this._events.onPlayStateChange?.(state);
  }

  private _addToolBtn(container: HTMLElement, mode: ToolMode, icon: Element, title: string): void {
    const btn = this._createBtn(icon, title);
    btn.addEventListener('click', () => this.setTool(mode));
    this._toolButtons.set(mode, btn);
    container.appendChild(btn);
  }

  private _createBtn(icon: Element, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.title = title;
    Object.assign(btn.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '28px', height: '28px', padding: '0',
      borderRadius: '4px',
    });
    btn.appendChild(icon);
    return btn;
  }

  private _createGroup(): HTMLDivElement {
    return el('div', { display: 'flex', gap: '2px', alignItems: 'center' });
  }

  private _addSep(): void {
    this.root.appendChild(el('div', {
      width: '1px', height: '20px',
      background: COLORS.border, margin: '0 6px',
    }));
  }

  private _updateToolHighlight(): void {
    for (const [mode, btn] of this._toolButtons) {
      btn.classList.toggle('active', mode === this._tool);
    }
  }

  private _updatePlayHighlight(): void {
    this._playBtn.classList.toggle('active', this._playState === 'playing');
    this._pauseBtn.classList.toggle('active', this._playState === 'paused');
    this._stopBtn.classList.toggle('active', this._playState === 'stopped');
  }

  destroy(): void {
    this.root.remove();
  }
}

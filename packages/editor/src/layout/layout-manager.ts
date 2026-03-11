import { COLORS, SIZES, el } from '../ui/theme.js';

export interface PanelConfig {
  id: string;
  title: string;
  side: 'left' | 'right' | 'bottom';
  width?: number;
  height?: number;
  visible?: boolean;
  content?: HTMLElement;
}

interface PanelState {
  config: PanelConfig;
  container: HTMLDivElement;
  header: HTMLDivElement;
  body: HTMLDivElement;
  visible: boolean;
}

/**
 * Manages the editor layout: CSS Grid with resizable sidebars, a central viewport, and a bottom panel.
 *
 * Layout:
 *   ┌─────────┬──────────────┬──────────┐
 *   │  Left   │   Viewport   │  Right   │
 *   │ Sidebar │   (canvas)   │ Sidebar  │
 *   ├─────────┴──────────────┴──────────┤
 *   │           Bottom Panel            │
 *   └──────────────────────────────────┘
 */
export class LayoutManager {
  readonly root: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  private _leftSidebar: HTMLDivElement;
  private _rightSidebar: HTMLDivElement;
  private _bottomPanel: HTMLDivElement;
  private _panels = new Map<string, PanelState>();
  private _leftWidth: number;
  private _rightWidth: number;
  private _bottomHeight: number;
  private _bottomVisible: boolean;

  constructor() {
    this._leftWidth = SIZES.panelDefaultWidth;
    this._rightWidth = SIZES.panelDefaultWidth;
    this._bottomHeight = 200;
    this._bottomVisible = false;

    this.root = el('div', {
      display: 'grid',
      gridTemplateColumns: `${this._leftWidth}px 1fr ${this._rightWidth}px`,
      gridTemplateRows: '1fr',
      width: '100%', height: '100%',
      overflow: 'hidden',
      background: COLORS.bg,
    });

    this._leftSidebar = el('div', {
      display: 'flex', flexDirection: 'column',
      background: COLORS.bgDark,
      borderRight: `1px solid ${COLORS.border}`,
      overflow: 'hidden',
    });

    this.viewport = el('div', {
      position: 'relative', overflow: 'hidden',
      background: '#000',
    });

    this._rightSidebar = el('div', {
      display: 'flex', flexDirection: 'column',
      background: COLORS.bgDark,
      borderLeft: `1px solid ${COLORS.border}`,
      overflow: 'hidden',
    });

    this._bottomPanel = el('div', {
      display: 'none', flexDirection: 'column',
      background: COLORS.bgDark,
      borderTop: `1px solid ${COLORS.border}`,
      overflow: 'hidden',
      gridColumn: '1 / -1',
    });

    this.root.appendChild(this._leftSidebar);
    this.root.appendChild(this.viewport);
    this.root.appendChild(this._rightSidebar);
    this.root.appendChild(this._bottomPanel);

    this._setupResizers();
  }

  addPanel(config: PanelConfig): void {
    const container = el('div', {
      display: 'flex', flexDirection: 'column',
      flex: config.side === 'bottom' ? '1' : 'none',
      minHeight: config.side !== 'bottom' ? '0' : undefined,
      overflow: 'hidden',
    });

    const header = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 8px',
      background: COLORS.surface,
      borderBottom: `1px solid ${COLORS.border}`,
      cursor: 'pointer', userSelect: 'none',
      fontSize: '11px', fontWeight: '600',
      color: COLORS.textDim,
    });
    header.textContent = config.title;

    const body = el('div', {
      flex: '1', overflow: 'auto',
      padding: '0',
    });

    if (config.content) body.appendChild(config.content);

    container.appendChild(header);
    container.appendChild(body);

    const visible = config.visible !== false;
    container.style.display = visible ? 'flex' : 'none';

    const state: PanelState = { config, container, header, body, visible };
    this._panels.set(config.id, state);

    header.addEventListener('click', () => {
      const isCollapsed = body.style.display === 'none';
      body.style.display = isCollapsed ? 'block' : 'none';
    });

    switch (config.side) {
      case 'left':  this._leftSidebar.appendChild(container); break;
      case 'right': this._rightSidebar.appendChild(container); break;
      case 'bottom': this._bottomPanel.appendChild(container); break;
    }
  }

  getPanelBody(id: string): HTMLDivElement | null {
    return this._panels.get(id)?.body ?? null;
  }

  showPanel(id: string): void {
    const p = this._panels.get(id);
    if (p) { p.visible = true; p.container.style.display = 'flex'; }
  }

  hidePanel(id: string): void {
    const p = this._panels.get(id);
    if (p) { p.visible = false; p.container.style.display = 'none'; }
  }

  togglePanel(id: string): void {
    const p = this._panels.get(id);
    if (p) p.visible ? this.hidePanel(id) : this.showPanel(id);
  }

  showBottom(): void {
    this._bottomVisible = true;
    this._bottomPanel.style.display = 'flex';
    this._updateGrid();
  }

  hideBottom(): void {
    this._bottomVisible = false;
    this._bottomPanel.style.display = 'none';
    this._updateGrid();
  }

  setLeftWidth(w: number): void {
    this._leftWidth = Math.max(SIZES.panelMinWidth, w);
    this._updateGrid();
  }

  setRightWidth(w: number): void {
    this._rightWidth = Math.max(SIZES.panelMinWidth, w);
    this._updateGrid();
  }

  private _updateGrid(): void {
    if (this._bottomVisible) {
      this.root.style.gridTemplateRows = `1fr ${this._bottomHeight}px`;
    } else {
      this.root.style.gridTemplateRows = '1fr';
    }
    this.root.style.gridTemplateColumns = `${this._leftWidth}px 1fr ${this._rightWidth}px`;
  }

  private _setupResizers(): void {
    const makeResizer = (side: 'left' | 'right') => {
      const r = el('div', {
        position: 'absolute',
        top: '0', width: '5px', height: '100%',
        cursor: 'col-resize', zIndex: '100',
        ...(side === 'left' ? { right: '-3px' } : { left: '-3px' }),
      });
      r.addEventListener('mouseenter', () => r.style.background = COLORS.accent + '40');
      r.addEventListener('mouseleave', () => { if (!r.dataset['dragging']) r.style.background = 'transparent'; });

      r.addEventListener('mousedown', (e) => {
        e.preventDefault();
        r.dataset['dragging'] = '1';
        r.style.background = COLORS.accent + '60';
        const startX = e.clientX;
        const startW = side === 'left' ? this._leftWidth : this._rightWidth;

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const newW = side === 'left' ? startW + dx : startW - dx;
          if (side === 'left') this.setLeftWidth(newW);
          else this.setRightWidth(newW);
        };
        const onUp = () => {
          delete r.dataset['dragging'];
          r.style.background = 'transparent';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      return r;
    };

    this._leftSidebar.style.position = 'relative';
    this._leftSidebar.appendChild(makeResizer('left'));
    this._rightSidebar.style.position = 'relative';
    this._rightSidebar.appendChild(makeResizer('right'));
  }

  destroy(): void {
    this.root.remove();
  }
}

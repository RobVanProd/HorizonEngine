import { COLORS, FONT, SIZES, el } from './theme.js';

export class StatusBar {
  readonly root: HTMLDivElement;
  private _left: HTMLDivElement;
  private _center: HTMLDivElement;
  private _right: HTMLDivElement;

  constructor() {
    this.root = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: `${SIZES.statusBarHeight}px`,
      background: COLORS.bgDark, borderTop: `1px solid ${COLORS.border}`,
      padding: '0 10px', fontSize: FONT.size.xs,
      color: COLORS.textMuted, userSelect: 'none',
    });

    this._left = el('div', { display: 'flex', gap: '12px', alignItems: 'center' });
    this._center = el('div', { display: 'flex', gap: '12px', alignItems: 'center' });
    this._right = el('div', { display: 'flex', gap: '12px', alignItems: 'center' });

    this.root.appendChild(this._left);
    this.root.appendChild(this._center);
    this.root.appendChild(this._right);

    this.setLeft('Ready');
    this.setRight('Horizon Engine v0.6');
  }

  setLeft(text: string): void { this._left.textContent = text; }
  setCenter(text: string): void { this._center.textContent = text; }
  setRight(text: string): void { this._right.textContent = text; }

  setFps(fps: number): void {
    const color = fps >= 55 ? COLORS.success : fps >= 30 ? COLORS.warning : COLORS.error;
    this._right.innerHTML = `<span style="color:${color}">${Math.round(fps)} FPS</span> <span style="margin-left:8px">Horizon Engine v0.6</span>`;
  }

  destroy(): void {
    this.root.remove();
  }
}

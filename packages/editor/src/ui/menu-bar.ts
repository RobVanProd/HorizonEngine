import { COLORS, FONT, SIZES, el } from './theme.js';

const BRAND_MARK_URL = new URL('../../../../horizon_mark.svg', import.meta.url).href;

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  children?: MenuItem[];
  disabled?: boolean;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

export class MenuBar {
  readonly root: HTMLDivElement;
  private _openMenu: HTMLDivElement | null = null;
  private _outsideHandler: ((e: MouseEvent) => void) | null = null;

  constructor(groups: MenuGroup[]) {
    this.root = el('div', {
      display: 'flex', alignItems: 'center',
      height: `${SIZES.menuBarHeight}px`,
      background: COLORS.bgDark, borderBottom: `1px solid ${COLORS.border}`,
      padding: '0 4px', gap: '0', userSelect: 'none',
      zIndex: '10000', position: 'relative',
    });

    const logo = el('div', {
      padding: '0 10px',
      display: 'flex', alignItems: 'center', gap: '8px',
      color: COLORS.accent,
    });
    const logoImg = document.createElement('img');
    logoImg.src = BRAND_MARK_URL;
    logoImg.alt = 'Horizon';
    Object.assign(logoImg.style, {
      width: '18px',
      height: '18px',
      display: 'block',
      filter: 'drop-shadow(0 0 6px rgba(106,230,255,0.18))',
    });
    const logoText = el('span', {
      fontWeight: '700',
      fontSize: FONT.size.lg,
      letterSpacing: '0.5px',
      color: '#f4f8ff',
    });
    logoText.textContent = 'Horizon';
    logo.appendChild(logoImg);
    logo.appendChild(logoText);
    this.root.appendChild(logo);

    for (const group of groups) {
      const btn = el('div', {
        padding: '2px 10px', cursor: 'pointer',
        borderRadius: '3px', fontSize: FONT.size.sm,
        color: COLORS.textDim, lineHeight: `${SIZES.menuBarHeight - 4}px`,
      });
      btn.textContent = group.label;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = COLORS.surfaceHover;
        btn.style.color = COLORS.text;
        if (this._openMenu) this._showDropdown(btn, group.items);
      });
      btn.addEventListener('mouseleave', () => {
        if (!this._openMenu) {
          btn.style.background = 'transparent';
          btn.style.color = COLORS.textDim;
        }
      });
      btn.addEventListener('click', () => {
        if (this._openMenu) {
          this._closeDropdown();
        } else {
          this._showDropdown(btn, group.items);
        }
      });

      this.root.appendChild(btn);
    }
  }

  private _showDropdown(anchor: HTMLElement, items: MenuItem[]): void {
    this._closeDropdown();

    const dd = el('div', {
      position: 'absolute',
      top: `${SIZES.menuBarHeight}px`,
      left: `${anchor.offsetLeft}px`,
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '4px',
      padding: '4px 0',
      minWidth: '200px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      zIndex: '10001',
    });

    for (const item of items) {
      if (item.separator) {
        const sep = el('div', {
          height: '1px', background: COLORS.border, margin: '4px 8px',
        });
        dd.appendChild(sep);
        continue;
      }

      const row = el('div', {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 12px', cursor: item.disabled ? 'default' : 'pointer',
        fontSize: FONT.size.sm,
        color: item.disabled ? COLORS.textMuted : COLORS.text,
        opacity: item.disabled ? '0.5' : '1',
      });

      const lbl = el('span');
      lbl.textContent = item.label;
      row.appendChild(lbl);

      if (item.shortcut) {
        const sc = el('span', { color: COLORS.textMuted, fontSize: FONT.size.xs, marginLeft: '20px' });
        sc.textContent = item.shortcut;
        row.appendChild(sc);
      }

      if (!item.disabled && item.action) {
        row.addEventListener('mouseenter', () => { row.style.background = COLORS.accent; row.style.color = COLORS.bgDark; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; row.style.color = COLORS.text; });
        row.addEventListener('click', () => {
          item.action!();
          this._closeDropdown();
        });
      }

      dd.appendChild(row);
    }

    this.root.appendChild(dd);
    this._openMenu = dd;

    this._outsideHandler = (e: MouseEvent) => {
      if (!this.root.contains(e.target as Node)) {
        this._closeDropdown();
      }
    };
    setTimeout(() => document.addEventListener('click', this._outsideHandler!), 0);
  }

  private _closeDropdown(): void {
    if (this._openMenu) {
      this._openMenu.remove();
      this._openMenu = null;
    }
    if (this._outsideHandler) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  destroy(): void {
    this._closeDropdown();
    this.root.remove();
  }
}

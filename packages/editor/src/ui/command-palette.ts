import { COLORS, FONT, el } from './theme.js';

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  action: () => void;
}

export class CommandPalette {
  readonly root: HTMLDivElement;
  private _backdrop: HTMLDivElement;
  private _panel: HTMLDivElement;
  private _input: HTMLInputElement;
  private _list: HTMLDivElement;
  private _items: CommandPaletteItem[] = [];
  private _filtered: CommandPaletteItem[] = [];
  private _visible = false;
  private _selectedIndex = 0;

  constructor() {
    this.root = el('div', {
      position: 'fixed',
      inset: '0',
      zIndex: '20000',
      display: 'none',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '10vh',
    });

    this._backdrop = el('div', {
      position: 'absolute',
      inset: '0',
      background: 'rgba(5,8,14,0.5)',
      backdropFilter: 'blur(8px)',
    });
    this._backdrop.addEventListener('click', () => this.hide());

    this._panel = el('div', {
      position: 'relative',
      width: 'min(720px, 88vw)',
      maxHeight: '70vh',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '14px',
      overflow: 'hidden',
      background: 'linear-gradient(180deg, rgba(17,24,39,0.98), rgba(10,14,24,0.98))',
      border: `1px solid ${COLORS.borderLight}`,
      boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
    });

    const header = el('div', {
      padding: '12px',
      borderBottom: `1px solid ${COLORS.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    });

    const hint = el('div', {
      color: COLORS.accentDim,
      fontFamily: FONT.mono,
      fontSize: FONT.size.sm,
      letterSpacing: '0.08em',
    });
    hint.textContent = 'COMMAND';

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.placeholder = 'Jump to action, tool, or workflow...';
    Object.assign(this._input.style, {
      flex: '1',
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      fontSize: FONT.size.lg,
      padding: '0',
    });
    this._input.addEventListener('input', () => this._filter());
    this._input.addEventListener('keydown', (e) => this._onKeyDown(e));

    header.appendChild(hint);
    header.appendChild(this._input);

    this._list = el('div', {
      overflowY: 'auto',
      padding: '8px',
      minHeight: '180px',
    });

    this._panel.appendChild(header);
    this._panel.appendChild(this._list);
    this.root.appendChild(this._backdrop);
    this.root.appendChild(this._panel);
    document.body.appendChild(this.root);
  }

  setItems(items: CommandPaletteItem[]): void {
    this._items = items;
    this._filter();
  }

  show(): void {
    this._visible = true;
    this.root.style.display = 'flex';
    this._input.value = '';
    this._selectedIndex = 0;
    this._filter();
    requestAnimationFrame(() => this._input.focus());
  }

  hide(): void {
    this._visible = false;
    this.root.style.display = 'none';
  }

  toggle(): void {
    this._visible ? this.hide() : this.show();
  }

  private _filter(): void {
    const q = this._input.value.trim().toLowerCase();
    this._filtered = this._items.filter((item) => {
      if (!q) return true;
      const haystack = [item.title, item.subtitle ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    this._selectedIndex = Math.min(this._selectedIndex, Math.max(this._filtered.length - 1, 0));
    this._render();
  }

  private _render(): void {
    this._list.innerHTML = '';
    if (this._filtered.length === 0) {
      const empty = el('div', {
        color: COLORS.textMuted,
        textAlign: 'center',
        padding: '24px 12px',
      });
      empty.textContent = 'No matching actions';
      this._list.appendChild(empty);
      return;
    }

    this._filtered.forEach((item, index) => {
      const row = el('div', {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '10px 12px',
        borderRadius: '10px',
        cursor: 'pointer',
        background: index === this._selectedIndex ? 'rgba(124,140,255,0.14)' : 'transparent',
        border: `1px solid ${index === this._selectedIndex ? 'rgba(124,140,255,0.28)' : 'transparent'}`,
        marginBottom: '4px',
      });
      row.addEventListener('mouseenter', () => {
        this._selectedIndex = index;
        this._render();
      });
      row.addEventListener('click', () => this._run(item));

      const title = el('div', {
        color: COLORS.text,
        fontSize: FONT.size.md,
        fontWeight: '600',
      });
      title.textContent = item.title;
      row.appendChild(title);

      if (item.subtitle) {
        const subtitle = el('div', {
          color: COLORS.textMuted,
          fontSize: FONT.size.sm,
        });
        subtitle.textContent = item.subtitle;
        row.appendChild(subtitle);
      }
      this._list.appendChild(row);
    });
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectedIndex = Math.min(this._selectedIndex + 1, Math.max(this._filtered.length - 1, 0));
      this._render();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
      this._render();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = this._filtered[this._selectedIndex];
      if (item) this._run(item);
    }
  }

  private _run(item: CommandPaletteItem): void {
    this.hide();
    item.action();
  }

  destroy(): void {
    this.root.remove();
  }
}

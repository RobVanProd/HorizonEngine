import type { Engine } from '@engine/core';
import { COLORS, FONT, el, esc } from '../ui/theme.js';
import { Icons } from '../ui/icons.js';

export type AssetType = 'mesh' | 'material' | 'texture' | 'audio' | 'scene' | 'model' | 'unknown';

export interface AssetEntry {
  id: string;
  name: string;
  type: AssetType;
  path?: string;
  handle?: number;
  thumbnail?: string;
}

const TYPE_ICONS: Record<AssetType, () => SVGSVGElement> = {
  mesh:     Icons.cube,
  material: Icons.box,
  texture:  Icons.image,
  audio:    Icons.music,
  scene:    Icons.layers,
  model:    Icons.film,
  unknown:  Icons.grid,
};

const TYPE_COLORS: Record<AssetType, string> = {
  mesh:     COLORS.blue,
  material: COLORS.purple,
  texture:  COLORS.green,
  audio:    COLORS.teal,
  scene:    COLORS.yellow,
  model:    COLORS.warning,
  unknown:  COLORS.textMuted,
};

export class AssetBrowser {
  readonly root: HTMLDivElement;
  private _engine: Engine;
  private _assets: AssetEntry[] = [];
  private _filter = '';
  private _filterType: AssetType | 'all' = 'all';
  private _searchInput: HTMLInputElement;
  private _typeBar: HTMLDivElement;
  private _grid: HTMLDivElement;
  private _onSelect: ((asset: AssetEntry) => void) | null = null;
  private _onDrop: ((files: FileList) => void) | null = null;

  constructor(engine: Engine) {
    this._engine = engine;

    this.root = el('div', {
      display: 'flex', flexDirection: 'column', height: '100%',
      fontSize: FONT.size.sm,
    });

    // Search bar
    const searchRow = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '6px 8px',
    });
    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search assets...';
    Object.assign(this._searchInput.style, {
      flex: '1', padding: '4px 8px', fontSize: FONT.size.sm,
    });
    this._searchInput.addEventListener('input', () => {
      this._filter = this._searchInput.value.toLowerCase();
      this._renderGrid();
    });
    searchRow.appendChild(this._searchInput);

    const importBtn = document.createElement('button');
    importBtn.title = 'Import Asset';
    importBtn.appendChild(Icons.plus());
    importBtn.addEventListener('click', () => this._importDialog());
    searchRow.appendChild(importBtn);
    this.root.appendChild(searchRow);

    // Type filter bar
    this._typeBar = el('div', {
      display: 'flex', gap: '2px', padding: '0 8px 6px',
      flexWrap: 'wrap',
    });
    const types: Array<AssetType | 'all'> = ['all', 'mesh', 'material', 'texture', 'audio', 'model', 'scene'];
    for (const t of types) {
      const btn = document.createElement('button');
      btn.textContent = t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1);
      Object.assign(btn.style, {
        fontSize: FONT.size.xs, padding: '1px 6px',
        borderRadius: '10px', lineHeight: '1.5',
      });
      if (t === this._filterType) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this._filterType = t;
        this._typeBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderGrid();
      });
      this._typeBar.appendChild(btn);
    }
    this.root.appendChild(this._typeBar);

    // Asset grid
    this._grid = el('div', {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: '4px', padding: '4px 8px',
      overflowY: 'auto', flex: '1',
    });
    this.root.appendChild(this._grid);

    // Drag and drop
    this.root.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.root.style.outline = `2px dashed ${COLORS.accent}`;
    });
    this.root.addEventListener('dragleave', () => {
      this.root.style.outline = 'none';
    });
    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      this.root.style.outline = 'none';
      if (e.dataTransfer?.files.length) {
        this._onDrop?.(e.dataTransfer.files);
      }
    });

    this._populateFromEngine();
  }

  onSelect(cb: (asset: AssetEntry) => void): void { this._onSelect = cb; }
  onDrop(cb: (files: FileList) => void): void { this._onDrop = cb; }

  addAsset(entry: AssetEntry): void {
    this._assets.push(entry);
    this._renderGrid();
  }

  refresh(): void {
    this._populateFromEngine();
  }

  private _populateFromEngine(): void {
    this._assets = [];

    // Meshes
    for (const [handle, mesh] of this._engine.meshes) {
      this._assets.push({
        id: `mesh-${handle}`, name: `Mesh #${handle}`, type: 'mesh', handle,
      });
    }

    // Materials
    for (const [handle] of this._engine.materials) {
      this._assets.push({
        id: `mat-${handle}`, name: `Material #${handle}`, type: 'material', handle,
      });
    }

    // Audio clips
    for (const [handle] of this._engine.audioClips) {
      this._assets.push({
        id: `audio-${handle}`, name: `Audio #${handle}`, type: 'audio', handle,
      });
    }

    this._renderGrid();
  }

  private _renderGrid(): void {
    this._grid.innerHTML = '';

    const filtered = this._assets.filter(a => {
      if (this._filterType !== 'all' && a.type !== this._filterType) return false;
      if (this._filter && !a.name.toLowerCase().includes(this._filter)) return false;
      return true;
    });

    if (filtered.length === 0) {
      const empty = el('div', {
        gridColumn: '1 / -1',
        textAlign: 'center', padding: '20px',
        color: COLORS.textMuted, fontSize: FONT.size.sm,
      });
      empty.textContent = this._assets.length === 0
        ? 'No assets. Drag files here to import.'
        : 'No matching assets.';
      this._grid.appendChild(empty);
      return;
    }

    for (const asset of filtered) {
      const card = el('div', {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '6px 4px', borderRadius: '4px', cursor: 'pointer',
        border: `1px solid transparent`,
        gap: '3px',
      });
      card.addEventListener('mouseenter', () => {
        card.style.background = COLORS.surfaceHover;
        card.style.borderColor = COLORS.border;
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = 'transparent';
        card.style.borderColor = 'transparent';
      });
      card.addEventListener('click', () => this._onSelect?.(asset));

      // Make draggable
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-engine-asset', JSON.stringify(asset));
      });

      const iconWrapper = el('div', {
        width: '40px', height: '40px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: COLORS.surface, borderRadius: '4px',
        color: TYPE_COLORS[asset.type] ?? COLORS.textMuted,
      });
      const iconFn = TYPE_ICONS[asset.type] ?? TYPE_ICONS.unknown;
      iconWrapper.appendChild(iconFn());
      card.appendChild(iconWrapper);

      const label = el('div', {
        fontSize: FONT.size.xs, textAlign: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', width: '100%',
        color: COLORS.textDim,
      });
      label.textContent = asset.name;
      label.title = asset.name;
      card.appendChild(label);

      this._grid.appendChild(card);
    }
  }

  private _importDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.gltf,.glb,.hdr,.png,.jpg,.jpeg,.wav,.mp3,.ogg,.json';
    input.addEventListener('change', () => {
      if (input.files?.length) {
        this._onDrop?.(input.files);
      }
    });
    input.click();
  }

  destroy(): void {
    this.root.remove();
  }
}

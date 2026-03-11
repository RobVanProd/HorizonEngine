import type { Engine } from '@engine/core';
import { Parent, MeshRef, SkeletonRef, Visible, AudioSource, MaterialRef, LocalTransform, WorldMatrix } from '@engine/ecs';
import { Selection } from '../picking/selection.js';
import { COLORS, FONT, el, esc } from '../ui/theme.js';
import { Icons } from '../ui/icons.js';

interface HNode {
  id: number;
  children: HNode[];
  label: string;
  hasComponents: string[];
}

export class SceneHierarchyPanel {
  readonly root: HTMLDivElement;
  private _engine: Engine;
  private _selection: Selection;
  private _search: HTMLInputElement;
  private _tree: HTMLDivElement;
  private _filter = '';
  private _collapsed = new Set<number>();
  private _dirty = true;
  private _lastSignature = '';

  constructor(engine: Engine, selection: Selection) {
    this._engine = engine;
    this._selection = selection;
    this._selection.onChange(() => {
      this._dirty = true;
      this._renderIfNeeded();
    });

    this.root = el('div', {
      display: 'flex', flexDirection: 'column', height: '100%',
    });

    // Header with search and add button
    const headerRow = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '6px 8px',
    });

    this._search = document.createElement('input');
    this._search.type = 'text';
    this._search.placeholder = 'Search...';
    Object.assign(this._search.style, {
      flex: '1', padding: '4px 8px', fontSize: FONT.size.sm,
    });
    this._search.addEventListener('input', () => {
      this._filter = this._search.value.toLowerCase();
      this._dirty = true;
      this._renderIfNeeded();
    });
    headerRow.appendChild(this._search);

    const addBtn = document.createElement('button');
    addBtn.title = 'New Entity';
    addBtn.appendChild(Icons.plus());
    addBtn.addEventListener('click', () => {
      const id = this._engine.world.spawn().id;
      this._engine.world.addComponent(id, LocalTransform, {
        px: 0, py: 0, pz: 0, rotX: 0, rotY: 0, rotZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
      this._engine.world.addComponent(id, WorldMatrix, {
        m0: 1, m1: 0, m2: 0, m3: 0,
        m4: 0, m5: 1, m6: 0, m7: 0,
        m8: 0, m9: 0, m10: 1, m11: 0,
        m12: 0, m13: 0, m14: 0, m15: 1,
      });
      this._engine.world.addComponent(id, Visible);
      this._selection.select(id);
      this._dirty = true;
      this._renderIfNeeded();
    });
    headerRow.appendChild(addBtn);
    this.root.appendChild(headerRow);

    this._tree = el('div', { flex: '1', overflowY: 'auto', padding: '0 4px 4px' });
    this.root.appendChild(this._tree);
  }

  update(): void {
    this._renderIfNeeded();
  }

  private _buildHierarchy(): HNode[] {
    const world = this._engine.world;
    const childOf = new Map<number, number>();

    const parentQuery = world.query(Parent);
    parentQuery.each((arch, count) => {
      const parentCol = arch.getColumn(Parent, 'entity') as Uint32Array;
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) childOf.set(ids[i]!, parentCol[i]!);
    });

    const idSet = new Set<number>();
    // Gather from Visible
    world.query(Visible).each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) idSet.add(ids[i]!);
    });
    // Also from LocalTransform
    world.query(LocalTransform).each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) idSet.add(ids[i]!);
    });
    for (const [child, parent] of childOf) { idSet.add(child); idSet.add(parent); }

    const nodes = new Map<number, HNode>();
    for (const id of idSet) {
      if (!world.has(id)) continue;
      const comps: string[] = [];
      if (world.hasComponent(id, MeshRef)) comps.push('Mesh');
      if (world.hasComponent(id, SkeletonRef)) comps.push('Skel');
      if (world.hasComponent(id, AudioSource)) comps.push('Audio');
      if (world.hasComponent(id, MaterialRef)) comps.push('Mat');
      const readableLabel = this._engine.getEntityLabel(id) ?? `Entity #${id}`;
      const labelParts = [readableLabel];
      if (world.hasComponent(id, LocalTransform)) {
        const px = world.getField(id, LocalTransform, 'px');
        const py = world.getField(id, LocalTransform, 'py');
        const pz = world.getField(id, LocalTransform, 'pz');
        labelParts.push(`[#${id}]`);
        labelParts.push(`(${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)})`);
      } else {
        labelParts.push(`[#${id}]`);
      }
      nodes.set(id, { id, children: [], label: labelParts.join(' '), hasComponents: comps });
    }

    const roots: HNode[] = [];
    for (const [id, node] of nodes) {
      const parentId = childOf.get(id);
      if (parentId !== undefined && nodes.has(parentId)) {
        nodes.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    sortHierarchyNodes(roots);
    return roots;
  }

  private _renderIfNeeded(): void {
    const signature = `${this._engine.world.entityCount}|${this._selection.first ?? -1}|${this._selection.count}|${this._filter}|${this._collapsed.size}`;
    if (!this._dirty && signature === this._lastSignature) return;
    this._lastSignature = signature;
    this._dirty = false;

    this._tree.innerHTML = '';
    const hierarchy = this._buildHierarchy();
    this._renderNodes(this._tree, hierarchy, 0);
  }

  private _renderNodes(container: HTMLElement, nodes: HNode[], depth: number): void {
    for (const node of nodes) {
      if (this._filter && !node.label.toLowerCase().includes(this._filter) && node.children.length === 0) continue;

      const row = el('div', {
        display: 'flex', alignItems: 'center', gap: '2px',
        padding: '2px 4px',
        paddingLeft: `${depth * 14 + 4}px`,
        cursor: 'pointer', borderRadius: '3px',
        fontSize: FONT.size.sm,
        background: this._selection.has(node.id) ? COLORS.selection : 'transparent',
        border: this._selection.has(node.id) ? `1px solid ${COLORS.selectionBorder}40` : '1px solid transparent',
      });

      // Expand/collapse arrow
      if (node.children.length > 0) {
        const arrow = el('span', { fontSize: '10px', color: COLORS.textMuted, width: '12px', textAlign: 'center' });
        arrow.textContent = this._collapsed.has(node.id) ? '▸' : '▾';
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._collapsed.has(node.id)) this._collapsed.delete(node.id);
          else this._collapsed.add(node.id);
          this._dirty = true;
          this._renderIfNeeded();
        });
        row.appendChild(arrow);
      } else {
        row.appendChild(el('span', { width: '12px' }));
      }

      // Icon
      const icon = el('span', { color: COLORS.textMuted, fontSize: '10px', marginRight: '2px' });
      icon.appendChild(Icons.cube());
      row.appendChild(icon);

      // Label
      const lbl = el('span', { color: COLORS.text, flex: '1' });
      lbl.textContent = node.label;
      row.appendChild(lbl);

      // Component badges
      for (const comp of node.hasComponents) {
        const badge = el('span', {
          fontSize: FONT.size.xs, color: COLORS.textMuted,
          background: COLORS.surface, padding: '0 3px', borderRadius: '2px',
          marginLeft: '2px',
        });
        badge.textContent = comp;
        row.appendChild(badge);
      }

      row.addEventListener('mouseenter', () => {
        if (!this._selection.has(node.id)) row.style.background = COLORS.surfaceHover;
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = this._selection.has(node.id) ? COLORS.selection : 'transparent';
      });
      row.addEventListener('click', (e) => {
        this._selection.select(node.id, e.ctrlKey || e.metaKey);
      });

      container.appendChild(row);

      if (node.children.length > 0 && !this._collapsed.has(node.id)) {
        this._renderNodes(container, node.children, depth + 1);
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}

function sortHierarchyNodes(nodes: HNode[]): void {
  nodes.sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
  for (const node of nodes) {
    if (node.children.length > 0) sortHierarchyNodes(node.children);
  }
}

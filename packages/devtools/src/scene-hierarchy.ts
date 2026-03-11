import type { Engine } from '@engine/core';
import { Parent, MeshRef, SkeletonRef, Visible, AudioSource } from '@engine/ecs';
import type { EntityInspector } from './entity-inspector.js';

interface HierarchyNode {
  id: number;
  children: HierarchyNode[];
  label: string;
}

/**
 * Scene hierarchy tree view panel.
 * Shows parent/child entity relationships with search and click-to-select.
 */
export class SceneHierarchy {
  private _root: HTMLDivElement;
  private _search: HTMLInputElement;
  private _tree: HTMLDivElement;
  private _engine: Engine;
  private _inspector: EntityInspector | null = null;
  private _visible = false;
  private _filter = '';

  constructor(engine: Engine) {
    this._engine = engine;

    this._root = document.createElement('div');
    this._root.className = 'engine-scene-hierarchy';
    Object.assign(this._root.style, {
      position: 'fixed', top: '8px', left: '340px', zIndex: '99997',
      background: 'rgba(15,15,20,0.92)', color: '#e0e0e0',
      fontFamily: 'Consolas, "Fira Code", monospace', fontSize: '11px',
      borderRadius: '6px', padding: '10px', width: '220px',
      maxHeight: '80vh', overflowY: 'auto',
      backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
      display: 'none', userSelect: 'none', lineHeight: '1.6',
    });

    this._search = document.createElement('input');
    this._search.type = 'text';
    this._search.placeholder = 'Search entities...';
    Object.assign(this._search.style, {
      width: '100%', boxSizing: 'border-box',
      background: '#222', border: '1px solid #444', color: '#fff',
      fontSize: '10px', padding: '3px 6px', borderRadius: '3px', marginBottom: '6px',
    });
    this._search.addEventListener('input', () => {
      this._filter = this._search.value.toLowerCase();
      this.update();
    });

    this._tree = document.createElement('div');
    this._root.appendChild(this._search);
    this._root.appendChild(this._tree);
    document.body.appendChild(this._root);
  }

  get visible(): boolean { return this._visible; }

  show(): void { this._visible = true; this._root.style.display = 'block'; }
  hide(): void { this._visible = false; this._root.style.display = 'none'; }
  toggle(): void { this._visible ? this.hide() : this.show(); }

  bindInspector(inspector: EntityInspector): void {
    this._inspector = inspector;
  }

  update(): void {
    if (!this._visible) return;
    const world = this._engine.world;
    const hierarchy = this._buildHierarchy();
    this._tree.innerHTML = this._renderNodes(hierarchy, 0);

    // Bind click events
    this._tree.querySelectorAll('[data-eid]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const eid = parseInt((el as HTMLElement).dataset['eid']!);
        if (this._inspector) this._inspector.selectEntity(eid);
      });
    });
  }

  destroy(): void {
    this._root.remove();
  }

  private _buildHierarchy(): HierarchyNode[] {
    const world = this._engine.world;
    const allEntities: number[] = [];
    const childOf = new Map<number, number>();

    // Collect all entities and parent relationships
    const parentQuery = world.query(Parent);
    parentQuery.each((arch, count) => {
      const parentCol = arch.getColumn(Parent, 'entity') as Uint32Array;
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) {
        childOf.set(ids[i]!, parentCol[i]!);
      }
    });

    // Gather all entity IDs by iterating visible + mesh entities
    const visQ = world.query(Visible);
    const idSet = new Set<number>();
    visQ.each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) idSet.add(ids[i]!);
    });

    // Also add any parents that might not be visible
    for (const [child, parent] of childOf) {
      idSet.add(child);
      idSet.add(parent);
    }

    // Build nodes
    const nodes = new Map<number, HierarchyNode>();
    for (const id of idSet) {
      if (!world.has(id)) continue;
      const label = this._entityLabel(id);
      nodes.set(id, { id, children: [], label });
    }

    // Wire parent-child
    const roots: HierarchyNode[] = [];
    for (const [id, node] of nodes) {
      const parentId = childOf.get(id);
      if (parentId !== undefined && nodes.has(parentId)) {
        nodes.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    roots.sort((a, b) => a.id - b.id);
    return roots;
  }

  private _entityLabel(id: number): string {
    const world = this._engine.world;
    const parts: string[] = [`#${id}`];
    if (world.hasComponent(id, MeshRef)) parts.push('Mesh');
    if (world.hasComponent(id, SkeletonRef)) parts.push('Skel');
    if (world.hasComponent(id, AudioSource)) parts.push('Audio');
    return parts.join(' ');
  }

  private _renderNodes(nodes: HierarchyNode[], depth: number): string {
    let html = '';
    for (const node of nodes) {
      if (this._filter && !node.label.toLowerCase().includes(this._filter)) {
        if (node.children.length === 0) continue;
      }

      const indent = depth * 12;
      const selected = this._inspector?.selectedEntity === node.id;
      const bg = selected ? 'rgba(66,165,245,0.25)' : 'transparent';
      const arrow = node.children.length > 0 ? '▸ ' : '  ';

      html += `<div data-eid="${node.id}" style="padding:1px 4px;padding-left:${indent + 4}px;cursor:pointer;background:${bg};border-radius:2px" ` +
        `onmouseover="this.style.background='rgba(255,255,255,0.05)'" ` +
        `onmouseout="this.style.background='${bg}'"` +
        `>${arrow}${esc(node.label)}</div>`;

      if (node.children.length > 0) {
        html += this._renderNodes(node.children, depth + 1);
      }
    }
    return html;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

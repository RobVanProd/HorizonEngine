import type { Engine } from '@engine/core';
import type { World } from '@engine/ecs';
import { LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible, SkeletonRef, AnimationPlayer, AudioSource, AudioListener } from '@engine/ecs';
import type { ComponentDef } from '@engine/ecs';

const KNOWN_COMPONENTS: ComponentDef[] = [
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
];

/**
 * Entity inspector panel — shows component data for a selected entity.
 * Supports click-to-select and editable transform/material fields.
 */
export class EntityInspector {
  private _root: HTMLDivElement;
  private _engine: Engine;
  private _selectedEntity: number | null = null;
  private _visible = false;
  private _onSelectCallbacks: Array<(id: number | null) => void> = [];

  constructor(engine: Engine) {
    this._engine = engine;

    this._root = document.createElement('div');
    this._root.className = 'engine-entity-inspector';
    Object.assign(this._root.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '99998',
      background: 'rgba(15,15,20,0.92)', color: '#e0e0e0',
      fontFamily: 'Consolas, "Fira Code", monospace', fontSize: '11px',
      borderRadius: '6px', padding: '10px', minWidth: '260px', maxWidth: '320px',
      maxHeight: '80vh', overflowY: 'auto',
      backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
      display: 'none', userSelect: 'none', lineHeight: '1.5',
    });

    document.body.appendChild(this._root);
  }

  get visible(): boolean { return this._visible; }
  get selectedEntity(): number | null { return this._selectedEntity; }

  show(): void { this._visible = true; this._root.style.display = 'block'; }
  hide(): void { this._visible = false; this._root.style.display = 'none'; }
  toggle(): void { this._visible ? this.hide() : this.show(); }

  onSelect(cb: (id: number | null) => void): void {
    this._onSelectCallbacks.push(cb);
  }

  selectEntity(entityId: number | null): void {
    this._selectedEntity = entityId;
    for (const cb of this._onSelectCallbacks) cb(entityId);
    this.update();
  }

  update(): void {
    if (!this._visible) return;
    const world = this._engine.world;

    if (this._selectedEntity === null || !world.has(this._selectedEntity)) {
      this._root.innerHTML = `
        <div style="color:#888;font-style:italic">No entity selected</div>
        <div style="margin-top:4px;font-size:10px;color:#666">
          Click an entity ID in the hierarchy, or use: inspector.selectEntity(id)
        </div>
      `;
      return;
    }

    const id = this._selectedEntity;
    const sections: string[] = [];
    sections.push(`<div style="font-size:13px;font-weight:bold;margin-bottom:6px;color:#fff">Entity #${id}</div>`);

    for (const comp of KNOWN_COMPONENTS) {
      if (!world.hasComponent(id, comp)) continue;

      sections.push(`<div style="margin-top:6px;color:#4FC3F7;font-weight:bold;font-size:11px">${esc(comp.name)}</div>`);

      for (const fieldName of comp.fieldNames) {
        const value = world.getField(id, comp, fieldName);
        const isEditable = comp === LocalTransform;

        if (isEditable) {
          sections.push(
            `<div style="display:flex;justify-content:space-between;align-items:center">` +
            `<span style="color:#ccc">${esc(fieldName)}</span>` +
            `<input type="number" step="0.1" value="${value.toFixed(3)}" ` +
            `style="width:70px;background:#222;border:1px solid #444;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px" ` +
            `data-entity="${id}" data-comp="${comp.name}" data-field="${fieldName}" ` +
            `class="inspector-field"/>` +
            `</div>`,
          );
        } else {
          sections.push(
            `<div style="display:flex;justify-content:space-between">` +
            `<span style="color:#ccc">${esc(fieldName)}</span>` +
            `<span style="color:#aaa">${formatValue(value)}</span></div>`,
          );
        }
      }
    }

    this._root.innerHTML = sections.join('');

    // Bind editable fields
    this._root.querySelectorAll('.inspector-field').forEach((input) => {
      (input as HTMLInputElement).addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const eid = parseInt(el.dataset['entity']!);
        const field = el.dataset['field']!;
        const val = parseFloat(el.value);
        if (!isNaN(val) && world.has(eid)) {
          world.setField(eid, LocalTransform, field as any, val);
        }
      });
    });
  }

  destroy(): void {
    this._root.remove();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

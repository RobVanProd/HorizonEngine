import type { Engine } from '@engine/core';
import { LocalTransform, MeshRef, MaterialRef, Visible, SkeletonRef, AnimationPlayer, AudioSource, AudioListener } from '@engine/ecs';
import type { ComponentDef } from '@engine/ecs';

const ADDABLE_COMPONENTS: ComponentDef[] = [
  LocalTransform, MeshRef, MaterialRef, Visible, SkeletonRef,
  AnimationPlayer, AudioSource, AudioListener,
];

/**
 * Component editor panel — add/remove components, edit AnimationPlayer and AudioSource.
 */
export class ComponentEditor {
  private _root: HTMLDivElement;
  private _engine: Engine;
  private _visible = false;
  private _entityId: number | null = null;

  constructor(engine: Engine) {
    this._engine = engine;

    this._root = document.createElement('div');
    this._root.className = 'engine-component-editor';
    Object.assign(this._root.style, {
      position: 'fixed', bottom: '8px', left: '8px', zIndex: '99996',
      background: 'rgba(15,15,20,0.92)', color: '#e0e0e0',
      fontFamily: 'Consolas, "Fira Code", monospace', fontSize: '11px',
      borderRadius: '6px', padding: '10px', minWidth: '260px', maxWidth: '320px',
      maxHeight: '40vh', overflowY: 'auto',
      backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
      display: 'none', userSelect: 'none', lineHeight: '1.5',
    });

    document.body.appendChild(this._root);
  }

  get visible(): boolean { return this._visible; }

  show(): void { this._visible = true; this._root.style.display = 'block'; }
  hide(): void { this._visible = false; this._root.style.display = 'none'; }
  toggle(): void { this._visible ? this.hide() : this.show(); }

  setEntity(entityId: number | null): void {
    this._entityId = entityId;
    this.update();
  }

  update(): void {
    if (!this._visible) return;
    const world = this._engine.world;

    if (this._entityId === null || !world.has(this._entityId)) {
      this._root.innerHTML = '<div style="color:#888;font-style:italic">No entity selected</div>';
      return;
    }

    const id = this._entityId;
    const sections: string[] = [];
    sections.push(`<div style="font-size:12px;font-weight:bold;margin-bottom:6px;color:#fff">Components — Entity #${id}</div>`);

    // Show add/remove buttons
    sections.push('<div style="margin-bottom:6px">');
    for (const comp of ADDABLE_COMPONENTS) {
      const has = world.hasComponent(id, comp);
      const color = has ? '#4CAF50' : '#666';
      const action = has ? 'remove' : 'add';
      sections.push(
        `<span data-action="${action}" data-comp="${comp.name}" ` +
        `style="display:inline-block;margin:2px;padding:2px 6px;border-radius:3px;` +
        `background:${has ? 'rgba(76,175,80,0.2)' : 'rgba(100,100,100,0.2)'};` +
        `color:${color};cursor:pointer;font-size:10px;border:1px solid ${color}40" ` +
        `class="comp-toggle">${comp.name}</span>`,
      );
    }
    sections.push('</div>');

    // AnimationPlayer editor
    if (world.hasComponent(id, AnimationPlayer)) {
      const clipHandle = world.getField(id, AnimationPlayer, 'clipHandle');
      const time = world.getField(id, AnimationPlayer, 'time');
      const speed = world.getField(id, AnimationPlayer, 'speed');
      const flags = world.getField(id, AnimationPlayer, 'flags');
      const playing = (flags & 1) !== 0;
      const looping = (flags & 2) !== 0;

      sections.push(`<div style="margin-top:6px;color:#FF9800;font-weight:bold">AnimationPlayer</div>`);
      sections.push(makeRow('Clip', String(clipHandle)));
      sections.push(makeRow('Time', time.toFixed(2) + 's'));
      sections.push(makeNumberInput('Speed', speed, 'anim-speed'));
      sections.push(makeCheckbox('Playing', playing, 'anim-playing'));
      sections.push(makeCheckbox('Looping', looping, 'anim-looping'));
    }

    // AudioSource editor
    if (world.hasComponent(id, AudioSource)) {
      const clip = world.getField(id, AudioSource, 'clipHandle');
      const volume = world.getField(id, AudioSource, 'volume');
      const flags = world.getField(id, AudioSource, 'flags');
      const playing = (flags & 1) !== 0;
      const spatial = (flags & 4) !== 0;

      sections.push(`<div style="margin-top:6px;color:#03A9F4;font-weight:bold">AudioSource</div>`);
      sections.push(makeRow('Clip', String(clip)));
      sections.push(makeNumberInput('Volume', volume, 'audio-volume'));
      sections.push(makeCheckbox('Playing', playing, 'audio-playing'));
      sections.push(makeCheckbox('Spatial', spatial, 'audio-spatial'));
    }

    this._root.innerHTML = sections.join('');
    this._bindEvents(id);
  }

  destroy(): void {
    this._root.remove();
  }

  private _bindEvents(id: number): void {
    const world = this._engine.world;

    // Component add/remove
    this._root.querySelectorAll('.comp-toggle').forEach(el => {
      el.addEventListener('click', () => {
        const compName = (el as HTMLElement).dataset['comp']!;
        const action = (el as HTMLElement).dataset['action']!;
        const comp = ADDABLE_COMPONENTS.find(c => c.name === compName);
        if (!comp || !world.has(id)) return;

        if (action === 'add') {
          world.addComponent(id, comp);
        } else {
          world.removeComponent(id, comp);
        }
        this.update();
      });
    });

    // Animation speed
    const speedInput = this._root.querySelector('[data-id="anim-speed"]') as HTMLInputElement | null;
    speedInput?.addEventListener('change', () => {
      if (!world.has(id)) return;
      world.setField(id, AnimationPlayer, 'speed', parseFloat(speedInput.value) || 1);
    });

    // Animation checkboxes
    this._root.querySelector('[data-id="anim-playing"]')?.addEventListener('change', (e) => {
      if (!world.has(id)) return;
      const flags = world.getField(id, AnimationPlayer, 'flags');
      const checked = (e.target as HTMLInputElement).checked;
      world.setField(id, AnimationPlayer, 'flags', checked ? flags | 1 : flags & ~1);
    });
    this._root.querySelector('[data-id="anim-looping"]')?.addEventListener('change', (e) => {
      if (!world.has(id)) return;
      const flags = world.getField(id, AnimationPlayer, 'flags');
      const checked = (e.target as HTMLInputElement).checked;
      world.setField(id, AnimationPlayer, 'flags', checked ? flags | 2 : flags & ~2);
    });

    // Audio volume
    const volInput = this._root.querySelector('[data-id="audio-volume"]') as HTMLInputElement | null;
    volInput?.addEventListener('change', () => {
      if (!world.has(id)) return;
      world.setField(id, AudioSource, 'volume', parseFloat(volInput.value) || 1);
    });
  }
}

function makeRow(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between"><span style="color:#ccc">${label}</span><span style="color:#aaa">${value}</span></div>`;
}

function makeNumberInput(label: string, value: number, id: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center">` +
    `<span style="color:#ccc">${label}</span>` +
    `<input type="number" step="0.1" value="${value.toFixed(2)}" data-id="${id}" ` +
    `style="width:60px;background:#222;border:1px solid #444;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px"/>` +
    `</div>`;
}

function makeCheckbox(label: string, checked: boolean, id: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center">` +
    `<span style="color:#ccc">${label}</span>` +
    `<input type="checkbox" ${checked ? 'checked' : ''} data-id="${id}" ` +
    `style="accent-color:#4FC3F7"/>` +
    `</div>`;
}

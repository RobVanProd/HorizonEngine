import type { Engine } from '@engine/core';
import type { PBRMaterial, PBRMaterialParams } from '@engine/renderer-webgpu';
import { MaterialRef } from '@engine/ecs';
import { Selection } from '../picking/selection.js';
import { COLORS, FONT, el } from '../ui/theme.js';

interface ColorField {
  label: string;
  inputs: HTMLInputElement[];
  component: 'r' | 'g' | 'b' | 'a';
}

export class MaterialEditor {
  readonly root: HTMLDivElement;
  private _engine: Engine;
  private _selection: Selection;
  private _content: HTMLDivElement;
  private _currentMatHandle: number | null = null;

  constructor(engine: Engine, selection: Selection) {
    this._engine = engine;
    this._selection = selection;

    this.root = el('div', {
      display: 'flex', flexDirection: 'column', height: '100%',
    });

    this._content = el('div', { flex: '1', overflowY: 'auto', padding: '8px' });
    this.root.appendChild(this._content);

    selection.onChange(() => this._rebuild());
  }

  update(): void {
    // Live update from material state — only if user is not editing
  }

  private _rebuild(): void {
    this._content.innerHTML = '';
    this._currentMatHandle = null;

    const entityId = this._selection.first;
    if (entityId === null) {
      this._showEmpty('Select an entity with a material.');
      return;
    }

    const world = this._engine.world;
    if (!world.has(entityId) || !world.hasComponent(entityId, MaterialRef)) {
      this._showEmpty('Selected entity has no MaterialRef.');
      return;
    }

    const matHandle = world.getField(entityId, MaterialRef, 'handle');
    const material = this._engine.materials.get(matHandle);
    if (!material) {
      this._showEmpty(`Material #${matHandle} not found.`);
      return;
    }

    this._currentMatHandle = matHandle;

    const title = el('div', {
      fontSize: FONT.size.lg, fontWeight: '600', color: COLORS.accent, marginBottom: '8px',
    });
    title.textContent = `Material #${matHandle}`;
    this._content.appendChild(title);

    // Albedo color
    const albedoData = material.albedo;
    this._addColorPicker('Albedo', albedoData, (rgba) => {
      material.updateParams({ albedo: rgba });
    });

    // Roughness
    this._addSlider('Roughness', material.roughness, 0, 1, (v) => {
      material.updateParams({ roughness: v });
    });

    // Metallic
    this._addSlider('Metallic', material.metallic, 0, 1, (v) => {
      material.updateParams({ metallic: v });
    });

    // AO
    this._addSlider('AO', material.ao, 0, 1, (v) => {
      material.updateParams({ ao: v });
    });

    // Emissive
    const emissive = material.emissive;
    this._addColorPicker3('Emissive', emissive, (rgb) => {
      material.updateParams({ emissive: rgb });
    });

    // Preview swatch
    const preview = el('div', {
      width: '100%', height: '40px', borderRadius: '4px', marginTop: '8px',
      border: `1px solid ${COLORS.border}`,
    });
    const r = Math.round(albedoData[0] * 255);
    const g = Math.round(albedoData[1] * 255);
    const b = Math.round(albedoData[2] * 255);
    preview.style.background = `rgb(${r},${g},${b})`;
    this._content.appendChild(preview);
  }

  private _addColorPicker(
    label: string,
    current: [number, number, number, number],
    onChange: (rgba: [number, number, number, number]) => void,
  ): void {
    const section = el('div', { marginBottom: '6px' });
    const lbl = el('div', { color: COLORS.textDim, fontSize: FONT.size.xs, marginBottom: '2px' });
    lbl.textContent = label;
    section.appendChild(lbl);

    const row = el('div', { display: 'flex', gap: '4px', alignItems: 'center' });

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    const hex = '#' + [current[0], current[1], current[2]]
      .map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('');
    colorInput.value = hex;
    Object.assign(colorInput.style, {
      width: '30px', height: '24px', padding: '0', border: 'none', cursor: 'pointer',
    });

    const alphaInput = document.createElement('input');
    alphaInput.type = 'number';
    alphaInput.min = '0'; alphaInput.max = '1'; alphaInput.step = '0.05';
    alphaInput.value = current[3].toFixed(2);
    Object.assign(alphaInput.style, { width: '50px', fontSize: FONT.size.xs });

    const update = () => {
      const h = colorInput.value;
      const r = parseInt(h.slice(1, 3), 16) / 255;
      const g = parseInt(h.slice(3, 5), 16) / 255;
      const b = parseInt(h.slice(5, 7), 16) / 255;
      const a = parseFloat(alphaInput.value) || 1;
      onChange([r, g, b, a]);
    };

    colorInput.addEventListener('input', update);
    alphaInput.addEventListener('change', update);
    row.appendChild(colorInput);
    row.appendChild(alphaInput);
    section.appendChild(row);
    this._content.appendChild(section);
  }

  private _addColorPicker3(
    label: string,
    current: [number, number, number],
    onChange: (rgb: [number, number, number]) => void,
  ): void {
    const section = el('div', { marginBottom: '6px' });
    const lbl = el('div', { color: COLORS.textDim, fontSize: FONT.size.xs, marginBottom: '2px' });
    lbl.textContent = label;
    section.appendChild(lbl);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    const hex = '#' + current
      .map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('');
    colorInput.value = hex;
    Object.assign(colorInput.style, {
      width: '30px', height: '24px', padding: '0', border: 'none', cursor: 'pointer',
    });

    colorInput.addEventListener('input', () => {
      const h = colorInput.value;
      const r = parseInt(h.slice(1, 3), 16) / 255;
      const g = parseInt(h.slice(3, 5), 16) / 255;
      const b = parseInt(h.slice(5, 7), 16) / 255;
      onChange([r, g, b]);
    });

    section.appendChild(colorInput);
    this._content.appendChild(section);
  }

  private _addSlider(
    label: string,
    current: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ): void {
    const section = el('div', { marginBottom: '6px' });
    const row = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    });

    const lbl = el('span', { color: COLORS.textDim, fontSize: FONT.size.xs });
    lbl.textContent = label;
    row.appendChild(lbl);

    const valueLabel = el('span', { color: COLORS.textMuted, fontSize: FONT.size.xs, minWidth: '35px', textAlign: 'right' });
    valueLabel.textContent = current.toFixed(2);
    row.appendChild(valueLabel);
    section.appendChild(row);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '0.01';
    slider.value = String(current);
    Object.assign(slider.style, {
      width: '100%', height: '4px', accentColor: COLORS.accent,
    });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valueLabel.textContent = v.toFixed(2);
      onChange(v);
    });

    section.appendChild(slider);
    this._content.appendChild(section);
  }

  private _showEmpty(msg: string): void {
    const p = el('div', { color: COLORS.textMuted, fontSize: FONT.size.sm, padding: '8px 0' });
    p.textContent = msg;
    this._content.appendChild(p);
  }

  destroy(): void {
    this.root.remove();
  }
}

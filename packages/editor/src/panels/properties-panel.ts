import type { Engine } from '@engine/core';
import type { ComponentDef } from '@engine/ecs';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
} from '@engine/ecs';
import { Selection } from '../picking/selection.js';
import { UndoRedoStack, fieldChangeCommand } from '../scene/undo-redo.js';
import { COLORS, FONT, el, esc } from '../ui/theme.js';
import { Icons } from '../ui/icons.js';

const KNOWN_COMPONENTS: ComponentDef[] = [
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
];

const EDITABLE_COMPONENTS = new Set<ComponentDef>([LocalTransform, AudioSource, AnimationPlayer]);

interface FieldRow {
  field: string;
  input: HTMLInputElement;
  comp: ComponentDef;
}

export class PropertiesPanel {
  readonly root: HTMLDivElement;
  private _engine: Engine;
  private _selection: Selection;
  private _undoStack: UndoRedoStack;
  private _content: HTMLDivElement;
  private _fieldRows: FieldRow[] = [];
  private _entityId: number | null = null;

  constructor(engine: Engine, selection: Selection, undoStack: UndoRedoStack) {
    this._engine = engine;
    this._selection = selection;
    this._undoStack = undoStack;

    this.root = el('div', {
      display: 'flex', flexDirection: 'column', height: '100%',
    });

    const header = el('div', {
      padding: '6px 8px',
      fontSize: FONT.size.lg, fontWeight: '600', color: COLORS.text,
    });
    header.textContent = 'Properties';
    this.root.appendChild(header);

    this._content = el('div', {
      flex: '1', overflowY: 'auto', padding: '0 8px 8px',
    });
    this.root.appendChild(this._content);

    selection.onChange((ids) => {
      this._entityId = ids.size === 1 ? ids.values().next().value! : null;
      this._rebuild();
    });
  }

  update(): void {
    if (this._entityId === null) return;
    const world = this._engine.world;
    if (!world.has(this._entityId)) {
      this._entityId = null;
      this._rebuild();
      return;
    }

    // Update non-editable fields display
    for (const row of this._fieldRows) {
      if (!EDITABLE_COMPONENTS.has(row.comp)) continue;
      if (document.activeElement === row.input) continue;
      const val = world.getField(this._entityId, row.comp, row.field as any);
      row.input.value = formatValue(val);
    }
  }

  private _rebuild(): void {
    this._content.innerHTML = '';
    this._fieldRows = [];

    if (this._entityId === null) {
      const empty = el('div', { color: COLORS.textMuted, padding: '12px 0', fontSize: FONT.size.sm });
      empty.textContent = 'No entity selected. Click an object in the viewport or hierarchy.';
      this._content.appendChild(empty);
      return;
    }

    const world = this._engine.world;
    const id = this._entityId;

    // Entity header
    const eHeader = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '8px',
    });
    const eName = el('div', { fontSize: FONT.size.lg, fontWeight: '600', color: COLORS.accent });
    eName.textContent = this._engine.getEntityLabel(id) ?? `Entity #${id}`;
    eHeader.appendChild(eName);

    const delBtn = document.createElement('button');
    delBtn.title = 'Delete Entity';
    delBtn.appendChild(Icons.trash());
    Object.assign(delBtn.style, { width: '24px', height: '24px', padding: '0', color: COLORS.error });
    delBtn.addEventListener('click', () => {
      world.destroy(id);
      this._selection.clear();
    });
    eHeader.appendChild(delBtn);
    this._content.appendChild(eHeader);
    this._content.appendChild(this._buildObservabilitySection(id));

    // Component sections
    for (const comp of KNOWN_COMPONENTS) {
      if (!world.hasComponent(id, comp)) continue;
      this._addComponentSection(id, comp);
    }

    // Add component button
    const addRow = el('div', { marginTop: '8px' });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Component';
    Object.assign(addBtn.style, { width: '100%', padding: '4px', fontSize: FONT.size.sm });
    addBtn.addEventListener('click', () => this._showAddComponentMenu(addRow));
    addRow.appendChild(addBtn);
    this._content.appendChild(addRow);
  }

  private _addComponentSection(entityId: number, comp: ComponentDef): void {
    const section = el('div', {
      marginBottom: '6px', borderRadius: '4px',
      background: COLORS.surface, overflow: 'hidden',
    });

    const sectionHeader = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 8px', cursor: 'pointer',
      background: COLORS.surfaceHover,
    });
    const title = el('span', { fontWeight: '600', color: COLORS.accentDim, fontSize: FONT.size.sm });
    title.textContent = comp.name;
    sectionHeader.appendChild(title);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    Object.assign(removeBtn.style, { width: '18px', height: '18px', padding: '0', fontSize: '14px', lineHeight: '1' });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._engine.world.removeComponent(entityId, comp);
      this._rebuild();
    });
    sectionHeader.appendChild(removeBtn);
    section.appendChild(sectionHeader);

    const body = el('div', { padding: '4px 8px' });
    const isEditable = EDITABLE_COMPONENTS.has(comp);

    for (const fieldName of comp.fieldNames) {
      const value = this._engine.world.getField(entityId, comp, fieldName);

      const row = el('div', {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '1px 0',
      });

      const label = el('span', { color: COLORS.textDim, fontSize: FONT.size.xs, minWidth: '70px' });
      label.textContent = fieldName;
      row.appendChild(label);

      if (isEditable) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.value = formatValue(value);
        Object.assign(input.style, {
          width: '70px', textAlign: 'right', fontSize: FONT.size.xs,
        });

        input.addEventListener('change', () => {
          const newVal = parseFloat(input.value);
          if (isNaN(newVal)) return;
          const oldVal = this._engine.world.getField(entityId, comp, fieldName);
          this._undoStack.execute(
            fieldChangeCommand(this._engine.world, entityId, comp, fieldName, oldVal, newVal),
          );
        });

        row.appendChild(input);
        this._fieldRows.push({ field: fieldName, input, comp });
      } else {
        const valSpan = el('span', { color: COLORS.textMuted, fontSize: FONT.size.xs });
        valSpan.textContent = formatValue(value);
        row.appendChild(valSpan);
      }

      body.appendChild(row);
    }

    // Collapsible
    let collapsed = false;
    sectionHeader.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
    });

    section.appendChild(body);
    this._content.appendChild(section);
  }

  private _showAddComponentMenu(container: HTMLElement): void {
    const world = this._engine.world;
    const id = this._entityId;
    if (id === null) return;

    const existing = container.querySelector('.add-comp-menu');
    if (existing) { existing.remove(); return; }

    const menu = el('div', {
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: '4px', padding: '4px 0', marginTop: '4px',
    });
    menu.className = 'add-comp-menu';

    for (const comp of KNOWN_COMPONENTS) {
      if (world.hasComponent(id, comp)) continue;
      const item = el('div', {
        padding: '3px 8px', cursor: 'pointer',
        fontSize: FONT.size.sm, color: COLORS.text,
      });
      item.textContent = comp.name;
      item.addEventListener('mouseenter', () => { item.style.background = COLORS.accent; item.style.color = COLORS.bgDark; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; item.style.color = COLORS.text; });
      item.addEventListener('click', () => {
        world.addComponent(id, comp);
        menu.remove();
        this._rebuild();
      });
      menu.appendChild(item);
    }

    container.appendChild(menu);
  }

  private _buildObservabilitySection(entityId: number): HTMLElement {
    const world = this._engine.world;
    const section = el('div', {
      marginBottom: '6px',
      borderRadius: '4px',
      background: COLORS.surface,
      overflow: 'hidden',
    });
    const sectionHeader = el('div', {
      padding: '4px 8px',
      background: COLORS.surfaceHover,
      fontWeight: '600',
      color: COLORS.accentDim,
      fontSize: FONT.size.sm,
    });
    sectionHeader.textContent = 'Observability';
    section.appendChild(sectionHeader);

    const body = el('div', { padding: '6px 8px' });
    const rows: Array<[string, string]> = [];

    if (world.hasComponent(entityId, LocalTransform)) {
      const px = world.getField(entityId, LocalTransform, 'px');
      const py = world.getField(entityId, LocalTransform, 'py');
      const pz = world.getField(entityId, LocalTransform, 'pz');
      const sx = world.getField(entityId, LocalTransform, 'scaleX');
      const sy = world.getField(entityId, LocalTransform, 'scaleY');
      const sz = world.getField(entityId, LocalTransform, 'scaleZ');
      rows.push(['position', `${formatValue(px)}, ${formatValue(py)}, ${formatValue(pz)}`]);
      rows.push(['scale', `${formatValue(sx)}, ${formatValue(sy)}, ${formatValue(sz)}`]);
      const eye = this._engine.cameraEye;
      rows.push(['eyeDist', formatValue(Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz))]);
    }

    if (world.hasComponent(entityId, MeshRef)) {
      const meshHandle = world.getField(entityId, MeshRef, 'handle');
      rows.push(['mesh', `#${meshHandle}`]);
      const mesh = this._engine.meshes.get(meshHandle);
      if (mesh) {
        rows.push(['tris', String(Math.round(mesh.indexCount / 3))]);
        rows.push([
          'bounds',
          `${formatValue(mesh.boundsMin[0])}, ${formatValue(mesh.boundsMin[1])}, ${formatValue(mesh.boundsMin[2])} -> ` +
          `${formatValue(mesh.boundsMax[0])}, ${formatValue(mesh.boundsMax[1])}, ${formatValue(mesh.boundsMax[2])}`,
        ]);
      }
    }

    if (world.hasComponent(entityId, MaterialRef)) {
      rows.push(['material', `#${world.getField(entityId, MaterialRef, 'handle')}`]);
    }
    if (world.hasComponent(entityId, Visible)) {
      rows.push(['visible', 'yes']);
    }

    for (const [labelText, valueText] of rows) {
      const row = el('div', {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '1px 0',
      });
      const label = el('span', { color: COLORS.textDim, fontSize: FONT.size.xs, minWidth: '70px' });
      label.textContent = labelText;
      const value = el('span', {
        color: COLORS.textMuted,
        fontSize: FONT.size.xs,
        fontFamily: FONT.mono,
        textAlign: 'right',
        whiteSpace: 'pre-wrap',
      });
      value.textContent = valueText;
      row.appendChild(label);
      row.appendChild(value);
      body.appendChild(row);
    }

    section.appendChild(body);
    return section;
  }

  destroy(): void {
    this.root.remove();
  }
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

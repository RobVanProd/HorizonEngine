import type { Engine } from '@engine/core';
import { LocalTransform, MeshRef, MaterialRef, Visible, WorldMatrix } from '@engine/ecs';
import {
  mat4Perspective, mat4LookAt, mat4Multiply, mat4Translation,
} from '@engine/renderer-webgpu';
import { EditorCamera, type ViewPreset } from './editor-camera.js';
import { GridRenderer } from './grid-renderer.js';
import { GizmoRenderer, type GizmoAxis, type GizmoMode } from '../gizmos/gizmo-renderer.js';
import { PickPass } from '../picking/pick-pass.js';
import { Selection } from '../picking/selection.js';
import { COLORS, FONT, el } from '../ui/theme.js';

export interface ViewportOptions {
  engine: Engine;
  container: HTMLElement;
  selection: Selection;
}

export interface ViewportHudState {
  fps?: number;
  selectedLabel?: string;
  selectedTransform?: string;
  entities?: number;
  backend?: string;
  renderMode?: string;
  warnings?: string;
}

interface TransformDragState {
  entityId: number;
  mode: GizmoMode;
  axis: GizmoAxis;
  startX: number;
  startY: number;
  startPx: number;
  startPy: number;
  startPz: number;
  startRotY: number;
  startScaleX: number;
  startScaleY: number;
  startScaleZ: number;
  moved: boolean;
}

export class Viewport {
  readonly camera: EditorCamera;
  readonly selection: Selection;
  readonly gridRenderer: GridRenderer;
  readonly gizmoRenderer: GizmoRenderer;
  readonly pickPass: PickPass;

  private _engine: Engine;
  private _container: HTMLElement;
  private _overlay: HTMLDivElement;
  private _topLeft: HTMLDivElement;
  private _topRight: HTMLDivElement;
  private _bottomLeft: HTMLDivElement;
  private _bottomRight: HTMLDivElement;
  private _viewLabel: HTMLButtonElement;
  private _hudState: ViewportHudState = {};
  private _gizmoMode: GizmoMode = 'translate';
  private _showGizmo = true;
  private _showGrid = true;
  private _dragState: TransformDragState | null = null;
  private _suppressClickPick = false;
  private _onViewportMouseDown = (e: MouseEvent) => this._onMouseDown(e);
  private _onViewportMouseMove = (e: MouseEvent) => this._onMouseMove(e);
  private _onViewportMouseUp = () => this._onMouseUp();

  constructor(opts: ViewportOptions) {
    this._engine = opts.engine;
    this._container = opts.container;
    this.selection = opts.selection;
    this.camera = new EditorCamera();

    const device = opts.engine.pbrRenderer.device;
    const format = opts.engine.gpu.format;

    this.gridRenderer = new GridRenderer(device, format);
    this.gizmoRenderer = new GizmoRenderer(device, format);
    this.pickPass = new PickPass(device);

    // Overlay for viewport info
    this._overlay = el('div', {
      position: 'absolute', inset: '0',
      pointerEvents: 'none', zIndex: '10',
    });
    this._container.style.position = 'relative';
    this._container.style.outline = '1px solid rgba(124,140,255,0.22)';
    this._container.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.02), inset 0 10px 40px rgba(0,0,0,0.12)';
    this._container.appendChild(this._overlay);

    this._topLeft = this._corner('top', 'left');
    this._topRight = this._corner('top', 'right');
    this._bottomLeft = this._corner('bottom', 'left');
    this._bottomRight = this._corner('bottom', 'right');
    this._overlay.appendChild(this._topLeft);
    this._overlay.appendChild(this._topRight);
    this._overlay.appendChild(this._bottomLeft);
    this._overlay.appendChild(this._bottomRight);

    this._viewLabel = document.createElement('button');
    this._viewLabel.className = 'he-chip';
    Object.assign(this._viewLabel.style, {
      pointerEvents: 'auto',
      cursor: 'pointer',
      borderRadius: '999px',
      padding: '4px 10px',
      lineHeight: '1',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    });
    this._viewLabel.textContent = 'Perspective';
    this._topLeft.appendChild(this._viewLabel);

    // View presets dropdown
    const presets: ViewPreset[] = ['perspective', 'top', 'front', 'right'];
    this._viewLabel.addEventListener('click', () => {
      const idx = presets.indexOf(this._viewLabel.textContent!.toLowerCase() as ViewPreset);
      const next = presets[(idx + 1) % presets.length]!;
      this.camera.setPreset(next);
      this._viewLabel.textContent = next.charAt(0).toUpperCase() + next.slice(1);
      this._renderHud();
    });

    this._topLeft.appendChild(this._chip('Lit'));
    this._topLeft.appendChild(this._chip('WebGPU'));

    // Attach camera to the viewport's canvas container
    this.camera.attach(this._container);

    // Click to pick
    this._container.addEventListener('click', async (e) => {
      if (this._suppressClickPick) {
        this._suppressClickPick = false;
        return;
      }
      if (e.altKey || e.button !== 0) return;
      const rect = this._container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      await this._doPick(x, y, e.ctrlKey || e.metaKey);
    });
    this._container.addEventListener('mousedown', this._onViewportMouseDown);
    window.addEventListener('mousemove', this._onViewportMouseMove);
    window.addEventListener('mouseup', this._onViewportMouseUp);

    this.selection.onChange(() => this._renderHud());
    this._renderHud();
  }

  get gizmoMode(): GizmoMode { return this._gizmoMode; }
  set gizmoMode(m: GizmoMode) { this._gizmoMode = m; this._renderHud(); }

  get showGizmo(): boolean { return this._showGizmo; }
  set showGizmo(v: boolean) { this._showGizmo = v; this._renderHud(); }

  get showGrid(): boolean { return this._showGrid; }
  set showGrid(v: boolean) { this._showGrid = v; this._renderHud(); }

  syncHud(state: ViewportHudState): void {
    this._hudState = { ...this._hudState, ...state };
    this._renderHud();
  }

  /**
   * Called each frame from the editor render loop.
   * Renders grid and gizmos into the current render pass.
   */
  renderOverlays(pass: GPURenderPassEncoder): void {
    const canvas = this._engine.canvas.element;
    const aspect = canvas.width / canvas.height;
    const vp = this.camera.getViewProjection(aspect);
    const eye = this.camera.getEye();

    if (this._showGrid) {
      this.gridRenderer.render(pass, vp, eye);
    }

    // Render gizmo for selected entity
    const selectedId = this.selection.first;
    if (this._showGizmo && selectedId !== null) {
      const world = this._engine.world;
      if (world.has(selectedId) && world.hasComponent(selectedId, LocalTransform)) {
        const px = world.getField(selectedId, LocalTransform, 'px');
        const py = world.getField(selectedId, LocalTransform, 'py');
        const pz = world.getField(selectedId, LocalTransform, 'pz');
        const center: [number, number, number] = [px, py, pz];

        const distToCamera = Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz);
        const gizmoScale = distToCamera * 0.15;

        this.gizmoRenderer.begin();
        switch (this._gizmoMode) {
          case 'translate': this.gizmoRenderer.drawTranslate(center, gizmoScale); break;
          case 'rotate': this.gizmoRenderer.drawRotate(center, gizmoScale); break;
          case 'scale': this.gizmoRenderer.drawScale(center, gizmoScale); break;
        }
        this.gizmoRenderer.flush(pass, vp);
      }
    }
  }

  updateCamera(dt: number): void {
    this.camera.updateFly(dt);
    const canvas = this._engine.canvas.element;
    const aspect = canvas.width / canvas.height;
    const vp = this.camera.getViewProjection(aspect);
    const eye = this.camera.getEye();
    this._engine.setCamera(vp, eye);
  }

  private _onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || e.altKey || !this._showGizmo) return;
    const selectedId = this.selection.first;
    if (selectedId === null) return;
    const world = this._engine.world;
    if (!world.has(selectedId) || !world.hasComponent(selectedId, LocalTransform)) return;

    const rect = this._container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const axis = this._pickGizmoAxis(selectedId, x, y);
    const projected = this._projectEntity(selectedId);
    const centerHit = this._gizmoMode !== 'rotate' && projected
      ? Math.hypot(projected.x - x, projected.y - y) <= 56
      : false;
    if (!axis && !centerHit) return;

    this._dragState = {
      entityId: selectedId,
      mode: this._gizmoMode,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      startPx: world.getField(selectedId, LocalTransform, 'px'),
      startPy: world.getField(selectedId, LocalTransform, 'py'),
      startPz: world.getField(selectedId, LocalTransform, 'pz'),
      startRotY: world.getField(selectedId, LocalTransform, 'rotY'),
      startScaleX: world.getField(selectedId, LocalTransform, 'scaleX'),
      startScaleY: world.getField(selectedId, LocalTransform, 'scaleY'),
      startScaleZ: world.getField(selectedId, LocalTransform, 'scaleZ'),
      moved: false,
    };
    e.preventDefault();
  }

  private _onMouseMove(e: MouseEvent): void {
    const rect = this._container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!this._dragState) {
      const selectedId = this.selection.first;
      this.gizmoRenderer.hoveredAxis = selectedId !== null && this._showGizmo
        ? this._pickGizmoAxis(selectedId, x, y)
        : null;
      return;
    }

    if (!this._dragState) return;
    const dx = e.clientX - this._dragState.startX;
    const dy = e.clientY - this._dragState.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      this._dragState.moved = true;
    }

    const world = this._engine.world;
    const id = this._dragState.entityId;
    if (!world.has(id) || !world.hasComponent(id, LocalTransform)) {
      this._dragState = null;
      return;
    }

    switch (this._dragState.mode) {
      case 'translate':
        this._applyTranslateDrag(id, dx, dy);
        break;
      case 'rotate':
        world.setField(id, LocalTransform, 'rotY', this._dragState.startRotY + dx * 0.01);
        break;
      case 'scale':
        this._applyScaleDrag(id, dx, dy);
        break;
    }
    e.preventDefault();
  }

  private _onMouseUp(): void {
    if (!this._dragState) return;
    this._suppressClickPick = this._dragState.moved;
    this.gizmoRenderer.hoveredAxis = null;
    this._dragState = null;
  }

  private async _doPick(x: number, y: number, additive: boolean): Promise<void> {
    // Simplified picking: use entity positions projected to screen space
    const canvas = this._engine.canvas.element;
    const aspect = canvas.width / canvas.height;
    const vp = this.camera.getViewProjection(aspect);
    const world = this._engine.world;
    const q = world.query(Visible, LocalTransform);

    let bestDist = 40; // pixels threshold
    let bestId = -1;

    q.each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      const pxCol = arch.getColumn(LocalTransform, 'px') as Float32Array;
      const pyCol = arch.getColumn(LocalTransform, 'py') as Float32Array;
      const pzCol = arch.getColumn(LocalTransform, 'pz') as Float32Array;

      for (let i = 0; i < count; i++) {
        const wx = pxCol[i]!, wy = pyCol[i]!, wz = pzCol[i]!;
        // Project to screen
        const cx = vp[0]! * wx + vp[4]! * wy + vp[8]!  * wz + vp[12]!;
        const cy = vp[1]! * wx + vp[5]! * wy + vp[9]!  * wz + vp[13]!;
        const cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;

        if (cw <= 0) continue;
        const ndcX = cx / cw;
        const ndcY = cy / cw;
        const sx = (ndcX * 0.5 + 0.5) * canvas.clientWidth;
        const sy = (-ndcY * 0.5 + 0.5) * canvas.clientHeight;

        const dist = Math.hypot(sx - x, sy - y);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = ids[i]!;
        }
      }
    });

    if (bestId >= 0) {
      this.selection.select(bestId, additive);
    } else if (!additive) {
      this.selection.clear();
    }
  }

  destroy(): void {
    this.camera.detach();
    this._container.removeEventListener('mousedown', this._onViewportMouseDown);
    this.gridRenderer.destroy();
    this.gizmoRenderer.destroy();
    this.pickPass.destroy();
    window.removeEventListener('mousemove', this._onViewportMouseMove);
    window.removeEventListener('mouseup', this._onViewportMouseUp);
    this._overlay.remove();
  }

  private _projectEntity(entityId: number): { x: number; y: number } | null {
    const world = this._engine.world;
    if (!world.has(entityId) || !world.hasComponent(entityId, LocalTransform)) return null;

    const wx = world.getField(entityId, LocalTransform, 'px');
    const wy = world.getField(entityId, LocalTransform, 'py');
    const wz = world.getField(entityId, LocalTransform, 'pz');
    return this._projectWorldPoint(wx, wy, wz);
  }

  private _projectWorldPoint(wx: number, wy: number, wz: number): { x: number; y: number } | null {
    const canvas = this._engine.canvas.element;
    const aspect = canvas.width / canvas.height;
    const vp = this.camera.getViewProjection(aspect);
    const cx = vp[0]! * wx + vp[4]! * wy + vp[8]! * wz + vp[12]!;
    const cy = vp[1]! * wx + vp[5]! * wy + vp[9]! * wz + vp[13]!;
    const cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;
    if (cw <= 0) return null;

    return {
      x: (cx / cw * 0.5 + 0.5) * canvas.clientWidth,
      y: (-cy / cw * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  private _pickGizmoAxis(entityId: number, x: number, y: number): GizmoAxis {
    const world = this._engine.world;
    if (!world.has(entityId) || !world.hasComponent(entityId, LocalTransform)) return null;

    const px = world.getField(entityId, LocalTransform, 'px');
    const py = world.getField(entityId, LocalTransform, 'py');
    const pz = world.getField(entityId, LocalTransform, 'pz');
    const eye = this.camera.getEye();
    const distToCamera = Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz);
    const gizmoScale = distToCamera * 0.15;
    const center = this._projectWorldPoint(px, py, pz);
    if (!center) return null;

    if (this._gizmoMode === 'rotate') {
      return this._pickRotateAxis(px, py, pz, gizmoScale, x, y);
    }

    const handles: Array<{ axis: Exclude<GizmoAxis, 'xy' | 'xz' | 'yz' | null>; end: [number, number, number] }> = [
      { axis: 'x', end: [px + gizmoScale, py, pz] },
      { axis: 'y', end: [px, py + gizmoScale, pz] },
      { axis: 'z', end: [px, py, pz + gizmoScale] },
    ];

    let bestAxis: GizmoAxis = null;
    let bestDistance = 18;
    for (const handle of handles) {
      const end = this._projectWorldPoint(handle.end[0], handle.end[1], handle.end[2]);
      if (!end) continue;
      const distance = this._pointToSegmentDistance(x, y, center.x, center.y, end.x, end.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAxis = handle.axis;
      }
    }
    return bestAxis;
  }

  private _pickRotateAxis(px: number, py: number, pz: number, scale: number, x: number, y: number): GizmoAxis {
    const segments = 48;
    let bestDistance = 14;
    let bestAxis: GizmoAxis = null;
    let previous = this._projectWorldPoint(px + scale, py, pz);
    if (!previous) return null;

    for (let i = 1; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const current = this._projectWorldPoint(
        px + Math.cos(t) * scale,
        py,
        pz + Math.sin(t) * scale,
      );
      if (!previous || !current) {
        previous = current;
        continue;
      }
      const distance = this._pointToSegmentDistance(x, y, previous.x, previous.y, current.x, current.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAxis = 'y';
      }
      previous = current;
    }

    return bestAxis;
  }

  private _pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    return Math.hypot(px - qx, py - qy);
  }

  private _applyTranslateDrag(entityId: number, dx: number, dy: number): void {
    if (!this._dragState) return;
    const world = this._engine.world;
    if (this._dragState.axis === 'x' || this._dragState.axis === 'y' || this._dragState.axis === 'z') {
      const origin = this._projectWorldPoint(this._dragState.startPx, this._dragState.startPy, this._dragState.startPz);
      if (!origin) return;
      const axisEnd = this._projectWorldPoint(
        this._dragState.startPx + (this._dragState.axis === 'x' ? 1 : 0),
        this._dragState.startPy + (this._dragState.axis === 'y' ? 1 : 0),
        this._dragState.startPz + (this._dragState.axis === 'z' ? 1 : 0),
      );
      if (!axisEnd) return;
      const axisScreenX = axisEnd.x - origin.x;
      const axisScreenY = axisEnd.y - origin.y;
      const axisScreenLength = Math.hypot(axisScreenX, axisScreenY);
      if (axisScreenLength < 1e-4) return;
      const distancePx = (dx * axisScreenX + dy * axisScreenY) / axisScreenLength;
      const worldUnits = distancePx / axisScreenLength;
      world.setField(entityId, LocalTransform, 'px', this._dragState.startPx + (this._dragState.axis === 'x' ? worldUnits : 0));
      world.setField(entityId, LocalTransform, 'py', this._dragState.startPy + (this._dragState.axis === 'y' ? worldUnits : 0));
      world.setField(entityId, LocalTransform, 'pz', this._dragState.startPz + (this._dragState.axis === 'z' ? worldUnits : 0));
      return;
    }

    const height = Math.max(1, this._container.clientHeight);
    const fovRad = this.camera.fov * Math.PI / 180;
    const worldPerPixel = (2 * Math.tan(fovRad * 0.5) * this.camera.distance) / height;
    const right = this.camera.getRightVector();
    const up = this.camera.getUpVector();
    const moveX = dx * worldPerPixel;
    const moveY = -dy * worldPerPixel;

    world.setField(entityId, LocalTransform, 'px', this._dragState.startPx + right[0] * moveX + up[0] * moveY);
    world.setField(entityId, LocalTransform, 'py', this._dragState.startPy + right[1] * moveX + up[1] * moveY);
    world.setField(entityId, LocalTransform, 'pz', this._dragState.startPz + right[2] * moveX + up[2] * moveY);
  }

  private _applyScaleDrag(entityId: number, dx: number, dy: number): void {
    if (!this._dragState) return;
    const world = this._engine.world;
    const factor = Math.max(0.1, Math.exp((dx - dy) * 0.01));
    if (this._dragState.axis === 'x') {
      world.setField(entityId, LocalTransform, 'scaleX', this._dragState.startScaleX * factor);
      return;
    }
    if (this._dragState.axis === 'y') {
      world.setField(entityId, LocalTransform, 'scaleY', this._dragState.startScaleY * factor);
      return;
    }
    if (this._dragState.axis === 'z') {
      world.setField(entityId, LocalTransform, 'scaleZ', this._dragState.startScaleZ * factor);
      return;
    }
    world.setField(entityId, LocalTransform, 'scaleX', this._dragState.startScaleX * factor);
    world.setField(entityId, LocalTransform, 'scaleY', this._dragState.startScaleY * factor);
    world.setField(entityId, LocalTransform, 'scaleZ', this._dragState.startScaleZ * factor);
  }

  private _corner(vertical: 'top' | 'bottom', horizontal: 'left' | 'right'): HTMLDivElement {
    return el('div', {
      position: 'absolute',
      [vertical]: '8px',
      [horizontal]: '8px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      maxWidth: '42%',
      justifyContent: horizontal === 'right' ? 'flex-end' : 'flex-start',
      alignItems: 'center',
    } as Partial<CSSStyleDeclaration>);
  }

  private _chip(text: string, accent = false): HTMLDivElement {
    const chip = el('div');
    chip.className = 'he-chip';
    if (accent) {
      chip.style.borderColor = 'rgba(99,212,255,0.28)';
      chip.style.color = COLORS.text;
    }
    chip.textContent = text;
    return chip;
  }

  private _renderHud(): void {
    this._topRight.innerHTML = '';
    this._bottomLeft.innerHTML = '';
    this._bottomRight.innerHTML = '';

    const fps = this._hudState.fps ?? 0;
    const fpsChip = this._chip(`${Math.round(fps)} FPS`, true);
    fpsChip.style.color = fps >= 55 ? COLORS.success : fps >= 30 ? COLORS.warning : COLORS.error;
    this._topRight.appendChild(fpsChip);
    this._topRight.appendChild(this._chip(this._hudState.renderMode ?? 'Lit'));
    this._topRight.appendChild(this._chip(this._hudState.backend ?? 'WebGPU'));
    if (this._hudState.entities !== undefined) {
      this._topRight.appendChild(this._chip(`${this._hudState.entities} entities`));
    }

    this._bottomLeft.appendChild(this._chip(this._hudState.selectedLabel ?? 'No selection'));
    if (this._hudState.selectedTransform) {
      const mono = this._chip(this._hudState.selectedTransform);
      mono.style.fontFamily = FONT.mono;
      this._bottomLeft.appendChild(mono);
    }

    this._bottomRight.appendChild(this._chip(this._showGrid ? 'Grid On' : 'Grid Off'));
    this._bottomRight.appendChild(this._chip(`Tool ${this._showGizmo ? this._gizmoMode : 'select'}`));
    if (this._hudState.warnings) {
      const warn = this._chip(this._hudState.warnings);
      warn.style.color = COLORS.warning;
      this._bottomRight.appendChild(warn);
    }
  }
}

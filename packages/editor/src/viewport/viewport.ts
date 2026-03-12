import type { Engine } from '@engine/core';
import { AudioSource, LocalTransform, MeshRef, Visible, WorldMatrix } from '@engine/ecs';
import { DebugDraw } from '@engine/devtools';
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
  startRotX: number;
  startRotY: number;
  startRotZ: number;
  startScaleX: number;
  startScaleY: number;
  startScaleZ: number;
  moved: boolean;
}

export type ViewportOverlayId = 'bounds' | 'audio';

const WM_FIELDS = [
  'm0', 'm1', 'm2', 'm3',
  'm4', 'm5', 'm6', 'm7',
  'm8', 'm9', 'm10', 'm11',
  'm12', 'm13', 'm14', 'm15',
] as const;

export class Viewport {
  readonly camera: EditorCamera;
  readonly selection: Selection;
  readonly gridRenderer: GridRenderer;
  readonly gizmoRenderer: GizmoRenderer;
  readonly pickPass: PickPass;
  readonly debugDraw: DebugDraw;

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
  private _overlays: Record<ViewportOverlayId, boolean> = {
    bounds: false,
    audio: false,
  };
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
    this.debugDraw = new DebugDraw(device, format);

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

  getOverlay(name: ViewportOverlayId): boolean {
    return this._overlays[name];
  }

  setOverlay(name: ViewportOverlayId, enabled: boolean): void {
    this._overlays[name] = enabled;
    this._renderHud();
  }

  toggleOverlay(name: ViewportOverlayId): boolean {
    this._overlays[name] = !this._overlays[name];
    this._renderHud();
    return this._overlays[name];
  }

  inspectState(): {
    selection: number[];
    gizmoMode: GizmoMode;
    showGrid: boolean;
    showGizmo: boolean;
    overlays: Record<ViewportOverlayId, boolean>;
    camera: {
      target: [number, number, number];
      eye: [number, number, number];
      distance: number;
      yaw: number;
      pitch: number;
      ortho: boolean;
      orthoSize: number;
    };
  } {
    return {
      selection: [...this.selection.ids],
      gizmoMode: this._gizmoMode,
      showGrid: this._showGrid,
      showGizmo: this._showGizmo,
      overlays: { ...this._overlays },
      camera: {
        target: [...this.camera.target] as [number, number, number],
        eye: this.camera.getEye(),
        distance: this.camera.distance,
        yaw: this.camera.yaw,
        pitch: this.camera.pitch,
        ortho: this.camera.ortho,
        orthoSize: this.camera.orthoSize,
      },
    };
  }

  captureSnapshot(): {
    width: number;
    height: number;
    dataUrl: string;
    state: ReturnType<Viewport['inspectState']>;
  } {
    const canvas = this._engine.canvas.element;
    return {
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvas.toDataURL('image/png'),
      state: this.inspectState(),
    };
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
        const sx = world.getField(selectedId, LocalTransform, 'scaleX');
        const sy = world.getField(selectedId, LocalTransform, 'scaleY');
        const sz = world.getField(selectedId, LocalTransform, 'scaleZ');
        const center: [number, number, number] = [px, py, pz];

        const distToCamera = Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz);
        const gizmoScale = distToCamera * 0.15;
        const selectionScale = Math.max(Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz)) * 1.2, distToCamera * 0.04);

        this.gizmoRenderer.begin();
        this.gizmoRenderer.drawSelectionBounds(center, selectionScale);
        switch (this._gizmoMode) {
          case 'translate': this.gizmoRenderer.drawTranslate(center, gizmoScale); break;
          case 'rotate': this.gizmoRenderer.drawRotate(center, gizmoScale); break;
          case 'scale': this.gizmoRenderer.drawScale(center, gizmoScale); break;
        }
        this.gizmoRenderer.flush(pass, vp);
      }
    }

    this.debugDraw.begin();
    if (this._overlays.bounds) {
      this._appendBoundsOverlays();
    }
    if (this._overlays.audio) {
      this._appendAudioOverlays();
    }
    this.debugDraw.flush(pass, vp);
  }

  updateCamera(dt: number): void {
    this.camera.updateFly(dt);
    const canvas = this._engine.canvas.element;
    const aspect = canvas.width / canvas.height;
    const vp = this.camera.getViewProjection(aspect);
    const eye = this.camera.getEye();
    this._engine.setCamera(vp, eye);
  }

  async pickScreenPoint(x: number, y: number, additive = false): Promise<void> {
    await this._doPick(x, y, additive);
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
      startRotX: world.getField(selectedId, LocalTransform, 'rotX'),
      startRotY: world.getField(selectedId, LocalTransform, 'rotY'),
      startRotZ: world.getField(selectedId, LocalTransform, 'rotZ'),
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
        this._applyRotateDrag(id, dx, dy);
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
    const canvas = this._engine.canvas.element;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const aspect = width / height;
    const vp = this.camera.getViewProjection(aspect);
    const world = this._engine.world;
    const query = world.query(WorldMatrix, MeshRef, Visible);
    const createdBuffers: GPUBuffer[] = [];

    this.pickPass.render(width, height, vp, (pass) => {
      query.each((arch, count) => {
        const ids = arch.entities.data as Uint32Array;
        const meshHandles = arch.getColumn(MeshRef, 'handle') as Uint32Array;
        const worldColumns = WM_FIELDS.map((field) => arch.getColumn(WorldMatrix, field)) as Float32Array[];

        for (let i = 0; i < count; i++) {
          const mesh = this._engine.meshes.get(meshHandles[i]!);
          if (!mesh) continue;

          const objectData = new ArrayBuffer(80);
          const modelFloats = new Float32Array(objectData, 0, 16);
          const idView = new Uint32Array(objectData, 64, 4);
          for (let c = 0; c < 16; c++) {
            modelFloats[c] = worldColumns[c]![i]!;
          }
          idView[0] = ids[i]!;

          const objectBuffer = this._engine.gpu.device.createBuffer({
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          createdBuffers.push(objectBuffer);
          this._engine.gpu.device.queue.writeBuffer(objectBuffer, 0, objectData);

          pass.setPipeline(this.pickPass.getPipeline(mesh.skinned));
          pass.setBindGroup(1, this.pickPass.createObjectBindGroup(objectBuffer));
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
          pass.drawIndexed(mesh.indexCount);
        }
      });
    });

    const pickedId = await this.pickPass.readPixel(
      x * (width / Math.max(1, canvas.clientWidth)),
      y * (height / Math.max(1, canvas.clientHeight)),
    );
    for (const buffer of createdBuffers) {
      buffer.destroy();
    }

    if (pickedId > 0) {
      const bestId = Number(pickedId);
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
    this.debugDraw.destroy();
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
    const rings: Array<{ axis: Exclude<GizmoAxis, 'xy' | 'xz' | 'yz' | null>; pointAt: (t: number) => [number, number, number] }> = [
      { axis: 'x', pointAt: (t) => [px, py + Math.cos(t) * scale, pz + Math.sin(t) * scale] },
      { axis: 'y', pointAt: (t) => [px + Math.cos(t) * scale, py, pz + Math.sin(t) * scale] },
      { axis: 'z', pointAt: (t) => [px + Math.cos(t) * scale, py + Math.sin(t) * scale, pz] },
    ];

    for (const ring of rings) {
      let previous = this._projectWorldPoint(...ring.pointAt(0));
      if (!previous) continue;

      for (let i = 1; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const current = this._projectWorldPoint(...ring.pointAt(t));
        if (!previous || !current) {
          previous = current;
          continue;
        }
        const distance = this._pointToSegmentDistance(x, y, previous.x, previous.y, current.x, current.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestAxis = ring.axis;
        }
        previous = current;
      }
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
    const worldPerPixel = this.camera.ortho
      ? (2 * this.camera.orthoSize) / height
      : (2 * Math.tan(fovRad * 0.5) * this.camera.distance) / height;
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

  private _applyRotateDrag(entityId: number, dx: number, dy: number): void {
    if (!this._dragState) return;
    const world = this._engine.world;
    switch (this._dragState.axis) {
      case 'x':
        world.setField(entityId, LocalTransform, 'rotX', this._dragState.startRotX - dy * 0.01);
        break;
      case 'z':
        world.setField(entityId, LocalTransform, 'rotZ', this._dragState.startRotZ + dx * 0.01);
        break;
      case 'y':
      default:
        world.setField(entityId, LocalTransform, 'rotY', this._dragState.startRotY + dx * 0.01);
        break;
    }
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
    if (this._overlays.bounds) this._bottomRight.appendChild(this._chip('Bounds'));
    if (this._overlays.audio) this._bottomRight.appendChild(this._chip('Audio'));
    if (this.camera.ortho) this._bottomRight.appendChild(this._chip(`Ortho ${this.camera.orthoSize.toFixed(1)}`));
    if (this._hudState.warnings) {
      const warn = this._chip(this._hudState.warnings);
      warn.style.color = COLORS.warning;
      this._bottomRight.appendChild(warn);
    }
  }

  private _appendBoundsOverlays(): void {
    const world = this._engine.world;
    const query = world.query(WorldMatrix, MeshRef, Visible);
    query.each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      const meshHandles = arch.getColumn(MeshRef, 'handle') as Uint32Array;
      const worldColumns = WM_FIELDS.map((field) => arch.getColumn(WorldMatrix, field)) as Float32Array[];
      for (let i = 0; i < count; i++) {
        const mesh = this._engine.meshes.get(meshHandles[i]!);
        if (!mesh) continue;
        const matrix = new Float32Array(16);
        for (let c = 0; c < 16; c++) matrix[c] = worldColumns[c]![i]!;
        const bounds = transformBounds(mesh.boundsMin, mesh.boundsMax, matrix);
        this.debugDraw.aabb(
          bounds.min,
          bounds.max,
          this.selection.has(ids[i]!) ? [0.55, 0.84, 1, 0.88] : [0.45, 1, 0.55, 0.35],
        );
      }
    });
  }

  private _appendAudioOverlays(): void {
    const world = this._engine.world;
    const query = world.query(LocalTransform, AudioSource);
    query.each((arch, count) => {
      const px = arch.getColumn(LocalTransform, 'px') as Float32Array;
      const py = arch.getColumn(LocalTransform, 'py') as Float32Array;
      const pz = arch.getColumn(LocalTransform, 'pz') as Float32Array;
      const minDistance = arch.getColumn(AudioSource, 'refDistance') as Float32Array;
      const maxDistance = arch.getColumn(AudioSource, 'maxDistance') as Float32Array;
      for (let i = 0; i < count; i++) {
        const center: [number, number, number] = [px[i]!, py[i]!, pz[i]!];
        const inner = Math.max(0.1, minDistance[i]!);
        const outer = Math.max(inner, maxDistance[i]!);
        this.debugDraw.aabb(
          [center[0] - inner, center[1] - inner, center[2] - inner],
          [center[0] + inner, center[1] + inner, center[2] + inner],
          [1, 0.82, 0.28, 0.78],
        );
        this.debugDraw.aabb(
          [center[0] - outer, center[1] - outer, center[2] - outer],
          [center[0] + outer, center[1] + outer, center[2] + outer],
          [1, 0.55, 0.18, 0.28],
        );
      }
    });
  }
}

function transformBounds(
  min: [number, number, number],
  max: [number, number, number],
  matrix: Float32Array,
): { min: [number, number, number]; max: [number, number, number] } {
  const corners: Array<[number, number, number]> = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const corner of corners) {
    const x = corner[0];
    const y = corner[1];
    const z = corner[2];
    const wx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
    const wy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
    const wz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    minZ = Math.min(minZ, wz);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
    maxZ = Math.max(maxZ, wz);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

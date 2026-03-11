import type { Engine } from '@engine/core';
import { LocalTransform, MeshRef, MaterialRef, Visible, WorldMatrix } from '@engine/ecs';
import {
  mat4Perspective, mat4LookAt, mat4Multiply, mat4Translation,
} from '@engine/renderer-webgpu';
import { EditorCamera, type ViewPreset } from './editor-camera.js';
import { GridRenderer } from './grid-renderer.js';
import { GizmoRenderer, type GizmoMode } from '../gizmos/gizmo-renderer.js';
import { PickPass } from '../picking/pick-pass.js';
import { Selection } from '../picking/selection.js';
import { COLORS, el } from '../ui/theme.js';

export interface ViewportOptions {
  engine: Engine;
  container: HTMLElement;
  selection: Selection;
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
  private _viewLabel: HTMLDivElement;
  private _gizmoMode: GizmoMode = 'translate';
  private _showGrid = true;

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
      position: 'absolute', top: '4px', left: '4px', right: '4px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      pointerEvents: 'none', zIndex: '10',
    });
    this._container.style.position = 'relative';
    this._container.appendChild(this._overlay);

    this._viewLabel = el('div', {
      background: 'rgba(0,0,0,0.5)', color: COLORS.textDim,
      padding: '2px 8px', borderRadius: '3px', fontSize: '10px',
      pointerEvents: 'auto', cursor: 'pointer',
    });
    this._viewLabel.textContent = 'Perspective';
    this._overlay.appendChild(this._viewLabel);

    // View presets dropdown
    const presets: ViewPreset[] = ['perspective', 'top', 'front', 'right'];
    this._viewLabel.addEventListener('click', () => {
      const idx = presets.indexOf(this._viewLabel.textContent!.toLowerCase() as ViewPreset);
      const next = presets[(idx + 1) % presets.length]!;
      this.camera.setPreset(next);
      this._viewLabel.textContent = next.charAt(0).toUpperCase() + next.slice(1);
    });

    // Attach camera to the viewport's canvas container
    this.camera.attach(this._container);

    // Click to pick
    this._container.addEventListener('click', async (e) => {
      if (e.altKey || e.button !== 0) return;
      const rect = this._container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      await this._doPick(x, y, e.ctrlKey || e.metaKey);
    });
  }

  get gizmoMode(): GizmoMode { return this._gizmoMode; }
  set gizmoMode(m: GizmoMode) { this._gizmoMode = m; }

  get showGrid(): boolean { return this._showGrid; }
  set showGrid(v: boolean) { this._showGrid = v; }

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
    if (selectedId !== null) {
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
    this.gridRenderer.destroy();
    this.gizmoRenderer.destroy();
    this.pickPass.destroy();
    this._overlay.remove();
  }
}

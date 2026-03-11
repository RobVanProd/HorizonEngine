import {
  mat4Perspective, mat4LookAt, mat4Multiply, mat4Identity,
} from '@engine/renderer-webgpu';

export type CameraMode = 'orbit' | 'pan' | 'fly';
export type ViewPreset = 'perspective' | 'top' | 'front' | 'right';

export class EditorCamera {
  target: [number, number, number] = [0, 0, 0];
  distance = 10;
  yaw = Math.PI * 0.25;
  pitch = -Math.PI * 0.2;
  fov = 60;
  near = 0.1;
  far = 500;
  ortho = false;

  private _mode: CameraMode = 'orbit';
  private _canvas: HTMLElement | null = null;
  private _dragging = false;
  private _lastX = 0;
  private _lastY = 0;
  private _button = -1;
  private _flySpeed = 8;
  private _keys = new Set<string>();

  private _onMouseDown = (e: MouseEvent) => this._handleMouseDown(e);
  private _onMouseMove = (e: MouseEvent) => this._handleMouseMove(e);
  private _onMouseUp = () => this._handleMouseUp();
  private _onWheel = (e: WheelEvent) => this._handleWheel(e);
  private _onKeyDown = (e: KeyboardEvent) => this._keys.add(e.key.toLowerCase());
  private _onKeyUp = (e: KeyboardEvent) => this._keys.delete(e.key.toLowerCase());
  private _onCtx = (e: Event) => e.preventDefault();

  attach(canvas: HTMLElement): void {
    this._canvas = canvas;
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onCtx);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  detach(): void {
    if (!this._canvas) return;
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('mousemove', this._onMouseMove);
    this._canvas.removeEventListener('mouseup', this._onMouseUp);
    this._canvas.removeEventListener('wheel', this._onWheel);
    this._canvas.removeEventListener('contextmenu', this._onCtx);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._canvas = null;
  }

  setPreset(preset: ViewPreset): void {
    switch (preset) {
      case 'perspective':
        this.ortho = false;
        this.yaw = Math.PI * 0.25;
        this.pitch = -Math.PI * 0.2;
        this.distance = 10;
        break;
      case 'top':
        this.ortho = true;
        this.yaw = 0;
        this.pitch = -Math.PI / 2 + 0.001;
        break;
      case 'front':
        this.ortho = true;
        this.yaw = 0;
        this.pitch = 0;
        break;
      case 'right':
        this.ortho = true;
        this.yaw = Math.PI / 2;
        this.pitch = 0;
        break;
    }
  }

  updateFly(dt: number): void {
    if (this._keys.size === 0) return;
    const forward = this._getForward();
    const right = this._getRight();
    const speed = this._flySpeed * dt;

    if (this._keys.has('w')) {
      this.target[0] += forward[0] * speed;
      this.target[1] += forward[1] * speed;
      this.target[2] += forward[2] * speed;
    }
    if (this._keys.has('s')) {
      this.target[0] -= forward[0] * speed;
      this.target[1] -= forward[1] * speed;
      this.target[2] -= forward[2] * speed;
    }
    if (this._keys.has('a')) {
      this.target[0] -= right[0] * speed;
      this.target[2] -= right[2] * speed;
    }
    if (this._keys.has('d')) {
      this.target[0] += right[0] * speed;
      this.target[2] += right[2] * speed;
    }
    if (this._keys.has(' ')) this.target[1] += speed;
    if (this._keys.has('shift')) this.target[1] -= speed;
  }

  getEye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * -Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  getViewProjection(aspect: number): Float32Array {
    const eye = this.getEye();
    const fovRad = this.fov * Math.PI / 180;
    const proj = mat4Perspective(fovRad, aspect, this.near, this.far);
    const view = mat4LookAt(eye, this.target, [0, 1, 0]);
    return mat4Multiply(proj, view);
  }

  private _handleMouseDown(e: MouseEvent): void {
    this._dragging = true;
    this._button = e.button;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    (this._canvas as HTMLElement).style.cursor = e.button === 2 ? 'grab' : 'default';
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this._dragging) return;
    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;

    if (this._button === 0 && !e.altKey) return; // LMB without Alt = selection
    if (this._button === 0 && e.altKey || this._button === 1) {
      // Orbit
      this.yaw += dx * 0.005;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch + dy * 0.005));
    } else if (this._button === 2 || (this._button === 0 && e.shiftKey)) {
      // Pan
      const panSpeed = this.distance * 0.002;
      const right = this._getRight();
      const up: [number, number, number] = [0, 1, 0];
      this.target[0] -= (right[0] * dx + up[0] * -dy) * panSpeed;
      this.target[1] -= (right[1] * dx + up[1] * -dy) * panSpeed;
      this.target[2] -= (right[2] * dx + up[2] * -dy) * panSpeed;
    }
  }

  private _handleMouseUp(): void {
    this._dragging = false;
    this._button = -1;
    if (this._canvas) (this._canvas as HTMLElement).style.cursor = 'default';
  }

  private _handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    this.distance = Math.max(0.5, Math.min(200, this.distance * factor));
  }

  private _getForward(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      -cp * Math.sin(this.yaw),
      Math.sin(this.pitch),
      -cp * Math.cos(this.yaw),
    ];
  }

  private _getRight(): [number, number, number] {
    return [
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw),
    ];
  }
}

import type { CpuTimer, FrameMetrics, TimerSnapshot, GpuProfiler } from '@engine/profiler';

const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 50;
const GRAPH_SAMPLES = 200;

/**
 * In-engine performance dashboard overlay.
 * Shows frame graph, CPU per-system timings, GPU pass timings, and memory stats.
 */
export class PerfPanel {
  private _root: HTMLDivElement;
  private _canvas: HTMLCanvasElement;
  private _ctx2d: CanvasRenderingContext2D;
  private _cpuSection: HTMLDivElement;
  private _gpuSection: HTMLDivElement;
  private _memSection: HTMLDivElement;
  private _frameTimes: number[] = [];
  private _visible = false;

  private _cpuTimer: CpuTimer | null = null;
  private _frameMetrics: FrameMetrics | null = null;
  private _gpuProfiler: GpuProfiler | null = null;
  private _gpuTimings: Map<string, number> = new Map();

  constructor() {
    this._root = document.createElement('div');
    this._root.className = 'engine-perf-panel';
    Object.assign(this._root.style, {
      position: 'fixed', top: '8px', right: '8px', zIndex: '99999',
      background: 'rgba(15,15,20,0.92)', color: '#e0e0e0',
      fontFamily: 'Consolas, "Fira Code", monospace', fontSize: '11px',
      borderRadius: '6px', padding: '8px 10px', minWidth: '220px',
      backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
      display: 'none', userSelect: 'none', lineHeight: '1.5',
    });

    // Frame graph canvas
    this._canvas = document.createElement('canvas');
    this._canvas.width = GRAPH_WIDTH;
    this._canvas.height = GRAPH_HEIGHT;
    Object.assign(this._canvas.style, {
      width: `${GRAPH_WIDTH}px`, height: `${GRAPH_HEIGHT}px`,
      borderRadius: '3px', marginBottom: '6px', display: 'block',
      background: 'rgba(0,0,0,0.3)',
    });
    this._ctx2d = this._canvas.getContext('2d')!;
    this._root.appendChild(this._canvas);

    this._cpuSection = document.createElement('div');
    this._gpuSection = document.createElement('div');
    this._memSection = document.createElement('div');

    this._root.appendChild(this._cpuSection);
    this._root.appendChild(this._gpuSection);
    this._root.appendChild(this._memSection);

    document.body.appendChild(this._root);
  }

  bind(cpuTimer: CpuTimer, frameMetrics: FrameMetrics, gpuProfiler?: GpuProfiler): void {
    this._cpuTimer = cpuTimer;
    this._frameMetrics = frameMetrics;
    this._gpuProfiler = gpuProfiler ?? null;
  }

  setGpuTimings(timings: Map<string, number>): void {
    this._gpuTimings = timings;
  }

  get visible(): boolean { return this._visible; }

  show(): void {
    this._visible = true;
    this._root.style.display = 'block';
  }

  hide(): void {
    this._visible = false;
    this._root.style.display = 'none';
  }

  toggle(): void {
    this._visible ? this.hide() : this.show();
  }

  /** Call once per frame from the diagnostics system. */
  update(): void {
    if (!this._visible) return;

    this._updateGraph();
    this._updateCpuTimings();
    this._updateGpuTimings();
    this._updateMemory();
  }

  destroy(): void {
    this._root.remove();
  }

  private _updateGraph(): void {
    if (!this._frameMetrics) return;

    const snap = this._frameMetrics.frameTimes.snapshot();
    this._frameTimes.push(snap.last);
    if (this._frameTimes.length > GRAPH_SAMPLES) this._frameTimes.shift();

    const ctx = this._ctx2d;
    ctx.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

    // Target line at 16.67ms (60fps)
    const maxMs = 33.33;
    const targetY = GRAPH_HEIGHT * (1 - 16.67 / maxMs);
    ctx.strokeStyle = 'rgba(100,255,100,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(GRAPH_WIDTH, targetY);
    ctx.stroke();

    // Frame time bars
    const barWidth = GRAPH_WIDTH / GRAPH_SAMPLES;
    for (let i = 0; i < this._frameTimes.length; i++) {
      const ms = this._frameTimes[i]!;
      const h = Math.min(ms / maxMs, 1) * GRAPH_HEIGHT;
      const x = i * barWidth;

      if (ms > 16.67) {
        ctx.fillStyle = ms > 25 ? '#ff4444' : '#ffaa00';
      } else {
        ctx.fillStyle = '#44cc66';
      }
      ctx.fillRect(x, GRAPH_HEIGHT - h, barWidth - 0.5, h);
    }

    // FPS text
    const fpsSnap = this._frameMetrics.fps.snapshot();
    ctx.fillStyle = '#fff';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText(`${Math.round(fpsSnap.avg)} FPS  ${snap.avg.toFixed(1)}ms`, 4, 10);
  }

  private _updateCpuTimings(): void {
    if (!this._cpuTimer) { this._cpuSection.innerHTML = ''; return; }

    const metrics = this._cpuTimer.getAllMetrics();
    const lines: string[] = ['<div style="margin-top:4px;color:#aaa;font-size:10px">CPU Timings</div>'];

    const sorted = Array.from(metrics.entries()).sort((a, b) => b[1].last - a[1].last);
    for (const [label, snap] of sorted) {
      const color = snap.last > 8 ? '#ff6666' : snap.last > 4 ? '#ffaa44' : '#88cc88';
      lines.push(
        `<div style="display:flex;justify-content:space-between">` +
        `<span style="color:#ccc">${escHtml(label)}</span>` +
        `<span style="color:${color}">${snap.last.toFixed(2)}ms</span></div>`,
      );
    }
    this._cpuSection.innerHTML = lines.join('');
  }

  private _updateGpuTimings(): void {
    if (this._gpuTimings.size === 0) { this._gpuSection.innerHTML = ''; return; }

    const lines: string[] = ['<div style="margin-top:4px;color:#aaa;font-size:10px">GPU Timings</div>'];
    for (const [label, ms] of this._gpuTimings) {
      const color = ms > 8 ? '#ff6666' : ms > 4 ? '#ffaa44' : '#88aaff';
      lines.push(
        `<div style="display:flex;justify-content:space-between">` +
        `<span style="color:#ccc">${escHtml(label)}</span>` +
        `<span style="color:${color}">${ms.toFixed(2)}ms</span></div>`,
      );
    }
    this._gpuSection.innerHTML = lines.join('');
  }

  private _updateMemory(): void {
    const perf = performance as any;
    if (!perf.memory) { this._memSection.innerHTML = ''; return; }

    const used = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
    const total = (perf.memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);

    this._memSection.innerHTML =
      `<div style="margin-top:4px;color:#aaa;font-size:10px">Memory</div>` +
      `<div style="display:flex;justify-content:space-between">` +
      `<span style="color:#ccc">JS Heap</span>` +
      `<span style="color:#88aaff">${used}/${total} MB</span></div>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

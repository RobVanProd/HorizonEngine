import type { EngineAI } from './engine-ai.js';
import type { CommandRouter } from './command-router.js';

export interface SceneContextLoopOptions {
  intervalMs?: number;
  layoutGridSize?: number;
  layoutLimit?: number;
  captureTopViewportInLoop?: boolean;
}

export interface SceneContextViewportCapture {
  width: number;
  height: number;
  dataUrl: string;
  state: unknown;
}

export interface SceneContextLayoutSummary {
  count: number;
  cameraEye?: [number, number, number];
  bounds: {
    min: [number, number];
    max: [number, number];
    size: [number, number];
  } | null;
  occupancy: number[][];
  landmarks: Array<{
    entityId: number;
    label: string;
    position: [number, number];
    radius: number;
    triangles: number;
  }>;
  labelCounts: Array<{ label: string; count: number }>;
}

export interface SceneContextSnapshot {
  capturedAt: string;
  viewport: SceneContextViewportCapture | null;
  topViewport: SceneContextViewportCapture | null;
  layout: SceneContextLayoutSummary | null;
  topDown: {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
}

export class SceneContextLoop {
  readonly ai: EngineAI;
  readonly options: Required<SceneContextLoopOptions>;
  private _timer: number | null = null;
  private _capturing = false;
  private _latest: SceneContextSnapshot | null = null;

  constructor(ai: EngineAI, options: SceneContextLoopOptions = {}) {
    this.ai = ai;
    this.options = {
      intervalMs: options.intervalMs ?? 2500,
      layoutGridSize: options.layoutGridSize ?? 16,
      layoutLimit: options.layoutLimit ?? 8000,
      captureTopViewportInLoop: options.captureTopViewportInLoop ?? false,
    };
  }

  start(): void {
    if (this._timer !== null || typeof window === 'undefined') return;
    this._timer = window.setInterval(() => {
      void this.captureNow({ includeTopViewport: this.options.captureTopViewportInLoop });
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this._timer !== null && typeof window !== 'undefined') {
      window.clearInterval(this._timer);
    }
    this._timer = null;
  }

  isRunning(): boolean {
    return this._timer !== null;
  }

  getLatest(): SceneContextSnapshot | null {
    return this._latest;
  }

  registerCommands(router: CommandRouter): void {
    router.register(
      {
        action: 'engine.getSceneContext',
        description: 'Get the latest automatically captured viewport image, top-down layout map, and scene layout summary.',
        params: {},
      },
      () => ({
        ok: true,
        data: this._latest,
      }),
    );

    router.register(
      {
        action: 'engine.captureSceneContext',
        description: 'Capture fresh viewport and layout context for AI reasoning right now.',
        params: {
          includeTopViewport: { type: 'boolean', description: 'Whether to also capture a real top-down viewport image. This temporarily changes the camera while capturing.', default: false },
        },
      },
      async (params) => ({
        ok: true,
        data: await this.captureNow({
          includeTopViewport: Boolean(params['includeTopViewport'] ?? false),
        }),
      }),
    );
  }

  async captureNow(options: { includeTopViewport?: boolean } = {}): Promise<SceneContextSnapshot | null> {
    if (this._capturing) return this._latest;
    this._capturing = true;
    try {
      const layoutResult = await this.ai.execute({
        action: 'scene.layoutSummary',
        params: {
          gridSize: this.options.layoutGridSize,
          limit: this.options.layoutLimit,
        },
      });
      const layout = layoutResult.ok ? layoutResult.data as SceneContextLayoutSummary : null;

      let viewport: SceneContextViewportCapture | null = null;
      const viewportResult = await this.ai.execute({
        action: 'editor.captureViewport',
        params: {},
      });
      if (viewportResult.ok) {
        viewport = viewportResult.data as SceneContextViewportCapture;
      }

      let topViewport: SceneContextViewportCapture | null = null;
      if (options.includeTopViewport && layout?.bounds) {
        const centerX = (layout.bounds.min[0] + layout.bounds.max[0]) * 0.5;
        const centerZ = (layout.bounds.min[1] + layout.bounds.max[1]) * 0.5;
        const orthoSize = Math.max(
          12,
          Math.max(layout.bounds.size[0], layout.bounds.size[1]) * 0.62,
        );
        const topViewportResult = await this.ai.execute({
          action: 'editor.captureViewport',
          params: {
            preset: 'top',
            restoreCamera: true,
            targetX: centerX,
            targetY: 0,
            targetZ: centerZ,
            ortho: true,
            orthoSize,
            waitFrames: 2,
          },
        });
        if (topViewportResult.ok) {
          topViewport = topViewportResult.data as SceneContextViewportCapture;
        }
      }

      const snapshot: SceneContextSnapshot = {
        capturedAt: new Date().toISOString(),
        viewport,
        topViewport,
        layout,
        topDown: layout ? buildTopDownCapture(layout) : null,
      };
      this._latest = snapshot;
      return snapshot;
    } catch {
      return this._latest;
    } finally {
      this._capturing = false;
    }
  }
}

function buildTopDownCapture(layout: SceneContextLayoutSummary): {
  dataUrl: string;
  width: number;
  height: number;
} {
  const occupancy = layout.occupancy ?? [];
  const rows = occupancy.length;
  const cols = rows > 0 ? occupancy[0]!.length : 0;
  const cell = 18;
  const pad = 18;
  const width = Math.max(220, cols * cell + pad * 2);
  const height = Math.max(220, rows * cell + pad * 2 + 48);
  const labels = layout.landmarks.slice(0, 6);
  const cells: string[] = [];

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const value = occupancy[z]?.[x] ?? 0;
      const shade = Math.round(24 + value * 176);
      cells.push(
        `<rect x="${pad + x * cell}" y="${pad + z * cell}" width="${cell}" height="${cell}" fill="rgb(${16 + Math.round(value * 48)}, ${shade}, ${64 + Math.round(value * 68)})" />`,
      );
    }
  }

  const labelMarkup = labels.map((landmark, index) => {
    if (!layout.bounds || !layout.bounds.size[0] || !layout.bounds.size[1]) return '';
    const nx = (landmark.position[0] - layout.bounds.min[0]) / Math.max(layout.bounds.size[0], 1e-3);
    const nz = (landmark.position[1] - layout.bounds.min[1]) / Math.max(layout.bounds.size[1], 1e-3);
    const x = pad + nx * cols * cell;
    const y = pad + nz * rows * cell;
    return [
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#f7d774" stroke="#0b1220" stroke-width="1.5" />`,
      `<text x="${(x + 8).toFixed(1)}" y="${(y - 6 + index * 0).toFixed(1)}" fill="#e8eefc" font-size="10" font-family="monospace">${escapeXml(landmark.label)}</text>`,
    ].join('');
  }).join('');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#081018" />',
    `<rect x="${pad - 1}" y="${pad - 1}" width="${cols * cell + 2}" height="${rows * cell + 2}" fill="none" stroke="#5c728f" stroke-width="1" />`,
    cells.join(''),
    labelMarkup,
    `<text x="${pad}" y="${height - 22}" fill="#e8eefc" font-size="12" font-family="monospace">Visible renderables: ${layout.count}</text>`,
    `<text x="${pad}" y="${height - 8}" fill="#8ea4bf" font-size="11" font-family="monospace">Top-down occupancy from scene.layoutSummary</text>`,
    '</svg>',
  ].join('');

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

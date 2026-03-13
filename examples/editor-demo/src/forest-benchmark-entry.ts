import { Engine } from '@engine/core';
import { mat4LookAt, mat4Multiply, mat4Perspective } from '@engine/renderer-webgpu';
import { runForestStressBenchmarkMatrix, serializeForestStressBenchmarkRun, type ForestStressBenchmarkRun } from '@engine/ai';
import {
  FOREST_STRESS_BENCHMARK_SCENE_NAME,
  setupFirstNatureExpeditionForestStressScene,
} from './forest-stress-benchmark.js';

declare global {
  interface Window {
    __HORIZON_FOREST_BENCHMARK_RESULTS__?: ForestStressBenchmarkRun[];
    runFirstNatureForestBenchmark?: () => Promise<ForestStressBenchmarkRun[]>;
  }
}

const appElement = document.getElementById('app');
const statusElement = document.getElementById('status');
const recordsElement = document.getElementById('records');
const downloadButton = document.getElementById('download-json') as HTMLButtonElement | null;

if (!appElement || !statusElement || !recordsElement) {
  throw new Error('Forest benchmark page is missing required DOM nodes.');
}

const app = appElement;
const status = statusElement;
const records = recordsElement;

let latestResults: ForestStressBenchmarkRun[] = [];

async function runSession(): Promise<ForestStressBenchmarkRun[]> {
  setStatus('Running forest benchmark: low -> medium -> high -> extreme');
  records.textContent = '';
  latestResults = [];
  setDownloadEnabled(false);

  const results = await runForestStressBenchmarkMatrix({
    sceneName: FOREST_STRESS_BENCHMARK_SCENE_NAME,
    createContext: async () => {
      const host = document.createElement('div');
      host.className = 'benchmark-host';
      app.appendChild(host);

      const engine = new Engine();
      await engine.initialize(
        {
          container: host,
          renderer: 'pbr',
        },
        {
          environment: {
            sunDirection: [0.42, 0.82, 0.18],
            sunIntensity: 50.0,
            cubemapSize: 256,
            backgroundSource: 'procedural',
          },
          shadow: { resolution: 1024, frustumSize: 80 },
        },
      );

      return {
        engine,
        cleanup: () => {
          engine.destroy();
          host.remove();
        },
      };
    },
    setupScene: async ({ engine }, densityLabel) => {
      setStatus(`Running ${densityLabel}...`);
      const { bounds } = await setupFirstNatureExpeditionForestStressScene(engine, densityLabel);
      configureBenchmarkCamera(engine, bounds);
      engine.start();
      await waitFrames(2);
      engine.stop();
      return {
        notes: [
          'Browser entrypoint: examples/editor-demo/forest-benchmark.html',
          `Density profile executed: ${densityLabel}`,
        ],
      };
    },
  });

  latestResults = results;
  window.__HORIZON_FOREST_BENCHMARK_RESULTS__ = results;
  window.runFirstNatureForestBenchmark = runSession;

  const serialized = JSON.stringify(results, null, 2);
  records.textContent = serialized;
  for (const run of results) {
    console.log(`[ForestBenchmark] ${run.densityLabel}`, serializeForestStressBenchmarkRun(run));
  }
  setStatus(`Completed ${results.length} runs for ${FOREST_STRESS_BENCHMARK_SCENE_NAME}`);
  setDownloadEnabled(true);
  return results;
}

function configureBenchmarkCamera(
  engine: Engine,
  bounds: { center: [number, number, number]; radius: number; min: [number, number, number] },
): void {
  const eye: [number, number, number] = [
    bounds.center[0] + bounds.radius * 0.58,
    Math.max(bounds.min[1] + 18, bounds.center[1] + bounds.radius * 0.22),
    bounds.center[2] + bounds.radius * 0.58,
  ];
  const target: [number, number, number] = [
    bounds.center[0],
    Math.max(bounds.min[1] + 4, bounds.center[1]),
    bounds.center[2],
  ];
  const aspect = Math.max(1, app.clientWidth / Math.max(1, app.clientHeight));
  const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, Math.max(1000, bounds.radius * 8));
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  engine.setCamera(mat4Multiply(projection, view), eye);
}

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function setStatus(message: string): void {
  status.textContent = message;
}

function setDownloadEnabled(enabled: boolean): void {
  if (!downloadButton) return;
  downloadButton.disabled = !enabled;
}

downloadButton?.addEventListener('click', () => {
  if (latestResults.length === 0) return;
  const blob = new Blob([JSON.stringify(latestResults, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${FOREST_STRESS_BENCHMARK_SCENE_NAME}-forest-benchmark-v0.json`;
  link.click();
  URL.revokeObjectURL(url);
});

window.runFirstNatureForestBenchmark = runSession;
void runSession().catch((error) => {
  setStatus(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('[ForestBenchmark] Failed to run browser benchmark session', error);
});

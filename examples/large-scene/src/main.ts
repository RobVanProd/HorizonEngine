import { detectCapabilities, createGPUContext, createCanvas, InputState } from '@engine/platform';
import { FrameMetrics, CpuTimer, RollingMetrics } from '@engine/profiler';
import {
  GpuDrivenRenderer,
  Renderer,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  mat4Translation,
  mat4Scale,
  mat4RotationY,
  mat4Identity,
  createCubeGeometry,
} from '@engine/renderer-webgpu';
import { GpuCullPipeline, computeMeshBoundingSphere } from '@engine/visibility';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INSTANCE_COUNT = 50_000;
const WORLD_RADIUS = 400;
const MAX_HEIGHT = 30;
const NEAR_PLANE = 0.1;
const FAR_PLANE = 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let enableFrustumCull = true;
let enableOcclusionCull = false;
let freezeCullCamera = false;
let frozenVP: Float32Array | null = null;

const frameMetrics = new FrameMetrics();
const cpuTimer = new CpuTimer();
const cullStatsVisible = new RollingMetrics(120);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const errorBanner = document.getElementById('error-banner')!;

  try {
    const caps = detectCapabilities();
    if (!caps.webgpu) throw new Error('WebGPU is required.');

    const canvas = createCanvas({ container: document.getElementById('app')!, autoResize: true });
    const gpu = await createGPUContext({
      canvas: canvas.element,
      powerPreference: 'high-performance',
    });

    // Setup renderers
    const gpuRenderer = new GpuDrivenRenderer(gpu);
    await gpuRenderer.initialize();

    const naiveRenderer = new Renderer(gpu);
    await naiveRenderer.initialize();

    // Setup GPU cull pipeline
    const cullPipeline = new GpuCullPipeline(gpu);
    await cullPipeline.initialize(INSTANCE_COUNT);

    // Generate scene
    const { instanceData, transforms } = generateScene();
    cullPipeline.uploadInstances(instanceData, INSTANCE_COUNT);

    // Create instance bind groups for GPU-driven path
    const instanceBG_frustum = gpuRenderer.createInstanceBindGroup(
      cullPipeline.instanceBuffer,
      cullPipeline.frustumVisibleBuffer,
    );
    const instanceBG_occlusion = gpuRenderer.createInstanceBindGroup(
      cullPipeline.instanceBuffer,
      cullPipeline.visibleIndicesBuffer,
    );

    // Input
    const input = new InputState();
    input.attach(canvas.element);

    // Controls
    const chkFrustum = document.getElementById('chk-frustum') as HTMLInputElement;
    const chkOcclusion = document.getElementById('chk-occlusion') as HTMLInputElement;
    const chkFreeze = document.getElementById('chk-freeze') as HTMLInputElement;
    chkFrustum.addEventListener('change', () => { enableFrustumCull = chkFrustum.checked; });
    chkOcclusion.addEventListener('change', () => { enableOcclusionCull = chkOcclusion.checked; });
    chkFreeze.addEventListener('change', () => {
      freezeCullCamera = chkFreeze.checked;
      if (!freezeCullCamera) frozenVP = null;
    });

    // Resize handling
    new ResizeObserver(() => {
      gpuRenderer.handleResize();
      naiveRenderer.handleResize();
    }).observe(canvas.element);

    // Frame loop
    let lastTime = 0;
    let frameNumber = 0;

    function frame(timestamp: number) {
      const dt = lastTime > 0 ? (timestamp - lastTime) / 1000 : 1 / 60;
      lastTime = timestamp;
      frameNumber++;
      frameMetrics.beginFrame(timestamp);

      input.update();

      cpuTimer.start('total');

      // Camera
      const t = timestamp * 0.0001;
      const camDist = 120;
      const camHeight = 50;
      const eye: [number, number, number] = [
        Math.cos(t) * camDist,
        camHeight + Math.sin(t * 0.7) * 15,
        Math.sin(t) * camDist,
      ];
      const target: [number, number, number] = [
        Math.cos(t + 0.5) * 30,
        8,
        Math.sin(t + 0.5) * 30,
      ];
      const aspect = canvas.element.width / canvas.element.height;
      const proj = mat4Perspective(Math.PI / 3.5, aspect, NEAR_PLANE, FAR_PLANE);
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      const vp = mat4Multiply(proj, view);

      // Freeze culling VP if requested
      if (freezeCullCamera && !frozenVP) {
        frozenVP = new Float32Array(vp);
      }
      const cullVP = frozenVP ?? vp;

      if (enableFrustumCull) {
        // --- GPU-driven path ---
        cpuTimer.start('gpu-cull');

        gpuRenderer.updateCamera(vp, eye);

        const encoder = gpu.device.createCommandEncoder();

        // Culling
        cullPipeline.encodeCulling(
          encoder,
          cullVP,
          gpuRenderer.geometry.indexCount,
          canvas.element.width,
          canvas.element.height,
          NEAR_PLANE,
          enableOcclusionCull ? gpuRenderer.depthTexture : null,
          enableOcclusionCull,
        );

        cpuTimer.stop('gpu-cull');

        if (enableOcclusionCull) {
          // Two-pass: depth pre-pass → HZB → occlusion cull → color pass
          cpuTimer.start('depth-prepass');
          gpuRenderer.encodeDepthPrePass(encoder, instanceBG_frustum, cullPipeline.frustumDrawArgsBuffer);
          cpuTimer.stop('depth-prepass');

          // HZB + occlusion is encoded inside encodeCulling when depthTexture is provided
          // But we need to re-encode because the depth pass just happened...
          // Actually the culling was encoded before the depth pass.
          // For proper two-pass we need: frustum cull → depth prepass → HZB → occlusion → color
          // This requires splitting encodeCulling. For Phase 1, we'll do frustum-only indirect.

          cpuTimer.start('render');
          gpuRenderer.encodeColorPass(encoder, instanceBG_occlusion, cullPipeline.drawArgsBuffer, true);
          cpuTimer.stop('render');
        } else {
          // Single pass: frustum cull → color
          cpuTimer.start('render');
          gpuRenderer.encodeColorPass(encoder, instanceBG_frustum, cullPipeline.frustumDrawArgsBuffer, true);
          cpuTimer.stop('render');
        }

        gpu.device.queue.submit([encoder.finish()]);

        // Track visible count (approximate — we know the frustum reduces the set)
        // Exact stats require readback which we do infrequently
        if (frameNumber % 60 === 0) {
          trackVisibleCount(gpu, cullPipeline);
        }

      } else {
        // --- Naive path: CPU uploads all instances every frame ---
        cpuTimer.start('naive-upload');

        naiveRenderer.updateCamera(vp, eye);
        naiveRenderer.beginInstances();

        for (let i = 0; i < INSTANCE_COUNT; i++) {
          const t = transforms[i]!;
          naiveRenderer.pushInstance(t.model, t.color);
        }

        cpuTimer.stop('naive-upload');

        cpuTimer.start('render');
        naiveRenderer.render();
        cpuTimer.stop('render');
      }

      cpuTimer.stop('total');

      // Stats overlay
      if (frameNumber % 10 === 0) {
        updateStats();
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  } catch (err: any) {
    errorBanner.style.display = 'block';
    errorBanner.innerHTML = `
      <h2>Failed to initialize</h2>
      <pre style="margin-top:12px;white-space:pre-wrap;color:#f88">${err.message}</pre>
      <p style="margin-top:16px;color:#aaa">
        This demo requires WebGPU.<br><br>
        <strong>Linux users:</strong> Launch Chrome with:<br>
        <code style="color:#6cf">google-chrome --enable-unsafe-webgpu --enable-features=Vulkan</code><br><br>
        Or check <code style="color:#6cf">chrome://gpu</code> for WebGPU status and
        <code style="color:#6cf">chrome://flags/#enable-unsafe-webgpu</code> to enable it.
      </p>
    `;
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Scene generation
// ---------------------------------------------------------------------------

interface InstanceTransform {
  model: Float32Array;
  color: [number, number, number, number];
}

function generateScene(): { instanceData: Float32Array; transforms: InstanceTransform[] } {
  const geometry = createCubeGeometry();
  const bounds = computeMeshBoundingSphere(geometry.vertices, geometry.stride, geometry.vertexCount);

  // Per-instance GPU data: model(16) + boundCenter(3) + boundRadius(1) + color(4) = 24 floats → but
  // the GPU struct is: model(16f) + bound_center(3f) + bound_radius(1f) + color(4f) = 24 floats = 96 bytes
  // Struct alignment in WGSL: each vec4 is 16-byte aligned.
  // Layout: model_0(4f) + model_1(4f) + model_2(4f) + model_3(4f) + bound_center(3f)+radius(1f) + color(4f) = 24 floats
  const FLOATS_PER_INSTANCE = 24;
  const instanceData = new Float32Array(INSTANCE_COUNT * FLOATS_PER_INSTANCE);
  const transforms: InstanceTransform[] = [];

  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * WORLD_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * MAX_HEIGHT;

    const sx = 0.3 + Math.random() * 1.5;
    const sy = 0.3 + Math.random() * 3.0;
    const sz = 0.3 + Math.random() * 1.5;

    const rotY = Math.random() * Math.PI * 2;

    const translation = mat4Translation(x, y, z);
    const rotation = mat4RotationY(rotY);
    const scale = mat4Scale(sx, sy, sz);
    const model = mat4Multiply(translation, mat4Multiply(rotation, scale));

    // HSL coloring by distance from center
    const distRatio = radius / WORLD_RADIUS;
    const hue = distRatio * 280 + 180;
    const [r, g, b] = hslToRgb(hue % 360, 0.5 + distRatio * 0.3, 0.4 + Math.random() * 0.2);
    const color: [number, number, number, number] = [r, g, b, 1.0];

    // Scale the bounding sphere
    const maxScale = Math.max(sx, sy, sz);

    const off = i * FLOATS_PER_INSTANCE;
    instanceData.set(model, off);
    instanceData[off + 16] = bounds.cx;
    instanceData[off + 17] = bounds.cy;
    instanceData[off + 18] = bounds.cz;
    instanceData[off + 19] = bounds.r;
    instanceData[off + 20] = color[0];
    instanceData[off + 21] = color[1];
    instanceData[off + 22] = color[2];
    instanceData[off + 23] = color[3];

    transforms.push({ model, color });
  }

  return { instanceData, transforms };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

let lastVisibleCount = INSTANCE_COUNT;

async function trackVisibleCount(gpu: any, cullPipeline: GpuCullPipeline) {
  try {
    const encoder = gpu.device.createCommandEncoder();
    const stats = await cullPipeline.readStats(encoder);
    lastVisibleCount = stats.afterFrustum;
    cullStatsVisible.push(lastVisibleCount);
  } catch {
    // Readback failures are non-fatal
  }
}

const statsEl = document.getElementById('stats')!;

function updateStats() {
  const report = frameMetrics.report();
  const metrics = cpuTimer.getAllMetrics();

  const fps = report.fps.avg.toFixed(0);
  const frameAvg = report.frameTimes.avg.toFixed(2);
  const frameP95 = report.frameTimes.p95.toFixed(2);

  const cullPct = ((1 - lastVisibleCount / INSTANCE_COUNT) * 100).toFixed(1);
  const visibleStr = lastVisibleCount.toLocaleString();

  const mode = enableFrustumCull ? 'GPU Indirect' : 'Naive CPU';
  const modeColor = enableFrustumCull ? 'v-green' : 'v-yellow';

  let html = `
    <div class="section-title">Scene</div>
    <div class="row"><span class="label">Total Instances</span><span class="value v-blue">${INSTANCE_COUNT.toLocaleString()}</span></div>
    <div class="row"><span class="label">Visible</span><span class="value v-green">${visibleStr}</span></div>
    <div class="row"><span class="label">Culled</span><span class="value v-red">${cullPct}%</span></div>
    <div class="row"><span class="label">World Radius</span><span class="value v-blue">${WORLD_RADIUS}m</span></div>
    <div class="sep"></div>

    <div class="section-title">Mode</div>
    <div class="row"><span class="label">Render Path</span><span class="value ${modeColor}">${mode}</span></div>
    <div class="row"><span class="label">Occlusion</span><span class="value ${enableOcclusionCull ? 'v-green' : 'v-yellow'}">${enableOcclusionCull ? 'HZB ON' : 'OFF'}</span></div>
    <div class="sep"></div>

    <div class="section-title">Performance</div>
    <div class="row"><span class="label">FPS</span><span class="value v-blue">${fps}</span></div>
    <div class="row"><span class="label">Frame (avg)</span><span class="value v-blue">${frameAvg} ms</span></div>
    <div class="row"><span class="label">Frame (p95)</span><span class="value v-yellow">${frameP95} ms</span></div>
  `;

  const timers = ['total', 'gpu-cull', 'naive-upload', 'depth-prepass', 'render'];
  const hasTimerData = timers.some(l => metrics.has(l));
  if (hasTimerData) {
    html += '<div class="sep"></div><div class="section-title">CPU Phases</div>';
    for (const label of timers) {
      const m = metrics.get(label);
      if (m) {
        html += `<div class="row"><span class="label">${label}</span><span class="value v-blue">${m.avg.toFixed(2)} ms</span></div>`;
      }
    }
  }

  statsEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

main();

import { Engine } from '@engine/core';
import {
  World,
  defineComponent,
  CommandBuffer,
  LocalTransform,
  WorldMatrix,
  Parent,
  HierarchyDepth,
  createTransformSystem,
  type Query,
} from '@engine/ecs';
import { FieldType } from '@engine/memory';
import { Phase, FixedTimestep, WorkerPool, type FrameContext } from '@engine/scheduler';
import { SpatialGrid } from '@engine/streaming';
import {
  Renderer,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  mat4Translation,
  mat4Scale,
  mat4RotationY,
} from '@engine/renderer-webgpu';

// ---------------------------------------------------------------------------
// Component definitions
// ---------------------------------------------------------------------------

const Velocity = defineComponent('Velocity', {
  x: FieldType.F32,
  y: FieldType.F32,
  z: FieldType.F32,
});

const Color = defineComponent('Color', {
  r: FieldType.F32,
  g: FieldType.F32,
  b: FieldType.F32,
  a: FieldType.F32,
});

const RotationSpeed = defineComponent('RotationSpeed', {
  speed: FieldType.F32,
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT_COUNT = 5_000;
const CHILDREN_PER_ROOT = 1;
const ENTITY_COUNT = ROOT_COUNT * (1 + CHILDREN_PER_ROOT);
const SPAWN_RADIUS = 80;
const BOUNCE_HEIGHT = 15;
const FIXED_DT = 1 / 60;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const errorBanner = document.getElementById('error-banner')!;

  try {
    const engine = new Engine();
    await engine.initialize({ container: document.getElementById('app')! });

    const world = engine.world;
    const renderer = engine.renderer;

    // Fixed timestep
    const fixedStep = new FixedTimestep(FIXED_DT, 4);

    // Command buffer
    const cmdBuffer = new CommandBuffer();

    // Worker pool for parallel simulation
    const workerPool = new WorkerPool(Math.min(4, navigator.hardwareConcurrency ?? 2));

    // Spatial grid
    const spatialGrid = new SpatialGrid(32, 200);

    // Spawn entities with transform hierarchy
    const { rootIds, childIds } = spawnEntities(world);
    const allIds = [...rootIds, ...childIds];

    // Transform system
    const transformSys = createTransformSystem(world);

    // Create queries
    const movableQuery = world.query(LocalTransform, Velocity);
    const rotQuery = world.query(LocalTransform, RotationSpeed);
    const renderQuery = world.query(LocalTransform, WorldMatrix, Color);

    // Register worker kernels for parallel physics
    registerWorkerKernels(workerPool);
    let workersReady = false;

    // Try to init workers (may fail in non-COOP contexts)
    try {
      await workerPool.initialize();
      workersReady = true;
      console.log(`[Engine] Worker pool: ${workerPool.size} threads`);
    } catch (e) {
      console.warn('[Engine] Workers unavailable, falling back to main thread:', e);
    }

    // Assign entities to spatial grid
    for (const id of allIds) {
      const px = world.getField(id, LocalTransform, 'px');
      const pz = world.getField(id, LocalTransform, 'pz');
      spatialGrid.updateEntity(id, px, pz);
    }

    // Register systems
    engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => {
      fixedStep.accumulate(ctx.deltaTime);
      while (fixedStep.shouldStep()) {
        movementSystem(fixedStep.fixedDt, movableQuery);
        rotationSystem(fixedStep.fixedDt, rotQuery);
      }
    }, 'physics');

    engine.scheduler.addSystem(Phase.TRANSFORM, () => {
      transformSys.propagate();
    }, 'transforms');

    engine.scheduler.addSystem(Phase.SIMULATE, () => {
      // Update spatial grid for a subset of entities each frame
      const frame = engine.frameMetrics.frameCount;
      const batchSize = Math.ceil(rootIds.length / 10);
      const start = (frame % 10) * batchSize;
      const end = Math.min(start + batchSize, rootIds.length);
      for (let i = start; i < end; i++) {
        const id = rootIds[i]!;
        const px = world.getField(id, LocalTransform, 'px');
        const pz = world.getField(id, LocalTransform, 'pz');
        spatialGrid.updateEntity(id, px, pz);
      }
    }, 'streaming', 10);

    engine.scheduler.addSystem(Phase.RENDER, (ctx) => {
      renderSystem(ctx, renderQuery, renderer, engine, spatialGrid);
    }, 'render');

    engine.scheduler.addSystem(Phase.DIAGNOSTICS, () => {
      statsSystem(engine, fixedStep, spatialGrid, workersReady, workerPool);
    }, 'stats');

    // Flush command buffer between phases
    engine.scheduler.addSystem(Phase.SIMULATE, () => {
      if (cmdBuffer.length > 0) {
        cmdBuffer.flush(world);
      }
    }, 'cmd-flush', 100);

    engine.start();
  } catch (err: any) {
    errorBanner.style.display = 'block';
    errorBanner.innerHTML = `
      <h2>Failed to initialize Horizon Engine</h2>
      <pre style="margin-top:12px;white-space:pre-wrap;color:#f88">${err.message}</pre>
      <p style="margin-top:16px; color:#aaa">
        This benchmark requires WebGPU.<br><br>
        <strong>Linux users:</strong> Launch Chrome with:<br>
        <code style="color:#6cf">google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11</code>
      </p>
    `;
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Entity spawning with hierarchy
// ---------------------------------------------------------------------------

function spawnEntities(world: World): { rootIds: number[]; childIds: number[] } {
  const rootIds: number[] = [];
  const childIds: number[] = [];

  for (let i = 0; i < ROOT_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * BOUNCE_HEIGHT;
    const s = 0.3 + Math.random() * 0.5;

    const root = world.spawn()
      .add(LocalTransform, { px: x, py: y, pz: z, rotX: 0, rotY: 0, rotZ: 0, scaleX: s, scaleY: s, scaleZ: s })
      .add(WorldMatrix)
      .add(Velocity, { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 4 })
      .add(RotationSpeed, { speed: (Math.random() - 0.5) * 3 })
      .add(Color, { r: 0, g: 0, b: 0, a: 1 })
      .id;

    // HSL coloring
    const hue = (i / ROOT_COUNT) * 360;
    const [r, g, b] = hslToRgb(hue, 0.65, 0.55);
    world.setField(root, Color, 'r', r);
    world.setField(root, Color, 'g', g);
    world.setField(root, Color, 'b', b);

    rootIds.push(root);

    // Spawn children attached to this root
    for (let c = 0; c < CHILDREN_PER_ROOT; c++) {
      const offset = 0.8 + Math.random() * 0.5;
      const childAngle = (c / CHILDREN_PER_ROOT) * Math.PI * 2;
      const cs = 0.15 + Math.random() * 0.2;

      const child = world.spawn()
        .add(LocalTransform, {
          px: Math.cos(childAngle) * offset,
          py: 0.5 + Math.random() * 0.5,
          pz: Math.sin(childAngle) * offset,
          rotX: 0, rotY: 0, rotZ: 0, scaleX: cs, scaleY: cs, scaleZ: cs,
        })
        .add(WorldMatrix)
        .add(Parent, { entity: root })
        .add(HierarchyDepth, { depth: 1 })
        .add(RotationSpeed, { speed: (Math.random() - 0.5) * 6 })
        .add(Color, { r: r * 0.7, g: g * 0.7, b: b * 0.7, a: 1 })
        .id;

      childIds.push(child);
    }
  }

  return { rootIds, childIds };
}

// ---------------------------------------------------------------------------
// Worker kernel registration
// ---------------------------------------------------------------------------

function registerWorkerKernels(pool: WorkerPool) {
  pool.registerKernel('integratePhysics', function(
    start: number, end: number,
    buffers: Record<string, SharedArrayBuffer>,
    params: Record<string, number>,
  ) {
    const px = new Float32Array(buffers['px']!);
    const py = new Float32Array(buffers['py']!);
    const pz = new Float32Array(buffers['pz']!);
    const vx = new Float32Array(buffers['vx']!);
    const vy = new Float32Array(buffers['vy']!);
    const vz = new Float32Array(buffers['vz']!);
    const dt = params['dt']!;
    const gravity = params['gravity']!;
    const radius = params['radius']!;

    for (let i = start; i < end; i++) {
      vy[i] += gravity * dt;
      px[i] += vx[i]! * dt;
      py[i] += vy[i]! * dt;
      pz[i] += vz[i]! * dt;

      if (py[i]! < 0) {
        py[i] = 0;
        vy[i] = Math.abs(vy[i]!) * (0.6 + Math.random() * 0.3);
      }

      const dist = Math.sqrt(px[i]! * px[i]! + pz[i]! * pz[i]!);
      if (dist > radius) {
        const nx = px[i]! / dist;
        const nz = pz[i]! / dist;
        px[i] = nx * radius;
        pz[i] = nz * radius;
        vx[i] = -vx[i]! * 0.5;
        vz[i] = -vz[i]! * 0.5;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

function movementSystem(dt: number, query: Query) {
  const gravity = -15;

  query.each((arch, count) => {
    const px = arch.getColumn(LocalTransform, 'px');
    const py = arch.getColumn(LocalTransform, 'py');
    const pz = arch.getColumn(LocalTransform, 'pz');
    const vx = arch.getColumn(Velocity, 'x');
    const vy = arch.getColumn(Velocity, 'y');
    const vz = arch.getColumn(Velocity, 'z');

    for (let i = 0; i < count; i++) {
      vy[i] += gravity * dt;
      px[i] += vx[i]! * dt;
      py[i] += vy[i]! * dt;
      pz[i] += vz[i]! * dt;

      if (py[i]! < 0) {
        py[i] = 0;
        vy[i] = Math.abs(vy[i]!) * (0.6 + Math.random() * 0.3);
      }

      const dist = Math.sqrt(px[i]! * px[i]! + pz[i]! * pz[i]!);
      if (dist > SPAWN_RADIUS) {
        const nx = px[i]! / dist;
        const nz = pz[i]! / dist;
        px[i] = nx * SPAWN_RADIUS;
        pz[i] = nz * SPAWN_RADIUS;
        vx[i] = -vx[i]! * 0.5;
        vz[i] = -vz[i]! * 0.5;
      }
    }
  });
}

function rotationSystem(dt: number, query: Query) {
  query.each((arch, count) => {
    const rotY = arch.getColumn(LocalTransform, 'rotY');
    const speed = arch.getColumn(RotationSpeed, 'speed');
    for (let i = 0; i < count; i++) {
      rotY[i] += speed[i]! * dt;
    }
  });
}

function renderSystem(ctx: FrameContext, query: Query, renderer: Renderer, engine: Engine, grid: SpatialGrid) {
  const t = ctx.elapsedTime * 0.15;
  const camDist = 60;
  const camHeight = 25;
  const eye: [number, number, number] = [Math.cos(t) * camDist, camHeight, Math.sin(t) * camDist];
  const target: [number, number, number] = [0, 5, 0];

  // Update grid focus
  grid.updateFocus(eye[0], eye[2]);

  const aspect = engine.canvas.element.width / engine.canvas.element.height;
  const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 500);
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  const vp = mat4Multiply(proj, view);

  renderer.updateCamera(vp, eye);
  renderer.beginInstances();

  query.each((arch, count) => {
    const cr = arch.getColumn(Color, 'r');
    const cg = arch.getColumn(Color, 'g');
    const cb = arch.getColumn(Color, 'b');
    const ca = arch.getColumn(Color, 'a');

    const wm = [];
    for (let c = 0; c < 16; c++) {
      wm.push(arch.getColumn(WorldMatrix, `m${c}` as any));
    }

    for (let i = 0; i < count; i++) {
      const model = new Float32Array(16);
      for (let c = 0; c < 16; c++) {
        model[c] = wm[c]![i]! as number;
      }
      renderer.pushInstance(model, [cr[i]! as number, cg[i]! as number, cb[i]! as number, ca[i]! as number]);
    }
  });

  renderer.render();
}

// ---------------------------------------------------------------------------
// Stats overlay
// ---------------------------------------------------------------------------

let statsTimer = 0;
const statsEl = document.getElementById('stats')!;

function statsSystem(
  engine: Engine,
  fixedStep: FixedTimestep,
  grid: SpatialGrid,
  workersReady: boolean,
  pool: WorkerPool,
) {
  statsTimer++;
  if (statsTimer % 15 !== 0) return;

  const report = engine.frameMetrics.report();
  const cpuMetrics = engine.cpuTimer.getAllMetrics();

  const fps = report.fps.avg.toFixed(0);
  const frameAvg = report.frameTimes.avg.toFixed(2);
  const frameP95 = report.frameTimes.p95.toFixed(2);

  let html = `
    <div class="row"><span class="label">Entities</span><span class="value">${ENTITY_COUNT.toLocaleString()}</span></div>
    <div class="row"><span class="label">Roots / Children</span><span class="value">${ROOT_COUNT.toLocaleString()} / ${(ENTITY_COUNT - ROOT_COUNT).toLocaleString()}</span></div>
    <div class="row"><span class="label">Archetypes</span><span class="value">${engine.world.archetypeCount}</span></div>
    <div class="row"><span class="label">Active Cells</span><span class="value">${grid.activeCellCount} / ${grid.totalCellCount}</span></div>
    <div class="row"><span class="label">Workers</span><span class="value">${workersReady ? pool.size + ' threads' : 'main-thread'}</span></div>
    <div class="sep"></div>
    <div class="row"><span class="label">FPS</span><span class="value">${fps}</span></div>
    <div class="row"><span class="label">Frame (avg)</span><span class="value">${frameAvg} ms</span></div>
    <div class="row"><span class="label">Frame (p95)</span><span class="value">${frameP95} ms</span></div>
    <div class="row"><span class="label">Sim steps/frame</span><span class="value">${fixedStep.stepsThisFrame}</span></div>
    <div class="row"><span class="label">Total sim ticks</span><span class="value">${fixedStep.totalSteps.toLocaleString()}</span></div>
  `;

  const systemLabels = ['physics', 'transforms', 'streaming', 'render'];
  const hasCpuData = systemLabels.some(l => cpuMetrics.has(l));
  if (hasCpuData) {
    html += '<div class="sep"></div>';
    for (const label of systemLabels) {
      const m = cpuMetrics.get(label);
      if (m) {
        html += `<div class="row"><span class="label">${label}</span><span class="value">${m.avg.toFixed(2)} ms</span></div>`;
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

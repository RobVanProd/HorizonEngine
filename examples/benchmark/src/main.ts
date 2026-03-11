import { Engine } from '@engine/core';
import { World, defineComponent, type Query } from '@engine/ecs';
import { FieldType } from '@engine/memory';
import { Phase, type FrameContext } from '@engine/scheduler';
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

const Position = defineComponent('Position', {
  x: FieldType.F32,
  y: FieldType.F32,
  z: FieldType.F32,
});

const Velocity = defineComponent('Velocity', {
  x: FieldType.F32,
  y: FieldType.F32,
  z: FieldType.F32,
});

const Scale = defineComponent('Scale', {
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

const Rotation = defineComponent('Rotation', {
  y: FieldType.F32,
  speed: FieldType.F32,
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENTITY_COUNT = 10_000;
const SPAWN_RADIUS = 80;
const BOUNCE_HEIGHT = 15;

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

    // Spawn entities
    spawnEntities(world);

    // Create queries
    const movableQuery = world.query(Position, Velocity);
    const rotatingQuery = world.query(Rotation);
    const renderQuery = world.query(Position, Scale, Color);

    // Register systems
    engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => movementSystem(ctx, movableQuery, world), 'movement');
    engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => rotationSystem(ctx, rotatingQuery, world), 'rotation');
    engine.scheduler.addSystem(Phase.RENDER, (ctx) => renderSystem(ctx, renderQuery, renderer, world, engine), 'render');
    engine.scheduler.addSystem(Phase.DIAGNOSTICS, () => statsSystem(engine), 'stats');

    engine.start();
  } catch (err: any) {
    errorBanner.style.display = 'block';
    errorBanner.innerHTML = `
      <h2>Failed to initialize Horizon Engine</h2>
      <p style="margin-top:12px">${err.message}</p>
      <p style="margin-top:16px; color:#aaa">
        This benchmark requires WebGPU. Please use
        <a href="https://www.google.com/chrome/" target="_blank">Chrome 113+</a> or
        <a href="https://www.microsoftedgeinsider.com/" target="_blank">Edge 113+</a>.
      </p>
    `;
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Entity spawning
// ---------------------------------------------------------------------------

function spawnEntities(world: World) {
  const ids = world.spawnBatch(ENTITY_COUNT, [Position, Velocity, Scale, Color, Rotation]);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * BOUNCE_HEIGHT;

    world.setField(id, Position, 'x', x);
    world.setField(id, Position, 'y', y);
    world.setField(id, Position, 'z', z);

    world.setField(id, Velocity, 'x', (Math.random() - 0.5) * 4);
    world.setField(id, Velocity, 'y', (Math.random() - 0.5) * 8);
    world.setField(id, Velocity, 'z', (Math.random() - 0.5) * 4);

    const s = 0.2 + Math.random() * 0.6;
    world.setField(id, Scale, 'x', s);
    world.setField(id, Scale, 'y', s);
    world.setField(id, Scale, 'z', s);

    // HSL-based coloring for variety
    const hue = (i / ids.length) * 360;
    const [r, g, b] = hslToRgb(hue, 0.65, 0.55);
    world.setField(id, Color, 'r', r);
    world.setField(id, Color, 'g', g);
    world.setField(id, Color, 'b', b);
    world.setField(id, Color, 'a', 1.0);

    world.setField(id, Rotation, 'y', Math.random() * Math.PI * 2);
    world.setField(id, Rotation, 'speed', (Math.random() - 0.5) * 3);
  }
}

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

function movementSystem(ctx: FrameContext, query: Query, world: World) {
  const dt = ctx.deltaTime;
  const gravity = -15;

  query.each((arch, count) => {
    const px = arch.getColumn(Position, 'x');
    const py = arch.getColumn(Position, 'y');
    const pz = arch.getColumn(Position, 'z');
    const vx = arch.getColumn(Velocity, 'x');
    const vy = arch.getColumn(Velocity, 'y');
    const vz = arch.getColumn(Velocity, 'z');

    for (let i = 0; i < count; i++) {
      vy[i] += gravity * dt;
      px[i] += vx[i]! * dt;
      py[i] += vy[i]! * dt;
      pz[i] += vz[i]! * dt;

      // Bounce off ground
      if (py[i]! < 0) {
        py[i] = 0;
        vy[i] = Math.abs(vy[i]!) * (0.6 + Math.random() * 0.3);
      }

      // Contain within radius
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

function rotationSystem(ctx: FrameContext, query: Query, _world: World) {
  const dt = ctx.deltaTime;
  query.each((arch, count) => {
    const ry = arch.getColumn(Rotation, 'y');
    const rs = arch.getColumn(Rotation, 'speed');
    for (let i = 0; i < count; i++) {
      ry[i] += rs[i]! * dt;
    }
  });
}

const _tempModel = new Float32Array(16);

function renderSystem(ctx: FrameContext, query: Query, renderer: Renderer, _world: World, engine: Engine) {
  // Camera orbit
  const t = ctx.elapsedTime * 0.15;
  const camDist = 60;
  const camHeight = 25;
  const eye: [number, number, number] = [
    Math.cos(t) * camDist,
    camHeight,
    Math.sin(t) * camDist,
  ];
  const target: [number, number, number] = [0, 5, 0];

  const aspect = engine.canvas.element.width / engine.canvas.element.height;
  const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 500);
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  const vp = mat4Multiply(proj, view);

  renderer.updateCamera(vp, eye);
  renderer.beginInstances();

  query.each((arch, count) => {
    const px = arch.getColumn(Position, 'x');
    const py = arch.getColumn(Position, 'y');
    const pz = arch.getColumn(Position, 'z');
    const sx = arch.getColumn(Scale, 'x');
    const sy = arch.getColumn(Scale, 'y');
    const sz = arch.getColumn(Scale, 'z');
    const cr = arch.getColumn(Color, 'r');
    const cg = arch.getColumn(Color, 'g');
    const cb = arch.getColumn(Color, 'b');
    const ca = arch.getColumn(Color, 'a');

    let rotY: ReturnType<typeof arch.getColumn> | null = null;
    try { rotY = arch.getColumn(Rotation, 'y'); } catch { /* archetype may not have rotation */ }

    for (let i = 0; i < count; i++) {
      const translation = mat4Translation(px[i]!, py[i]!, pz[i]!);
      const scale = mat4Scale(sx[i]!, sy[i]!, sz[i]!);
      const rotation = rotY ? mat4RotationY(rotY[i]!) : mat4Scale(1, 1, 1);
      const model = mat4Multiply(translation, mat4Multiply(rotation, scale));

      renderer.pushInstance(model, [cr[i]!, cg[i]!, cb[i]!, ca[i]!]);
    }
  });

  renderer.render();
}

// ---------------------------------------------------------------------------
// Stats overlay
// ---------------------------------------------------------------------------

let statsUpdateTimer = 0;
const statsEl = document.getElementById('stats')!;

function statsSystem(engine: Engine) {
  statsUpdateTimer++;
  if (statsUpdateTimer % 15 !== 0) return;

  const report = engine.frameMetrics.report();
  const cpuMetrics = engine.cpuTimer.getAllMetrics();

  const frameLast = report.frameTimes.last.toFixed(2);
  const frameAvg = report.frameTimes.avg.toFixed(2);
  const frameP95 = report.frameTimes.p95.toFixed(2);
  const fpsAvg = report.fps.avg.toFixed(0);

  let html = `
    <div class="row"><span class="label">Entities</span><span class="value">${ENTITY_COUNT.toLocaleString()}</span></div>
    <div class="row"><span class="label">Instances</span><span class="value">${engine.renderer.instanceCount.toLocaleString()}</span></div>
    <div class="row"><span class="label">Archetypes</span><span class="value">${engine.world.archetypeCount}</span></div>
    <div class="sep"></div>
    <div class="row"><span class="label">FPS</span><span class="value">${fpsAvg}</span></div>
    <div class="row"><span class="label">Frame (last)</span><span class="value">${frameLast} ms</span></div>
    <div class="row"><span class="label">Frame (avg)</span><span class="value">${frameAvg} ms</span></div>
    <div class="row"><span class="label">Frame (p95)</span><span class="value">${frameP95} ms</span></div>
  `;

  const systemLabels = ['movement', 'rotation', 'render'];
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

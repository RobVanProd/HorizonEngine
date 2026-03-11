import { createGPUContext, createCanvas, detectCapabilities } from '@engine/platform';
import { FrameMetrics, now } from '@engine/profiler';
import { loadHDR, loadTexture } from '@engine/assets';
import {
  PBRRenderer,
  GPUMesh,
  createSphere,
  createTorus,
  createPlane,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  mat4Identity,
  mat4Translation,
  mat4Scale,
  mat4RotationY,
  type PBRMaterial,
  type SceneLighting,
} from '@engine/renderer-webgpu';

interface DrawCall {
  mesh: GPUMesh;
  material: PBRMaterial;
  modelMatrix: Float32Array;
}

async function main() {
  const errorBanner = document.getElementById('error-banner')!;

  try {
    const caps = detectCapabilities();
    if (!caps.webgpu) throw new Error('WebGPU is required but not available.');

    const canvas = createCanvas({
      container: document.getElementById('app')!,
      autoResize: true,
    });

    const gpu = await createGPUContext({
      canvas: canvas.element,
      powerPreference: 'high-performance',
    });

    const device = gpu.device;
    const renderer = new PBRRenderer(gpu);

    // Load real HDRI environment map (CC0, Poly Haven)
    let hdrData: { width: number; height: number; data: Float32Array } | undefined;
    try {
      console.log('[Demo] Loading HDRI environment...');
      const hdr = await loadHDR('/environment.hdr');
      hdrData = hdr;
      console.log(`[Demo] HDRI loaded: ${hdr.width}x${hdr.height}`);
    } catch (e) {
      console.warn('[Demo] HDRI not found, falling back to procedural sky', e);
    }

    await renderer.initialize(
      { sunDirection: [0.5, 0.8, 0.3], sunIntensity: 50.0, cubemapSize: 512, hdrData },
      { resolution: 2048, frustumSize: 40 },
    );

    // Load PBR textures (CC0, Poly Haven)
    console.log('[Demo] Loading PBR textures...');
    const tex = (url: string, srgb = false) =>
      loadTexture(device, url, { sRGB: srgb }).catch(() => null);

    const [
      metalDiffuse, metalNormal, metalRough,
      brickDiffuse, brickNormal, brickRough,
      woodDiffuse, woodNormal, woodRough,
      concreteDiffuse, concreteNormal, concreteRough,
      rockDiffuse, rockNormal, rockRough,
      grassDiffuse, grassNormal, grassRough,
      leatherDiffuse, leatherNormal, leatherRough,
      marbleDiffuse, marbleNormal, marbleRough,
    ] = await Promise.all([
      tex('/textures/metal_diffuse.jpg', true), tex('/textures/metal_normal.jpg'), tex('/textures/metal_rough.jpg'),
      tex('/textures/brick_diffuse.jpg', true), tex('/textures/brick_normal.jpg'), tex('/textures/brick_rough.jpg'),
      tex('/textures/wood_diffuse.jpg', true), tex('/textures/wood_normal.jpg'), tex('/textures/wood_rough.jpg'),
      tex('/textures/concrete_diffuse.jpg', true), tex('/textures/concrete_normal.jpg'), tex('/textures/concrete_rough.jpg'),
      tex('/textures/rock_diffuse.jpg', true), tex('/textures/rock_normal.jpg'), tex('/textures/rock_rough.jpg'),
      tex('/textures/grass_diffuse.jpg', true), tex('/textures/grass_normal.jpg'), tex('/textures/grass_rough.jpg'),
      tex('/textures/leather_diffuse.jpg', true), tex('/textures/leather_normal.jpg'), tex('/textures/leather_rough.jpg'),
      tex('/textures/marble_diffuse.jpg', true), tex('/textures/marble_normal.jpg'), tex('/textures/marble_rough.jpg'),
    ]);
    const texNames = [
      'metalDiffuse', 'metalNormal', 'metalRough',
      'brickDiffuse', 'brickNormal', 'brickRough',
      'woodDiffuse', 'woodNormal', 'woodRough',
      'concreteDiffuse', 'concreteNormal', 'concreteRough',
      'rockDiffuse', 'rockNormal', 'rockRough',
      'grassDiffuse', 'grassNormal', 'grassRough',
      'leatherDiffuse', 'leatherNormal', 'leatherRough',
      'marbleDiffuse', 'marbleNormal', 'marbleRough',
    ];
    const texValues = [
      metalDiffuse, metalNormal, metalRough,
      brickDiffuse, brickNormal, brickRough,
      woodDiffuse, woodNormal, woodRough,
      concreteDiffuse, concreteNormal, concreteRough,
      rockDiffuse, rockNormal, rockRough,
      grassDiffuse, grassNormal, grassRough,
      leatherDiffuse, leatherNormal, leatherRough,
      marbleDiffuse, marbleNormal, marbleRough,
    ];
    const loaded = texValues.filter(t => t !== null).length;
    const failed = texNames.filter((n, i) => texValues[i] === null);
    console.log(`[Demo] Textures: ${loaded}/${texValues.length} loaded`);
    if (failed.length) console.warn('[Demo] Failed textures:', failed);

    const frameMetrics = new FrameMetrics();
    const drawCalls: DrawCall[] = [];

    // --- Geometry ---
    const sphereHi = GPUMesh.create(device, createSphere(1, 64, 32));
    const sphereMed = GPUMesh.create(device, createSphere(1, 48, 24));
    const torusMesh = GPUMesh.create(device, createTorus(1.2, 0.5, 48, 24));
    const planeMesh = GPUMesh.create(device, createPlane(80, 80, 8, 8));

    // --- TEXTURED SHOWCASE (front row) ---

    // Rusty metal sphere
    const metalMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1],
      metallic: 1.0,
      roughness: 1.0,
      ao: 1,
      ...(metalDiffuse && { albedoTexture: metalDiffuse }),
      ...(metalNormal && { normalTexture: metalNormal }),
      ...(metalRough && { mrTexture: metalRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: metalMat, modelMatrix: mat4Translation(-6, 1.5, -4) });

    // Brick sphere
    const brickMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1],
      metallic: 0,
      roughness: 1.0,
      ao: 1,
      ...(brickDiffuse && { albedoTexture: brickDiffuse }),
      ...(brickNormal && { normalTexture: brickNormal }),
      ...(brickRough && { mrTexture: brickRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: brickMat, modelMatrix: mat4Translation(-2, 1.5, -4) });

    // Wood sphere
    const woodMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1],
      metallic: 0,
      roughness: 1.0,
      ao: 1,
      ...(woodDiffuse && { albedoTexture: woodDiffuse }),
      ...(woodNormal && { normalTexture: woodNormal }),
      ...(woodRough && { mrTexture: woodRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: woodMat, modelMatrix: mat4Translation(2, 1.5, -4) });

    // Pure chrome sphere
    const chromeMat = renderer.createMaterial({
      albedo: [0.95, 0.95, 0.97, 1],
      metallic: 1.0,
      roughness: 0.02,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereHi, material: chromeMat, modelMatrix: mat4Translation(6, 1.5, -4) });

    // --- NATURAL MATERIALS ROW (middle) ---

    // Rock sphere
    const rockMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1], metallic: 0, roughness: 1.0, ao: 1,
      ...(rockDiffuse && { albedoTexture: rockDiffuse }),
      ...(rockNormal && { normalTexture: rockNormal }),
      ...(rockRough && { mrTexture: rockRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: rockMat, modelMatrix: mat4Translation(-6, 1.2, 0) });

    // Grass sphere
    const grassMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1], metallic: 0, roughness: 1.0, ao: 1,
      ...(grassDiffuse && { albedoTexture: grassDiffuse }),
      ...(grassNormal && { normalTexture: grassNormal }),
      ...(grassRough && { mrTexture: grassRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: grassMat, modelMatrix: mat4Translation(-2, 1.2, 0) });

    // Leather sphere
    const leatherMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1], metallic: 0, roughness: 1.0, ao: 1,
      ...(leatherDiffuse && { albedoTexture: leatherDiffuse }),
      ...(leatherNormal && { normalTexture: leatherNormal }),
      ...(leatherRough && { mrTexture: leatherRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: leatherMat, modelMatrix: mat4Translation(2, 1.2, 0) });

    // Stone tiles sphere
    const marbleMat = renderer.createMaterial({
      albedo: [1, 1, 1, 1], metallic: 0, roughness: 1.0, ao: 1,
      ...(marbleDiffuse && { albedoTexture: marbleDiffuse }),
      ...(marbleNormal && { normalTexture: marbleNormal }),
      ...(marbleRough && { mrTexture: marbleRough }),
    });
    drawCalls.push({ mesh: sphereHi, material: marbleMat, modelMatrix: mat4Translation(6, 1.2, 0) });

    // --- MATERIAL REFERENCE ROW (back) ---

    // Gold
    const goldMat = renderer.createMaterial({
      albedo: [1.0, 0.86, 0.42, 1],
      metallic: 1.0,
      roughness: 0.1,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: goldMat, modelMatrix: mat4Translation(-7.5, 1.2, 4.5) });

    // Copper
    const copperMat = renderer.createMaterial({
      albedo: [0.96, 0.64, 0.54, 1],
      metallic: 1.0,
      roughness: 0.15,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: copperMat, modelMatrix: mat4Translation(-5, 1.2, 4.5) });

    // Titanium
    const titaniumMat = renderer.createMaterial({
      albedo: [0.54, 0.5, 0.47, 1],
      metallic: 1.0,
      roughness: 0.25,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: titaniumMat, modelMatrix: mat4Translation(-2.5, 1.2, 4.5) });

    // White plastic
    const plasticWhite = renderer.createMaterial({
      albedo: [0.95, 0.95, 0.95, 1],
      metallic: 0,
      roughness: 0.4,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: plasticWhite, modelMatrix: mat4Translation(0, 1.2, 4.5) });

    // Red plastic
    const plasticRed = renderer.createMaterial({
      albedo: [0.9, 0.1, 0.1, 1],
      metallic: 0,
      roughness: 0.35,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: plasticRed, modelMatrix: mat4Translation(2.5, 1.2, 4.5) });

    // Blue rubber
    const rubberBlue = renderer.createMaterial({
      albedo: [0.1, 0.3, 0.8, 1],
      metallic: 0,
      roughness: 0.85,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: rubberBlue, modelMatrix: mat4Translation(5, 1.2, 4.5) });

    // Black glossy
    const blackGlossy = renderer.createMaterial({
      albedo: [0.02, 0.02, 0.02, 1],
      metallic: 0,
      roughness: 0.05,
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: blackGlossy, modelMatrix: mat4Translation(7.5, 1.2, 4.5) });

    // --- GOLD TORUS ---
    drawCalls.push({ mesh: torusMesh, material: goldMat, modelMatrix: mat4Translation(0, 3.0, -1) });

    // --- EMISSIVE SPHERE ---
    const emissiveMat = renderer.createMaterial({
      albedo: [0.02, 0.02, 0.02, 1],
      metallic: 0,
      roughness: 0.9,
      emissive: [4.0, 1.5, 0.3],
      ao: 1,
    });
    drawCalls.push({ mesh: sphereMed, material: emissiveMat, modelMatrix: mat4Translation(-10, 1.2, -1) });

    // --- GROUND PLANE (concrete textured) ---
    const groundMat = renderer.createMaterial({
      albedo: [0.6, 0.6, 0.6, 1],
      metallic: 0,
      roughness: 1.0,
      ao: 1,
      ...(concreteDiffuse && { albedoTexture: concreteDiffuse }),
      ...(concreteNormal && { normalTexture: concreteNormal }),
      ...(concreteRough && { mrTexture: concreteRough }),
    });
    drawCalls.push({ mesh: planeMesh, material: groundMat, modelMatrix: mat4Identity() });

    // --- Lighting ---
    const lighting: SceneLighting = {
      direction: [-0.5, -0.8, -0.3],
      color: [1, 0.98, 0.92],
      intensity: 3.0,
      ambient: [0.01, 0.01, 0.02],
      envIntensity: 1.0,
    };

    new ResizeObserver(() => renderer.handleResize()).observe(canvas.element);

    const statsEl = document.getElementById('stats')!;
    let frameCount = 0;
    const totalDraws = drawCalls.length;

    function frame(rafTs: number) {
      const t = rafTs / 1000;
      frameMetrics.beginFrame(rafTs);
      frameCount++;

      // Orbit camera
      const camAngle = t * 0.15;
      const camDist = 18;
      const camHeight = 7;
      const eye: [number, number, number] = [
        Math.cos(camAngle) * camDist,
        camHeight,
        Math.sin(camAngle) * camDist,
      ];
      const target: [number, number, number] = [0, 1.5, 0];

      const aspect = canvas.element.width / canvas.element.height;
      const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 300);
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      const vp = mat4Multiply(proj, view);

      // Rotate torus
      const torusDraw = drawCalls.find(d => d.mesh === torusMesh);
      if (torusDraw) {
        torusDraw.modelMatrix = mat4Multiply(mat4Translation(0, 3.0, -1), mat4RotationY(t * 0.4));
      }

      // Slowly animate light direction
      const la = t * 0.08;
      lighting.direction = [-0.5 * Math.cos(la), -0.8, -0.3 * Math.sin(la)];

      renderer.setCamera(vp, eye);
      renderer.setLighting(lighting);
      renderer.beginFrame();

      for (const dc of drawCalls) {
        renderer.drawMesh(dc.mesh, dc.material, dc.modelMatrix);
      }

      renderer.endFrame();

      if (frameCount % 20 === 0) {
        const report = frameMetrics.report();
        statsEl.innerHTML = `
          <div class="section">Horizon Engine — PBR Demo</div>
          <div class="row"><span class="label">Draw Calls</span><span class="value">${totalDraws}</span></div>
          <div class="row"><span class="label">Shadow Map</span><span class="value">2048²</span></div>
          <div class="row"><span class="label">IBL Cubemap</span><span class="value">512²</span></div>
          <div class="sep"></div>
          <div class="section">Performance</div>
          <div class="row"><span class="label">FPS</span><span class="value">${report.fps.avg.toFixed(0)}</span></div>
          <div class="row"><span class="label">Frame (avg)</span><span class="value">${report.frameTimes.avg.toFixed(2)} ms</span></div>
          <div class="row"><span class="label">Frame (p95)</span><span class="value">${report.frameTimes.p95.toFixed(2)} ms</span></div>
          <div class="sep"></div>
          <div class="section">Materials</div>
          <div class="row"><span class="label">Front</span><span class="value">Metal / Brick / Wood / Chrome</span></div>
          <div class="row"><span class="label">Mid</span><span class="value">Rock / Grass / Leather / Stone</span></div>
          <div class="row"><span class="label">Back</span><span class="value">Au / Cu / Ti / Plastic / Rubber</span></div>
          <div class="row"><span class="label">Center</span><span class="value">Gold torus</span></div>
          <div class="sep"></div>
          <div class="section">Rendering</div>
          <div class="row"><span class="label">IBL</span><span class="value" style="color:#4f8">ON</span></div>
          <div class="row"><span class="label">Shadows</span><span class="value" style="color:#4f8">PCF 3x3</span></div>
          <div class="row"><span class="label">Environment</span><span class="value" style="color:#4f8">${hdrData ? 'HDRI' : 'Procedural'}</span></div>
          <div class="row"><span class="label">Tone Map</span><span class="value" style="color:#4f8">ACES</span></div>
          <div class="row"><span class="label">Textures</span><span class="value" style="color:#4f8">Poly Haven CC0</span></div>
        `;
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  } catch (err: any) {
    errorBanner.style.display = 'block';
    errorBanner.innerHTML = `
      <h2>Failed to initialize</h2>
      <pre style="margin-top:12px;white-space:pre-wrap;color:#f88">${err.message}</pre>
      <p style="margin-top:16px; color:#aaa">
        This demo requires WebGPU.<br><br>
        <strong>Linux users:</strong> Launch Chrome with:<br>
        <code style="color:#6cf">google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11</code>
      </p>
    `;
    console.error(err);
  }
}

main();

import { Engine } from '@engine/core';
import {
  AnimationPlayer,
  LocalTransform,
  MaterialRef,
  MeshRef,
  Parent,
  SkeletonRef,
  Visible,
  WorldMatrix,
  createTransformSystem,
} from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import {
  buildSkeletonsAndClips,
  loadFbxScene,
  loadGltf,
  loadHDR,
  type SceneBounds,
} from '@engine/assets';
import { createAnimationSystem, type AnimationRegistries } from '@engine/animation';
import {
  GPUMesh,
  createPlane,
  createRenderSystem,
  createSphere,
  type MeshData,
} from '@engine/renderer-webgpu';
import { EmitterFlags, ParticleEmitter, ParticleRenderer, getEffectsRuntime } from '@engine/effects';
import { EngineAI } from '@engine/ai';
import { Editor, registerEditorCommands } from '@engine/editor';
import { getWorldRegistry, type SplinePoint } from '@engine/world';
import { userPackBaseUrl, userPackEntries } from 'virtual:user-pack-manifest';

const BOOT_VIDEO_URL = new URL('../../../horizon_loader_blender.mp4', import.meta.url).href;

async function main() {
  await playBootIntro();

  const engine = new Engine();
  const hdrUrl = new URL('../../animation-demo/public/environment.hdr', import.meta.url).href;
  const foxUrl = new URL('../../animation-demo/public/models/Fox.glb', import.meta.url).href;

  let hdrData: { width: number; height: number; data: Float32Array } | undefined;
  try {
    hdrData = await loadHDR(hdrUrl);
  } catch (err) {
    console.warn('[EditorDemo] Failed to load HDRI, falling back to procedural sky', err);
  }

  await engine.initialize(
    { renderer: 'pbr' },
    {
      environment: { sunDirection: [0.5, 0.8, 0.3], sunIntensity: 50.0, cubemapSize: 512, hdrData },
      shadow: { resolution: 2048, frustumSize: 80 },
    },
  );

  const world = engine.world;
  const device = engine.gpu.device;
  const renderer = engine.pbrRenderer;
  renderer.enableProfiling();

  const animRegistries: AnimationRegistries = {
    skeletons: new Map(),
    clips: new Map(),
    jointBuffers: new Map(),
  };

  const transformSys = createTransformSystem(world);
  engine.scheduler.addSystem(Phase.TRANSFORM, () => transformSys.propagate(), 'transform');

  const animSys = createAnimationSystem(world, animRegistries);
  engine.scheduler.addSystem(Phase.ANIMATE, animSys.update, 'animation');

  const sceneBounds = await loadPreferredDemoScene(engine, device, animRegistries, foxUrl);
  const effects = getEffectsRuntime(engine);
  const particleRenderer = new ParticleRenderer(device, engine.gpu.format);
  engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => effects.update(ctx.deltaTime), 'effects');
  spawnAmbientEmitter(engine, sceneBounds);

  const editor = Editor.create(engine);
  applyCameraPreset(editor, sceneBounds);

  const ai = EngineAI.attach(engine);
  registerEditorCommands(ai.router, editor);

  engine.scheduler.removeSystemByLabel(Phase.RENDER, 'pbr-render');
  const rs = createRenderSystem(world, {
    renderer,
    registries: { meshes: engine.meshes, materials: engine.materials },
    getCamera: () => {
      const canvas = engine.canvas.element;
      const aspect = canvas.width / canvas.height;
      return {
        vp: editor.viewport.camera.getViewProjection(aspect),
        eye: editor.viewport.camera.getEye(),
      };
    },
    getLighting: () => engine.lighting,
    getSkinMatrices: (entityId) => animRegistries.jointBuffers.get(entityId),
    afterMainPass: (pass) => {
      const cameraAspect = engine.canvas.element.width / engine.canvas.element.height;
      const cameraVp = editor.viewport.camera.getViewProjection(cameraAspect);
      const buckets = effects.getBuckets();
      particleRenderer.render(pass, buckets.alpha, cameraVp, editor.viewport.camera.getRightVector(), editor.viewport.camera.getUpVector(), false);
      particleRenderer.render(pass, buckets.additive, cameraVp, editor.viewport.camera.getRightVector(), editor.viewport.camera.getUpVector(), true);
      editor.viewport.renderOverlays(pass);
    },
  });
  engine.scheduler.addSystem(Phase.RENDER, rs.render, 'editor-render');

  engine.start();

  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).editor = editor;
  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).engine = engine;
  (window as Window & { editor?: Editor; engine?: Engine; ai?: EngineAI }).ai = ai;
  (window as Window & { effects?: unknown }).effects = effects;
}

async function loadPreferredDemoScene(
  engine: Engine,
  device: GPUDevice,
  animRegistries: AnimationRegistries,
  foxUrl: string,
): Promise<SceneBounds> {
  if (userPackBaseUrl && userPackEntries.length > 0) {
    const packBounds = await loadConstructionPackDemo(engine, device);
    if (packBounds) return packBounds;
  }
  return loadFallbackAnimationDemo(engine, device, animRegistries, foxUrl);
}

async function loadConstructionPackDemo(
  engine: Engine,
  device: GPUDevice,
): Promise<SceneBounds | null> {
  engine.lighting = {
    direction: [-0.35, -0.9, -0.2],
    color: [1.0, 0.98, 0.95],
    intensity: 4.4,
    ambient: [0.03, 0.03, 0.04],
    envIntensity: 1.1,
  };

  const registry = getWorldRegistry(engine);
  const terrainSize = 140;
  const cellSize = 2;
  const originX = -terrainSize * 0.5;
  const originZ = -terrainSize * 0.5;

  const roadSpline: SplinePoint[] = [
    { position: [originX + 20, 0, originZ + 30] },
    { position: [originX + 50, 0, originZ + 25] },
    { position: [originX + 75, 0, originZ + 45] },
    { position: [originX + 90, 0, originZ + 70] },
    { position: [originX + 70, 0, originZ + 100] },
    { position: [originX + 40, 0, originZ + 95] },
    { position: [originX + 15, 0, originZ + 75] },
    { position: [originX + 20, 0, originZ + 50] },
  ];

  const terrainMat = engine.createMaterial({
    albedo: [0.28, 0.34, 0.22, 1],
    roughness: 0.92,
    metallic: 0,
  });

  const terrainResult = registry.spawnTerrain({
    seed: 42,
    width: 72,
    depth: 72,
    cellSize,
    originX,
    originZ,
    baseHeight: 0,
    heightScale: 14,
    materialHandle: terrainMat.handle,
    roadSpline,
    roadWidth: 6,
  });
  engine.setEntityLabel(terrainResult.entityId, 'Procedural Terrain');

  const splineResult = registry.spawnSpline(roadSpline, {
    closed: true,
    width: 5,
    kind: 1,
  });
  engine.setEntityLabel(splineResult.entityId, 'Road Spline');

  const aggregate = createBoundsAccumulator();
  let loadedScenes = 0;
  let layoutCursorX = 0;
  let layoutCursorZ = 0;
  let currentRowDepth = 0;
  const maxRowWidth = 180;
  const gridOriginX = originX + 25;
  const gridOriginZ = originZ + 25;

  for (const entry of userPackEntries) {
    const sceneUrl = buildPackAssetUrl(userPackBaseUrl!, entry.dir, entry.file);
    try {
      const loaded = await loadFbxScene(device, sceneUrl, engine, {
        groupLabel: humanizeAssetLabel(entry.dir, entry.file),
      });
      if (loaded.entityIds.length > 0) {
        loadedScenes++;
      }
      if (loaded.bounds) {
        const footprintWidth = Math.max(6, loaded.bounds.max[0] - loaded.bounds.min[0]);
        const footprintDepth = Math.max(6, loaded.bounds.max[2] - loaded.bounds.min[2]);
        const margin = Math.max(3, Math.min(footprintWidth, footprintDepth) * 0.25);

        if (layoutCursorX > 0 && layoutCursorX + footprintWidth > maxRowWidth) {
          layoutCursorX = 0;
          layoutCursorZ += currentRowDepth + margin;
          currentRowDepth = 0;
        }

        const slotCenterX = gridOriginX + layoutCursorX + footprintWidth * 0.5;
        const slotCenterZ = gridOriginZ + layoutCursorZ + footprintDepth * 0.5;
        const offsetX = slotCenterX - loaded.bounds.center[0];
        const offsetY = -loaded.bounds.min[1];
        const offsetZ = slotCenterZ - loaded.bounds.center[2];
        const rootEntityId = loaded.entityIds[0] ?? 0;
        applyEntityOffset(engine, rootEntityId, offsetX, offsetY, offsetZ);

        mergeBounds(aggregate, offsetBounds(loaded.bounds, offsetX, offsetY, offsetZ));
        layoutCursorX += footprintWidth + margin;
        currentRowDepth = Math.max(currentRowDepth, footprintDepth);
      }
    } catch (err) {
      console.warn('[EditorDemo] Failed to load user FBX asset', entry.file, err);
    }
  }

  const bounds = finalizeAggregateBounds(aggregate);
  if (loadedScenes === 0 || !bounds) {
    return null;
  }

  return bounds;
}

async function loadFallbackAnimationDemo(
  engine: Engine,
  device: GPUDevice,
  animRegistries: AnimationRegistries,
  foxUrl: string,
): Promise<SceneBounds> {
  engine.lighting = {
    direction: [-0.4, -0.7, -0.5],
    color: [1.0, 0.97, 0.9],
    intensity: 3.5,
    ambient: [0.02, 0.02, 0.03],
    envIntensity: 1.0,
  };

  const world = engine.world;
  const gltfScene = await loadGltf(foxUrl);
  const { skeletons, clips } = buildSkeletonsAndClips(gltfScene);
  for (let i = 0; i < skeletons.length; i++) animRegistries.skeletons.set(i, skeletons[i]!);
  for (let i = 0; i < clips.length; i++) animRegistries.clips.set(i, clips[i]!);

  const gltfMatHandles: number[] = [];
  for (const mat of gltfScene.materials) {
    const params: {
      albedo: [number, number, number, number];
      metallic: number;
      roughness: number;
      emissive: [number, number, number];
      albedoTexture?: GPUTexture;
      normalTexture?: GPUTexture;
      mrTexture?: GPUTexture;
    } = {
      albedo: mat.albedo,
      metallic: mat.metallic,
      roughness: mat.roughness,
      emissive: mat.emissive,
    };
    if (mat.albedoTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.albedoTextureIndex, true);
      if (tex) params.albedoTexture = tex;
    }
    if (mat.normalTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.normalTextureIndex, false);
      if (tex) params.normalTexture = tex;
    }
    if (mat.mrTextureIndex >= 0) {
      const tex = await loadEmbeddedTexture(device, gltfScene, mat.mrTextureIndex, false);
      if (tex) params.mrTexture = tex;
    }
    const { handle } = engine.createMaterial(params);
    gltfMatHandles.push(handle);
  }

  const gltfMeshHandles: number[][] = [];
  for (const primGroup of gltfScene.meshes) {
    const handles: number[] = [];
    for (const prim of primGroup) {
      const meshData: MeshData = {
        positions: prim.positions,
        normals: prim.normals,
        uvs: prim.uvs,
        tangents: prim.tangents,
        indices: prim.indices,
        joints: prim.joints,
        weights: prim.weights,
      };
      handles.push(engine.registerMesh(GPUMesh.create(device, meshData)));
    }
    gltfMeshHandles.push(handles);
  }

  const modelScale = 0.02;
  const nodeEntities = new Map<number, number>();
  for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
    const node = gltfScene.nodes[ni]!;
    const entity = world.spawn();
    nodeEntities.set(ni, entity.id);
    engine.setEntityLabel(entity.id, node.name.trim() || `Fox Node ${ni}`);

    const isRoot = gltfScene.rootNodes.includes(ni);
    const scaleMul = isRoot ? modelScale : 1;
    const [rotX, rotY, rotZ] = quaternionToEulerXYZ(node.rotation);

    entity.add(LocalTransform, {
      px: node.translation[0] * scaleMul,
      py: node.translation[1] * scaleMul,
      pz: node.translation[2] * scaleMul,
      rotX,
      rotY,
      rotZ,
      scaleX: node.scale[0] * scaleMul,
      scaleY: node.scale[1] * scaleMul,
      scaleZ: node.scale[2] * scaleMul,
    });
    entity.add(WorldMatrix, identityWorldMatrix());

    if (node.meshIndex >= 0 && gltfMeshHandles[node.meshIndex]?.length) {
      const prim = gltfScene.meshes[node.meshIndex]?.[0];
      if (prim) {
        entity.add(MeshRef, { handle: gltfMeshHandles[node.meshIndex]![0]! });
        entity.add(MaterialRef, {
          handle: gltfMatHandles[prim.materialIndex] ?? gltfMatHandles[0] ?? 1,
        });
        entity.add(Visible, { _tag: 1 });
      }
    }

    if (node.skinIndex >= 0) {
      entity.add(SkeletonRef, { handle: node.skinIndex });
      entity.add(AnimationPlayer, {
        clipHandle: clips.length > 1 ? 1 : 0,
        time: 0,
        speed: 1,
        flags: 3,
      });
    }
  }

  for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
    const node = gltfScene.nodes[ni]!;
    const parentId = nodeEntities.get(ni)!;
    for (const childIdx of node.children) {
      const childId = nodeEntities.get(childIdx);
      if (childId !== undefined) {
        world.addComponent(childId, Parent, { entity: parentId });
      }
    }
  }

  spawnGround(engine, 80, 0, 0, 0, {
    albedo: [0.15, 0.15, 0.17, 1],
    roughness: 0.25,
    metallic: 0.0,
  });

  const sphereHandle = engine.registerMesh(GPUMesh.create(device, createSphere(0.5, 32, 16)));
  const sphereMaterials = [
    { albedo: [0.95, 0.64, 0.54, 1] as [number, number, number, number], roughness: 0.1, metallic: 1.0 },
    { albedo: [0.1, 0.5, 0.9, 1] as [number, number, number, number], roughness: 0.7, metallic: 0.0 },
    { albedo: [0.9, 0.9, 0.2, 1] as [number, number, number, number], roughness: 0.3, metallic: 0.8 },
  ];
  for (let i = 0; i < sphereMaterials.length; i++) {
    const { handle } = engine.createMaterial(sphereMaterials[i]!);
    const e = world.spawn();
    e.add(LocalTransform, {
      px: -3 + i * 3,
      py: 0.5,
      pz: 4,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    e.add(WorldMatrix, identityWorldMatrix());
    e.add(MeshRef, { handle: sphereHandle });
    e.add(MaterialRef, { handle });
    e.add(Visible, { _tag: 1 });
    engine.setEntityLabel(e.id, ['Copper Sphere', 'Blue Sphere', 'Gold Sphere'][i] ?? `Sphere ${i + 1}`);
  }

  return {
    min: [-40, 0, -40],
    max: [40, 15, 40],
    center: [0, 2, 0],
    radius: 28,
  };
}

function spawnGround(
  engine: Engine,
  size: number,
  centerX: number,
  centerZ: number,
  y: number,
  material: {
    albedo: [number, number, number, number];
    roughness: number;
    metallic: number;
  },
): void {
  const groundHandle = engine.registerMesh(GPUMesh.create(engine.gpu.device, createPlane(size, size, 1, 1)));
  const { handle: groundMatHandle } = engine.createMaterial(material);
  const ground = engine.world.spawn();
  ground.add(LocalTransform, {
    px: centerX,
    py: y,
    pz: centerZ,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  });
  ground.add(WorldMatrix, identityWorldMatrix());
  ground.add(MeshRef, { handle: groundHandle });
  ground.add(MaterialRef, { handle: groundMatHandle });
  ground.add(Visible, { _tag: 1 });
  engine.setEntityLabel(ground.id, 'Ground Plane');
}

function spawnAmbientEmitter(engine: Engine, bounds: SceneBounds): void {
  const emitter = engine.world.spawn();
  emitter.add(LocalTransform, {
    px: bounds.center[0],
    py: Math.max(bounds.min[1] + 1.2, bounds.center[1] + 0.6),
    pz: bounds.center[2],
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  });
  emitter.add(WorldMatrix, identityWorldMatrix());
  emitter.add(ParticleEmitter, {
    rate: 8,
    lifetime: 3,
    speed: 0.4,
    spread: 0.22,
    size: Math.max(0.08, bounds.radius * 0.006),
    maxParticles: 256,
    colorR: 1,
    colorG: 0.76,
    colorB: 0.25,
    colorA: 0.35,
    flags: EmitterFlags.Playing | EmitterFlags.Looping | EmitterFlags.Additive,
    splineEntity: 0,
    terrainEntity: 0,
    biomeFilter: 0xffffffff,
  });
  engine.setEntityLabel(emitter.id, 'Ambient Sparks');
}

function applyEntityOffset(engine: Engine, entityId: number, dx: number, dy: number, dz: number): void {
  if (entityId === 0 || !engine.world.has(entityId) || !engine.world.hasComponent(entityId, LocalTransform)) {
    return;
  }
  engine.world.setField(entityId, LocalTransform, 'px', dx);
  engine.world.setField(entityId, LocalTransform, 'py', dy);
  engine.world.setField(entityId, LocalTransform, 'pz', dz);
}

function offsetBounds(bounds: SceneBounds, dx: number, dy: number, dz: number): SceneBounds {
  return {
    min: [bounds.min[0] + dx, bounds.min[1] + dy, bounds.min[2] + dz],
    max: [bounds.max[0] + dx, bounds.max[1] + dy, bounds.max[2] + dz],
    center: [bounds.center[0] + dx, bounds.center[1] + dy, bounds.center[2] + dz],
    radius: bounds.radius,
  };
}

function humanizeAssetLabel(dir: string, file: string): string {
  const source = dir.trim().length > 0 ? dir : file.replace(/\.[^./?]+$/, '');
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function playBootIntro(): Promise<void> {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
    zIndex: '999999',
  } satisfies Partial<CSSStyleDeclaration>);

  const video = document.createElement('video');
  video.src = BOOT_VIDEO_URL;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  Object.assign(video.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    background: '#000',
  } satisfies Partial<CSSStyleDeclaration>);

  overlay.appendChild(video);
  document.body.appendChild(overlay);

  await new Promise<void>((resolve) => {
    const finish = () => {
      video.pause();
      overlay.remove();
      resolve();
    };

    video.addEventListener('ended', finish, { once: true });
    video.addEventListener('error', finish, { once: true });

    void video.play().catch(() => finish());
  });
}

function applyCameraPreset(editor: Editor, bounds: SceneBounds): void {
  const targetY = Math.max(bounds.center[1] + 1.5, bounds.min[1] + 1.5);
  editor.viewport.camera.target = [bounds.center[0], targetY, bounds.center[2]];
  editor.viewport.camera.distance = Math.max(12, bounds.radius * 0.65);
  editor.viewport.camera.far = Math.max(5000, bounds.radius * 12);
  editor.viewport.camera.yaw = Math.PI * 0.82;
  editor.viewport.camera.pitch = -0.32;
}

function buildPackAssetUrl(baseUrl: string, ...segments: string[]): string {
  return `${baseUrl}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function createBoundsAccumulator() {
  return {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
}

function mergeBounds(
  aggregate: { min: [number, number, number]; max: [number, number, number] },
  bounds: SceneBounds,
): void {
  aggregate.min[0] = Math.min(aggregate.min[0], bounds.min[0]);
  aggregate.min[1] = Math.min(aggregate.min[1], bounds.min[1]);
  aggregate.min[2] = Math.min(aggregate.min[2], bounds.min[2]);
  aggregate.max[0] = Math.max(aggregate.max[0], bounds.max[0]);
  aggregate.max[1] = Math.max(aggregate.max[1], bounds.max[1]);
  aggregate.max[2] = Math.max(aggregate.max[2], bounds.max[2]);
}

function finalizeAggregateBounds(
  aggregate: { min: [number, number, number]; max: [number, number, number] },
): SceneBounds | null {
  if (!Number.isFinite(aggregate.min[0]) || !Number.isFinite(aggregate.max[0])) return null;
  const center: [number, number, number] = [
    (aggregate.min[0] + aggregate.max[0]) * 0.5,
    (aggregate.min[1] + aggregate.max[1]) * 0.5,
    (aggregate.min[2] + aggregate.max[2]) * 0.5,
  ];
  const dx = aggregate.max[0] - center[0];
  const dy = aggregate.max[1] - center[1];
  const dz = aggregate.max[2] - center[2];
  return {
    min: aggregate.min,
    max: aggregate.max,
    center,
    radius: Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz)),
  };
}

function quaternionToEulerXYZ(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const rotX = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const rotY = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const rotZ = Math.atan2(sinyCosp, cosyCosp);
  return [rotX, rotY, rotZ];
}

function identityWorldMatrix() {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

async function loadEmbeddedTexture(
  device: GPUDevice,
  scene: { textures?: Array<{ data: Uint8Array; mimeType: string }> },
  textureIndex: number,
  srgb: boolean,
): Promise<GPUTexture | null> {
  try {
    const texData = scene.textures?.[textureIndex];
    if (!texData || texData.data.length === 0) return null;
    const blob = new Blob([texData.data.buffer as ArrayBuffer], { type: texData.mimeType });
    const bitmap = await createImageBitmap(blob);
    const format: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    return texture;
  } catch (err) {
    console.warn('[EditorDemo] Failed to load embedded texture', textureIndex, err);
    return null;
  }
}

main().catch(console.error);

/**
 * Editor Demo — Phase 6 validation.
 *
 * Demonstrates the full editor UI on top of the real animated scene,
 * rather than a placeholder primitive-only setup.
 */

import { Engine } from '@engine/core';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, Parent, createTransformSystem,
} from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import { loadHDR, loadGltf, buildSkeletonsAndClips } from '@engine/assets';
import { createAnimationSystem, type AnimationRegistries } from '@engine/animation';
import {
  GPUMesh, createSphere, createPlane, createRenderSystem, type MeshData,
} from '@engine/renderer-webgpu';
import { EngineAI } from '@engine/ai';
import { Editor, registerEditorCommands } from '@engine/editor';

async function main() {
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
      shadow: { resolution: 2048, frustumSize: 40 },
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

  engine.lighting = {
    direction: [-0.4, -0.7, -0.5],
    color: [1.0, 0.97, 0.9],
    intensity: 3.5,
    ambient: [0.02, 0.02, 0.03],
    envIntensity: 1.0,
  };

  const gltfScene = await loadGltf(foxUrl);
  const { skeletons, clips } = buildSkeletonsAndClips(gltfScene);
  for (let i = 0; i < skeletons.length; i++) animRegistries.skeletons.set(i, skeletons[i]!);
  for (let i = 0; i < clips.length; i++) animRegistries.clips.set(i, clips[i]!);

  const gltfMatHandles: number[] = [];
  for (const mat of gltfScene.materials) {
    const params: any = {
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

  const MODEL_SCALE = 0.02;
  const nodeEntities = new Map<number, number>();
  for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
    const node = gltfScene.nodes[ni]!;
    const entity = world.spawn();
    nodeEntities.set(ni, entity.id);

    const isRoot = gltfScene.rootNodes.includes(ni);
    const scaleMul = isRoot ? MODEL_SCALE : 1;
    const t = node.translation;
    const s = node.scale;
    const rotY = Math.atan2(
      2 * (node.rotation[3] * node.rotation[1] + node.rotation[0] * node.rotation[2]),
      1 - 2 * (node.rotation[0] ** 2 + node.rotation[1] ** 2),
    );

    entity.add(LocalTransform, {
      px: t[0] * scaleMul,
      py: t[1] * scaleMul,
      pz: t[2] * scaleMul,
      rotY,
      scaleX: s[0] * scaleMul,
      scaleY: s[1] * scaleMul,
      scaleZ: s[2] * scaleMul,
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

  const groundHandle = engine.registerMesh(GPUMesh.create(device, createPlane(80, 80, 1, 1)));
  const { handle: groundMatHandle } = engine.createMaterial({
    albedo: [0.15, 0.15, 0.17, 1],
    roughness: 0.25,
    metallic: 0.0,
  });
  const ground = world.spawn();
  ground.add(LocalTransform, { px: 0, py: 0, pz: 0, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 });
  ground.add(WorldMatrix, identityWorldMatrix());
  ground.add(MeshRef, { handle: groundHandle });
  ground.add(MaterialRef, { handle: groundMatHandle });
  ground.add(Visible, { _tag: 1 });

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
      px: -3 + i * 3, py: 0.5, pz: 4, rotY: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    e.add(WorldMatrix, identityWorldMatrix());
    e.add(MeshRef, { handle: sphereHandle });
    e.add(MaterialRef, { handle });
    e.add(Visible, { _tag: 1 });
  }

  const editor = Editor.create(engine);
  editor.viewport.camera.target = [0, 1.2, 0];
  editor.viewport.camera.distance = 7.5;
  editor.viewport.camera.yaw = Math.PI * 0.8;
  editor.viewport.camera.pitch = -0.25;

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
    afterMainPass: (pass) => editor.viewport.renderOverlays(pass),
  });
  engine.scheduler.addSystem(Phase.RENDER, rs.render, 'editor-render');

  engine.start();

  (window as any).editor = editor;
  (window as any).engine = engine;
  (window as any).ai = ai;
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
  scene: any,
  textureIndex: number,
  srgb: boolean,
): Promise<GPUTexture | null> {
  try {
    const texData = scene.textures[textureIndex];
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

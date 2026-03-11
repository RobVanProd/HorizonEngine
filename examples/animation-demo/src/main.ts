/**
 * Animation Demo — Phase 5 validation.
 *
 * Demonstrates: Engine + ECS + PBR + glTF + skeletal animation + HDRI + Spatial Audio + AI API.
 */

import { Engine } from '@engine/core';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, AudioSource, AudioListener,
  Parent, createTransformSystem,
} from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import { loadHDR, loadGltf, buildSkeletonsAndClips } from '@engine/assets';
import { createAnimationSystem, type AnimationRegistries } from '@engine/animation';
import { AUDIO_FLAG_PLAYING, AUDIO_FLAG_LOOPING, AUDIO_FLAG_SPATIAL } from '@engine/audio';
import type { Skeleton, AnimationClip } from '@engine/animation';
import {
  GPUMesh, createSphere, createPlane,
  mat4Perspective, mat4LookAt, mat4Multiply,
  type SceneLighting, type MeshData,
} from '@engine/renderer-webgpu';
import { now } from '@engine/profiler';
import { EngineAI } from '@engine/ai';
import { DevTools } from '@engine/devtools';

async function main() {
  const errorBanner = document.getElementById('error-banner')!;

  try {
    // ─── Engine setup ──────────────────────────────────────────

    const engine = new Engine();

    let hdrData: { width: number; height: number; data: Float32Array } | undefined;
    try {
      console.log('[AnimDemo] Loading HDRI...');
      hdrData = await loadHDR('/environment.hdr');
      console.log(`[AnimDemo] HDRI: ${hdrData.width}x${hdrData.height}`);
    } catch (e) {
      console.warn('[AnimDemo] HDRI not found, using procedural sky', e);
    }

    await engine.initialize(
      {
        container: document.getElementById('app')!,
        renderer: 'pbr',
      },
      {
        environment: { sunDirection: [0.5, 0.8, 0.3], sunIntensity: 50.0, cubemapSize: 512, hdrData },
        shadow: { resolution: 2048, frustumSize: 40 },
      },
    );

    const device = engine.gpu.device;
    const renderer = engine.pbrRenderer;
    const world = engine.world;

    // ─── Animation registries ───────────────────────────────────

    const animRegistries: AnimationRegistries = {
      skeletons: new Map(),
      clips: new Map(),
      jointBuffers: new Map(),
    };

    // ─── Register ECS systems ───────────────────────────────────

    const transformSys = createTransformSystem(world);
    engine.scheduler.addSystem(Phase.TRANSFORM, () => transformSys.propagate(), 'transform');

    const animSys = createAnimationSystem(world, animRegistries);
    engine.scheduler.addSystem(Phase.ANIMATE, animSys.update, 'animation');

    // ─── Load glTF model ────────────────────────────────────────

    console.log('[AnimDemo] Loading Fox.glb...');
    const gltfScene = await loadGltf('/models/Fox.glb');
    console.log(`[AnimDemo] glTF: ${gltfScene.nodes.length} nodes, ${gltfScene.skins.length} skins, ${gltfScene.animations.length} animations`);

    const { skeletons, clips } = buildSkeletonsAndClips(gltfScene);
    for (let i = 0; i < skeletons.length; i++) {
      animRegistries.skeletons.set(i, skeletons[i]!);
      console.log(`[AnimDemo] Skeleton ${i}: ${skeletons[i]!.joints.length} joints`);
    }
    for (let i = 0; i < clips.length; i++) {
      animRegistries.clips.set(i, clips[i]!);
      console.log(`[AnimDemo] Clip ${i}: "${clips[i]!.name}" (${clips[i]!.duration.toFixed(2)}s, ${clips[i]!.channels.length} channels)`);
    }

    // Create GPU meshes from glTF
    const gltfMeshHandles: number[][] = [];
    const gltfMatHandles: number[] = [];

    // Materials
    for (const mat of gltfScene.materials) {
      const params: any = {
        albedo: mat.albedo,
        metallic: mat.metallic,
        roughness: mat.roughness,
        emissive: mat.emissive,
      };
      // Load embedded textures
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
        if (tex) params.metallicRoughnessTexture = tex;
      }

      const { handle } = engine.createMaterial(params);
      gltfMatHandles.push(handle);
    }

    // Meshes
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
        const gpuMesh = GPUMesh.create(device, meshData);
        handles.push(engine.registerMesh(gpuMesh));
      }
      gltfMeshHandles.push(handles);
    }

    // The Fox model is in centimeter scale (~115 units tall).
    // Scale it down so it's about 2.3 units tall.
    const MODEL_SCALE = 0.02;

    // Spawn entities from glTF nodes
    const nodeEntities = new Map<number, number>();

    for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
      const node = gltfScene.nodes[ni]!;
      const entity = world.spawn();
      nodeEntities.set(ni, entity.id);

      const t = node.translation;
      const s = node.scale;
      const [rotX, rotY, rotZ] = quaternionToEulerXYZ(node.rotation);

      // Apply model scale to root nodes (those with a mesh or skin)
      const isRoot = gltfScene.rootNodes.includes(ni);
      const sx = s[0] * (isRoot ? MODEL_SCALE : 1);
      const sy = s[1] * (isRoot ? MODEL_SCALE : 1);
      const sz = s[2] * (isRoot ? MODEL_SCALE : 1);

      entity.add(LocalTransform, {
        px: t[0] * (isRoot ? MODEL_SCALE : 1),
        py: t[1] * (isRoot ? MODEL_SCALE : 1),
        pz: t[2] * (isRoot ? MODEL_SCALE : 1),
        rotX,
        rotY,
        rotZ,
        scaleX: sx, scaleY: sy, scaleZ: sz,
      });
      entity.add(WorldMatrix, {
        m0: 1, m5: 1, m10: 1, m15: 1,
        m1: 0, m2: 0, m3: 0, m4: 0,
        m6: 0, m7: 0, m8: 0, m9: 0,
        m11: 0, m12: 0, m13: 0, m14: 0,
      });

      if (node.meshIndex >= 0 && gltfMeshHandles[node.meshIndex]) {
        const meshGroup = gltfMeshHandles[node.meshIndex]!;
        const prim = gltfScene.meshes[node.meshIndex]?.[0];
        if (meshGroup.length > 0 && prim) {
          world.addComponent(entity.id, MeshRef, { handle: meshGroup[0]! });
          world.addComponent(entity.id, MaterialRef, {
            handle: gltfMatHandles[prim.materialIndex] ?? gltfMatHandles[0] ?? 1,
          });
          world.addComponent(entity.id, Visible, { _tag: 1 });
        }
      }

      if (node.skinIndex >= 0) {
        world.addComponent(entity.id, SkeletonRef, { handle: node.skinIndex });
        // Use the first animation clip (Survey/Walk/Run)
        const defaultClip = clips.length > 1 ? 1 : 0; // prefer walk if available
        world.addComponent(entity.id, AnimationPlayer, {
          clipHandle: defaultClip,
          time: 0,
          speed: 1,
          flags: 3, // playing | looping
        });
      }
    }

    // Parent relationships
    for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
      const node = gltfScene.nodes[ni]!;
      const parentEid = nodeEntities.get(ni)!;
      for (const childIdx of node.children) {
        const childEid = nodeEntities.get(childIdx);
        if (childEid !== undefined) {
          world.addComponent(childEid, Parent, { entity: parentEid });
        }
      }
    }

    // ─── Ground plane ───────────────────────────────────────────

    const groundData = createPlane(80, 80, 1, 1);
    const groundMesh = GPUMesh.create(device, groundData);
    const groundHandle = engine.registerMesh(groundMesh);
    const { handle: groundMatHandle } = engine.createMaterial({
      albedo: [0.15, 0.15, 0.17, 1],
      roughness: 0.25,
      metallic: 0.0,
    });

    const ground = world.spawn();
    ground.add(LocalTransform, {
      px: 0, py: 0, pz: 0, rotX: 0, rotY: 0, rotZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    ground.add(WorldMatrix, {
      m0: 1, m5: 1, m10: 1, m15: 1,
      m1: 0, m2: 0, m3: 0, m4: 0,
      m6: 0, m7: 0, m8: 0, m9: 0,
      m11: 0, m12: 0, m13: 0, m14: 0,
    });
    ground.add(MeshRef, { handle: groundHandle });
    ground.add(MaterialRef, { handle: groundMatHandle });
    ground.add(Visible, { _tag: 1 });

    // ─── Static PBR reference spheres ───────────────────────────

    const sphereData = createSphere(0.5, 32, 16);
    const sphereMesh = GPUMesh.create(device, sphereData);
    const sphereMeshHandle = engine.registerMesh(sphereMesh);

    const sphereMaterials = [
      { albedo: [0.95, 0.64, 0.54, 1] as [number, number, number, number], roughness: 0.1, metallic: 1.0 },
      { albedo: [0.1, 0.5, 0.9, 1] as [number, number, number, number], roughness: 0.7, metallic: 0.0 },
      { albedo: [0.9, 0.9, 0.2, 1] as [number, number, number, number], roughness: 0.3, metallic: 0.8 },
    ];

    for (let i = 0; i < sphereMaterials.length; i++) {
      const sm = sphereMaterials[i]!;
      const { handle: matH } = engine.createMaterial(sm);
      const e = world.spawn();
      e.add(LocalTransform, {
        px: -3 + i * 3, py: 0.5, pz: 4, rotX: 0, rotY: 0, rotZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
      e.add(WorldMatrix, {
        m0: 1, m5: 1, m10: 1, m15: 1,
        m1: 0, m2: 0, m3: 0, m4: 0,
        m6: 0, m7: 0, m8: 0, m9: 0,
        m11: 0, m12: 0, m13: 0, m14: 0,
      });
      e.add(MeshRef, { handle: sphereMeshHandle });
      e.add(MaterialRef, { handle: matH });
      e.add(Visible, { _tag: 1 });
    }

    // ─── Lighting ───────────────────────────────────────────────

    engine.lighting = {
      direction: [-0.5, -0.8, -0.3],
      color: [1, 0.98, 0.92],
      intensity: 3.0,
      ambient: [0.01, 0.01, 0.02],
      envIntensity: 1.0,
    };

    // ─── Spatial audio ────────────────────────────────────────────

    // Synthesize a footstep sound (short percussive noise burst)
    function createFootstepBuffer(audioCtx: AudioContext): AudioBuffer {
      const rate = audioCtx.sampleRate;
      const len = Math.floor(rate * 0.08);
      const buf = audioCtx.createBuffer(1, len, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.6;
      }
      return buf;
    }

    // Synthesize ambient wind (filtered noise loop)
    function createAmbientBuffer(audioCtx: AudioContext): AudioBuffer {
      const rate = audioCtx.sampleRate;
      const len = Math.floor(rate * 4);
      const buf = audioCtx.createBuffer(1, len, rate);
      const data = buf.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const noise = Math.random() * 2 - 1;
        prev = prev * 0.98 + noise * 0.02;
        const fade = Math.min(i / (rate * 0.5), 1, (len - i) / (rate * 0.5));
        data[i] = prev * 0.15 * fade;
      }
      return buf;
    }

    const audioEngine = engine.audio;
    await audioEngine.resume();

    const footstepBuf = createFootstepBuffer(audioEngine.context);
    const footstepAudioHandle = audioEngine.registerBuffer(footstepBuf);
    const footstepClipHandle = engine.registerAudioClip(footstepAudioHandle);

    const ambientBuf = createAmbientBuffer(audioEngine.context);
    const ambientAudioHandle = audioEngine.registerBuffer(ambientBuf);
    const ambientClipHandle = engine.registerAudioClip(ambientAudioHandle);

    // Play ambient sound as non-spatial background loop
    audioEngine.play(ambientAudioHandle, { loop: true, volume: 0.3 });

    // Footstep system: plays a footstep sound periodically while animation is running
    let footstepTimer = 0;
    const FOOTSTEP_INTERVAL = 0.35;
    engine.scheduler.addSystem(Phase.AUDIO, (ctx) => {
      footstepTimer += ctx.deltaTime;
      if (footstepTimer >= FOOTSTEP_INTERVAL) {
        footstepTimer -= FOOTSTEP_INTERVAL;
        audioEngine.play(footstepAudioHandle, {
          volume: 0.2 + Math.random() * 0.1,
          playbackRate: 0.9 + Math.random() * 0.2,
          spatial: { position: [0, 0, 0], refDistance: 2, maxDistance: 30, rolloffFactor: 1 },
        });
      }
    }, 'footsteps', 10);

    // ─── AI API ─────────────────────────────────────────────────────

    const ai = EngineAI.attach(engine);

    // Expose AI API to browser console for interactive use
    (window as any).ai = ai;
    (window as any).engine = engine;

    console.log(
      '%c[AI API] Ready! Try: ai.execute({ action: "engine.status", params: {} })',
      'color: #4CAF50; font-weight: bold',
    );
    console.log(
      '%c[AI API] ' + ai.getSchemaListing(),
      'color: #2196F3',
    );

    // ─── DevTools ───────────────────────────────────────────────

    const devtools = DevTools.attach(engine);
    (window as any).devtools = devtools;

    // ─── Orbit camera with mouse controls ───────────────────────

    let orbitYaw = 0.5;
    let orbitPitch = 0.35;
    let orbitRadius = 6;
    const orbitTarget: [number, number, number] = [0, 1.0, 0];
    let currentVP: Float32Array = new Float32Array(16);
    let autoRotate = true;

    const canvasEl = engine.canvas.element;

    // Mouse drag to orbit
    let dragging = false;
    let lastMX = 0, lastMY = 0;

    canvasEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastMX = e.clientX;
      lastMY = e.clientY;
      autoRotate = false;
      canvasEl.setPointerCapture(e.pointerId);
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastMX;
      const dy = e.clientY - lastMY;
      lastMX = e.clientX;
      lastMY = e.clientY;
      orbitYaw -= dx * 0.005;
      orbitPitch = Math.max(0.05, Math.min(Math.PI * 0.45, orbitPitch + dy * 0.005));
    });
    canvasEl.addEventListener('pointerup', (e) => {
      dragging = false;
      canvasEl.releasePointerCapture(e.pointerId);
    });

    // Scroll to zoom
    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbitRadius = Math.max(2, Math.min(30, orbitRadius + e.deltaY * 0.01));
    }, { passive: false });

    // Camera update system
    engine.scheduler.addSystem(Phase.RENDER, (_ctx) => {
      if (autoRotate) orbitYaw += 0.003;

      const cx = Math.sin(orbitYaw) * Math.cos(orbitPitch) * orbitRadius;
      const cy = Math.sin(orbitPitch) * orbitRadius;
      const cz = Math.cos(orbitYaw) * Math.cos(orbitPitch) * orbitRadius;
      const eye: [number, number, number] = [
        orbitTarget[0] + cx,
        orbitTarget[1] + cy,
        orbitTarget[2] + cz,
      ];

      const canvas = engine.canvas.element;
      const aspect = canvas.width / canvas.height;
      const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 200);
      const view = mat4LookAt(eye, orbitTarget, [0, 1, 0]);
      currentVP = mat4Multiply(proj, view);

      engine.setCamera(currentVP, eye);
    }, 'camera-update', -10);

    // Replace the auto-registered render system with one that handles skinned draws
    engine.scheduler.removeSystemByLabel(Phase.RENDER, 'pbr-render');

    engine.scheduler.addSystem(Phase.RENDER, (_ctx) => {
      renderer.setCamera(currentVP, engine.cameraEye);
      renderer.setLighting(engine.lighting);
      renderer.beginFrame();

      // Query all renderable entities
      const query = world.query(WorldMatrix, MeshRef, MaterialRef, Visible);
      const mat = new Float32Array(16);

      query.each((arch, count) => {
        const meshHandles = arch.getColumn(MeshRef, 'handle');
        const matHandles = arch.getColumn(MaterialRef, 'handle');
        const hasSkelRef = arch.hasComponent(SkeletonRef);
        const entityIds = arch.entities.data as Uint32Array;

        const wmCols = [
          arch.getColumn(WorldMatrix, 'm0'), arch.getColumn(WorldMatrix, 'm1'),
          arch.getColumn(WorldMatrix, 'm2'), arch.getColumn(WorldMatrix, 'm3'),
          arch.getColumn(WorldMatrix, 'm4'), arch.getColumn(WorldMatrix, 'm5'),
          arch.getColumn(WorldMatrix, 'm6'), arch.getColumn(WorldMatrix, 'm7'),
          arch.getColumn(WorldMatrix, 'm8'), arch.getColumn(WorldMatrix, 'm9'),
          arch.getColumn(WorldMatrix, 'm10'), arch.getColumn(WorldMatrix, 'm11'),
          arch.getColumn(WorldMatrix, 'm12'), arch.getColumn(WorldMatrix, 'm13'),
          arch.getColumn(WorldMatrix, 'm14'), arch.getColumn(WorldMatrix, 'm15'),
        ];

        for (let i = 0; i < count; i++) {
          const mesh = engine.meshes.get(meshHandles[i]!);
          const material = engine.materials.get(matHandles[i]!);
          if (!mesh || !material) continue;

          for (let c = 0; c < 16; c++) mat[c] = wmCols[c]![i]!;

          if (hasSkelRef && mesh.skinned) {
            const eid = entityIds[i]!;
            const jointBuf = animRegistries.jointBuffers.get(eid);
            if (jointBuf) {
              renderer.drawSkinnedMesh(mesh, material, mat, jointBuf);
            } else {
              renderer.drawMesh(mesh, material, mat);
            }
          } else {
            renderer.drawMesh(mesh, material, mat);
          }
        }
      });

      renderer.endFrame();
    }, 'custom-render', 0);

    // ─── Stats overlay ──────────────────────────────────────────

    const statsEl = document.getElementById('stats')!;
    let lastStatsUpdate = 0;
    let frameCount = 0;

    engine.scheduler.addSystem(Phase.DIAGNOSTICS, (ctx) => {
      frameCount++;
      if (ctx.elapsedTime - lastStatsUpdate >= 0.5) {
        const fps = Math.round(frameCount / (ctx.elapsedTime - lastStatsUpdate));
        lastStatsUpdate = ctx.elapsedTime;
        frameCount = 0;

        const entities = world.entityCount;
        const skinned = animRegistries.jointBuffers.size;
        const clipName = clips.length > 0 ? clips[animRegistries.clips.has(1) ? 1 : 0]?.name ?? 'none' : 'none';

        statsEl.innerHTML = `
          <div class="row"><span class="label">FPS</span><span class="value">${fps}</span></div>
          <div class="row"><span class="label">Entities</span><span class="value">${entities}</span></div>
          <div class="row"><span class="label">Skinned</span><span class="value">${skinned}</span></div>
          <div class="row"><span class="label">Clip</span><span class="value">${clipName}</span></div>
          <div class="row"><span class="label">Joints</span><span class="value">${skeletons[0]?.joints.length ?? 0}</span></div>
          <div class="row"><span class="label">Audio</span><span class="value">${audioEngine.activeSoundCount} sounds</span></div>
          <div class="row"><span class="label">AI Cmds</span><span class="value">${ai.router.actionCount}</span></div>
          <div class="sep"></div>
          <div class="row"><span class="label">Phase</span><span class="value">5 — Audio + AI</span></div>
        `;
      }
    }, 'stats');

    // ─── Start ──────────────────────────────────────────────────

    console.log(`[AnimDemo] Scene ready: ${world.entityCount} entities`);
    engine.start();

  } catch (err: any) {
    console.error(err);
    errorBanner.style.display = 'block';
    errorBanner.innerHTML = `<h2>Error</h2><pre>${err.message}\n\n${err.stack ?? ''}</pre>`;
  }
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

async function loadEmbeddedTexture(
  device: GPUDevice,
  scene: any,
  textureIndex: number,
  srgb: boolean,
): Promise<GPUTexture | null> {
  try {
    const texData = scene.textures[textureIndex];
    if (!texData || texData.data.length === 0) return null;
    const blob = new Blob([texData.data], { type: texData.mimeType });
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
  } catch {
    return null;
  }
}

main();

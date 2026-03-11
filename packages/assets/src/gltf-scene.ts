/**
 * High-level glTF scene loader: parses a glTF/GLB, creates GPU resources,
 * and spawns ECS entities with all necessary components.
 */

import type { Engine } from '@engine/core';
import {
  LocalTransform, WorldMatrix, MeshRef, MaterialRef, Visible,
  SkeletonRef, AnimationPlayer, Parent, HierarchyDepth,
} from '@engine/ecs';
import type { Skeleton, AnimationClip, AnimationChannel } from '@engine/animation';
import type { GPUMesh, PBRMaterial, PBRMaterialParams, MeshData } from '@engine/renderer-webgpu';
import { loadGltf, type GltfScene, type GltfSkin, type GltfAnimation } from './gltf-loader.js';
import { loadTexture, createSolidColorTexture } from './texture-loader.js';

export interface LoadedGltfScene {
  meshHandles: number[];
  materialHandles: number[];
  skeletonHandles: number[];
  clipHandles: number[];
  entityIds: number[];
}

/**
 * Load a glTF file and spawn ECS entities.
 *
 * Returns handles to all loaded resources and entity IDs.
 */
export async function loadGltfScene(
  device: GPUDevice,
  url: string,
  engine: Engine,
): Promise<LoadedGltfScene> {
  const scene = await loadGltf(url);
  const renderer = engine.pbrRenderer;

  // --- Create GPU meshes ---
  const meshHandles: number[] = [];
  const gpuMeshes: GPUMesh[][] = [];

  for (const primGroup of scene.meshes) {
    const group: GPUMesh[] = [];
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
      // Dynamic import to avoid circular dependency
      const { GPUMesh: MeshClass } = await import('@engine/renderer-webgpu');
      const gpuMesh = MeshClass.create(device, meshData);
      const handle = engine.registerMesh(gpuMesh);
      meshHandles.push(handle);
      group.push(gpuMesh);
    }
    gpuMeshes.push(group);
  }

  // --- Create materials ---
  const materialHandles: number[] = [];
  const gpuMaterials: PBRMaterial[] = [];

  for (const mat of scene.materials) {
    const params: PBRMaterialParams = {
      albedo: mat.albedo,
      metallic: mat.metallic,
      roughness: mat.roughness,
      emissive: mat.emissive,
    };

    if (mat.albedoTextureIndex >= 0 && scene.textures[mat.albedoTextureIndex]) {
      const texData = scene.textures[mat.albedoTextureIndex]!;
      if (texData.data.length > 0) {
        const tex = await loadTextureFromBuffer(device, texData.data, texData.mimeType, true);
        if (tex) params.albedoTexture = tex;
      }
    }

    if (mat.normalTextureIndex >= 0 && scene.textures[mat.normalTextureIndex]) {
      const texData = scene.textures[mat.normalTextureIndex]!;
      if (texData.data.length > 0) {
        const tex = await loadTextureFromBuffer(device, texData.data, texData.mimeType, false);
        if (tex) params.normalTexture = tex;
      }
    }

    if (mat.mrTextureIndex >= 0 && scene.textures[mat.mrTextureIndex]) {
      const texData = scene.textures[mat.mrTextureIndex]!;
      if (texData.data.length > 0) {
        const tex = await loadTextureFromBuffer(device, texData.data, texData.mimeType, false);
        if (tex) params.mrTexture = tex;
      }
    }

    if (mat.emissiveTextureIndex >= 0 && scene.textures[mat.emissiveTextureIndex]) {
      const texData = scene.textures[mat.emissiveTextureIndex]!;
      if (texData.data.length > 0) {
        const tex = await loadTextureFromBuffer(device, texData.data, texData.mimeType, true);
        if (tex) params.emissiveTexture = tex;
      }
    }

    const { handle, material } = engine.createMaterial(params);
    materialHandles.push(handle);
    gpuMaterials.push(material);
  }

  // --- Build skeletons ---
  const skeletonHandles: number[] = [];
  const skeletonRegistry = new Map<number, number>(); // skinIndex -> handle

  for (let si = 0; si < scene.skins.length; si++) {
    buildSkeleton(scene.skins[si]!, scene);
    skeletonHandles.push(si);
    skeletonRegistry.set(si, si);
  }

  // --- Build animation clips ---
  const clipHandles: number[] = [];
  for (let ai = 0; ai < scene.animations.length; ai++) {
    clipHandles.push(ai);
  }

  // --- Spawn ECS entities from node tree ---
  const entityIds: number[] = [];
  const nodeEntityMap = new Map<number, number>();
  const world = engine.world;

  // First pass: create entities for all nodes
  for (let ni = 0; ni < scene.nodes.length; ni++) {
    const node = scene.nodes[ni]!;
    const entity = world.spawn();
    const eid = entity.id;
    nodeEntityMap.set(ni, eid);
    entityIds.push(eid);

    const t = node.translation;
    const s = node.scale;
    const [rotX, rotY, rotZ] = quaternionToEulerXYZ(node.rotation);

    entity.add(LocalTransform, {
      px: t[0], py: t[1], pz: t[2],
      rotX, rotY, rotZ,
      scaleX: s[0], scaleY: s[1], scaleZ: s[2],
    });
    entity.add(WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
  }

  // Second pass: set parent relationships
  for (let ni = 0; ni < scene.nodes.length; ni++) {
    const node = scene.nodes[ni]!;
    const parentEid = nodeEntityMap.get(ni)!;
    for (const childIdx of node.children) {
      const childEid = nodeEntityMap.get(childIdx);
      if (childEid !== undefined) {
        world.addComponent(childEid, Parent, { entity: parentEid });
        world.addComponent(childEid, HierarchyDepth, { depth: 1 });
      }
    }
  }

  // Third pass: attach mesh/material/skin/animation components
  let meshHandleIdx = 0;
  for (let ni = 0; ni < scene.nodes.length; ni++) {
    const node = scene.nodes[ni]!;
    const eid = nodeEntityMap.get(ni)!;

    if (node.meshIndex >= 0) {
      const primGroup = scene.meshes[node.meshIndex];
      if (primGroup && primGroup.length > 0) {
        const prim = primGroup[0]!;
        const primMeshHandle = meshHandles[meshHandleIdx] ?? meshHandles[0]!;
        const matHandle = materialHandles[prim.materialIndex] ?? materialHandles[0]!;

        world.addComponent(eid, MeshRef, { handle: primMeshHandle });
        world.addComponent(eid, MaterialRef, { handle: matHandle });
        world.addComponent(eid, Visible, { _tag: 1 });
      }
      // Advance the mesh handle index for all primitives in this group
      meshHandleIdx += (primGroup?.length ?? 0);
    }

    if (node.skinIndex >= 0) {
      world.addComponent(eid, SkeletonRef, { handle: node.skinIndex });

      if (scene.animations.length > 0) {
        world.addComponent(eid, AnimationPlayer, {
          clipHandle: 0,
          time: 0,
          speed: 1,
          flags: 3, // playing | looping
        });
      }
    }
  }

  return { meshHandles, materialHandles, skeletonHandles, clipHandles, entityIds };
}

// ─── Helpers ────────────────────────────────────────────────────

function buildSkeleton(skin: GltfSkin, scene: GltfScene): Skeleton {
  const jointCount = skin.jointNodeIndices.length;
  const joints: {
    name: string; parentIndex: number; inverseBindMatrix: Float32Array;
    restTranslation: [number, number, number];
    restRotation: [number, number, number, number];
    restScale: [number, number, number];
  }[] = [];

  const nodeToJoint = new Map<number, number>();
  for (let j = 0; j < jointCount; j++) {
    nodeToJoint.set(skin.jointNodeIndices[j]!, j);
  }

  for (let j = 0; j < jointCount; j++) {
    const nodeIdx = skin.jointNodeIndices[j]!;
    const node = scene.nodes[nodeIdx]!;

    let parentIndex = -1;
    for (let pni = 0; pni < scene.nodes.length; pni++) {
      if (scene.nodes[pni]!.children.includes(nodeIdx)) {
        const pj = nodeToJoint.get(pni);
        if (pj !== undefined) { parentIndex = pj; break; }
      }
    }

    const ibm = new Float32Array(16);
    ibm.set(skin.inverseBindMatrices.subarray(j * 16, j * 16 + 16));

    joints.push({
      name: node.name || `joint_${j}`,
      parentIndex,
      inverseBindMatrix: ibm,
      restTranslation: [node.translation[0], node.translation[1], node.translation[2]],
      restRotation: [node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]],
      restScale: [node.scale[0], node.scale[1], node.scale[2]],
    });
  }

  return { joints };
}

/**
 * Convert a glTF animation into engine AnimationClip.
 * Resolves node indices → joint indices using the skin's jointNodeIndices mapping.
 */
export function buildAnimationClip(
  anim: GltfAnimation,
  skin: GltfSkin,
): AnimationClip {
  const nodeToJoint = new Map<number, number>();
  for (let j = 0; j < skin.jointNodeIndices.length; j++) {
    nodeToJoint.set(skin.jointNodeIndices[j]!, j);
  }

  let duration = 0;
  const channels: AnimationChannel[] = [];

  for (const ch of anim.channels) {
    if (ch.path === 'weights') continue; // morph targets not yet supported
    const jointIndex = nodeToJoint.get(ch.targetNodeIndex);
    if (jointIndex === undefined) continue;

    const maxTime = ch.times[ch.times.length - 1] ?? 0;
    if (maxTime > duration) duration = maxTime;

    channels.push({
      jointIndex,
      path: ch.path as 'translation' | 'rotation' | 'scale',
      interpolation: ch.interpolation as 'LINEAR' | 'STEP' | 'CUBICSPLINE',
      times: ch.times,
      values: ch.values,
    });
  }

  return { name: anim.name, duration, channels };
}

/**
 * Builds both skeletons and clips from a GltfScene.
 */
export function buildSkeletonsAndClips(scene: GltfScene): {
  skeletons: Skeleton[];
  clips: AnimationClip[];
} {
  const skeletons: Skeleton[] = scene.skins.map(skin => buildSkeleton(skin, scene));
  const clips: AnimationClip[] = [];

  for (const anim of scene.animations) {
    if (scene.skins.length > 0) {
      clips.push(buildAnimationClip(anim, scene.skins[0]!));
    }
  }

  return { skeletons, clips };
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

async function loadTextureFromBuffer(
  device: GPUDevice,
  data: Uint8Array,
  mimeType: string,
  srgb: boolean,
): Promise<GPUTexture | null> {
  try {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
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

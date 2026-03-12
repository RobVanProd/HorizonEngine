import type { Engine } from '@engine/core';
import {
  HierarchyDepth,
  LocalTransform,
  MaterialRef,
  MeshRef,
  Parent,
  Visible,
  WorldMatrix,
} from '@engine/ecs';
import { GPUMesh, type MeshData, type PBRMaterialParams } from '@engine/renderer-webgpu';
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshPhongMaterial,
  Texture,
} from 'three';
import { loadTexture } from './texture-loader.js';

export interface SceneBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  radius: number;
}

export interface ProceduralTreePresetDefinition {
  id: ProceduralTreePresetId;
  label: string;
  presetName: string;
}

export interface ProceduralTreeSpawnOptions {
  preset?: ProceduralTreePresetId;
  label?: string;
  seed?: number;
  position?: [number, number, number];
  yaw?: number;
  scale?: number;
  barkTint?: number;
  leafTint?: number;
  leafAlphaCutoff?: number;
}

export interface SpawnedProceduralTree {
  rootEntityId: number;
  entityIds: number[];
  meshHandles: number[];
  materialHandles: number[];
  bounds: SceneBounds;
}

const PROCEDURAL_TREE_PRESETS: ProceduralTreePresetDefinition[] = [
  { id: 'oak-medium', label: 'EZ Tree Oak Medium', presetName: 'Oak Medium' },
  { id: 'oak-large', label: 'EZ Tree Oak Large', presetName: 'Oak Large' },
  { id: 'aspen-medium', label: 'EZ Tree Aspen Medium', presetName: 'Aspen Medium' },
  { id: 'aspen-large', label: 'EZ Tree Aspen Large', presetName: 'Aspen Large' },
  { id: 'ash-medium', label: 'EZ Tree Ash Medium', presetName: 'Ash Medium' },
  { id: 'pine-medium', label: 'EZ Tree Pine Medium', presetName: 'Pine Medium' },
  { id: 'pine-large', label: 'EZ Tree Pine Large', presetName: 'Pine Large' },
];

export type ProceduralTreePresetId =
  | 'oak-medium'
  | 'oak-large'
  | 'aspen-medium'
  | 'aspen-large'
  | 'ash-medium'
  | 'pine-medium'
  | 'pine-large';

export function listProceduralTreePresets(): ProceduralTreePresetDefinition[] {
  return [...PROCEDURAL_TREE_PRESETS];
}

export async function spawnProceduralTree(
  device: GPUDevice,
  engine: Engine,
  options: ProceduralTreeSpawnOptions = {},
): Promise<SpawnedProceduralTree> {
  const { Tree } = await import('@dgreenheck/ez-tree');
  const preset = getProceduralTreePreset(options.preset ?? 'oak-medium');
  const tree = new Tree();
  tree.loadPreset(preset.presetName);

  if (options.seed !== undefined) {
    tree.options.seed = options.seed;
  }
  if (options.barkTint !== undefined) {
    tree.options.bark.tint = options.barkTint;
  }
  if (options.leafTint !== undefined) {
    tree.options.leaves.tint = options.leafTint;
  }

  tree.generate();

  const branchMesh = tree.branchesMesh as Mesh;
  const leavesMesh = tree.leavesMesh as Mesh;
  const branchData = geometryToMeshData(branchMesh.geometry);
  const leafData = geometryToMeshData(leavesMesh.geometry);
  if (!branchData) {
    throw new Error(`Procedural tree preset "${preset.label}" did not generate branch geometry.`);
  }

  const meshHandles: number[] = [];
  const materialHandles: number[] = [];
  const entityIds: number[] = [];

  const branchGpuMesh = GPUMesh.create(device, branchData);
  const branchMeshHandle = engine.registerMesh(branchGpuMesh);
  meshHandles.push(branchMeshHandle);
  const branchMaterialHandle = await createMaterialHandle(
    device,
    engine,
    branchMesh.material as MeshPhongMaterial,
    0,
  );
  materialHandles.push(branchMaterialHandle);

  const position = options.position ?? [0, 0, 0];
  const scale = options.scale ?? 1;
  const yaw = options.yaw ?? 0;
  const label = options.label ?? preset.label;
  const rootEntityId = spawnRenderableEntity(engine, {
    meshHandle: branchMeshHandle,
    materialHandle: branchMaterialHandle,
    label,
    position,
    scale,
    yaw,
  });
  entityIds.push(rootEntityId);

  let bounds = scaleBounds(computeCombinedBounds([branchData, leafData].filter(Boolean) as MeshData[]), position, scale);

  if (leafData && leafData.indices.length > 0) {
    const leafGpuMesh = GPUMesh.create(device, leafData);
    const leafMeshHandle = engine.registerMesh(leafGpuMesh);
    meshHandles.push(leafMeshHandle);
    const leafMaterialHandle = await createMaterialHandle(
      device,
      engine,
      leavesMesh.material as MeshPhongMaterial,
      options.leafAlphaCutoff ?? 0.45,
    );
    materialHandles.push(leafMaterialHandle);

    const leafEntityId = engine.world.spawn().id;
    entityIds.push(leafEntityId);
    addTransform(engine, leafEntityId, [0, 0, 0], 0, 1);
    engine.world.addComponent(leafEntityId, Visible, { _tag: 1 });
    engine.world.addComponent(leafEntityId, MeshRef, { handle: leafMeshHandle });
    engine.world.addComponent(leafEntityId, MaterialRef, { handle: leafMaterialHandle });
    engine.world.addComponent(leafEntityId, Parent, { entity: rootEntityId });
    engine.world.addComponent(leafEntityId, HierarchyDepth, { depth: 1 });
    engine.setEntityLabel(leafEntityId, `${label} Leaves`);
  }

  return {
    rootEntityId,
    entityIds,
    meshHandles,
    materialHandles,
    bounds,
  };
}

function getProceduralTreePreset(id: ProceduralTreePresetId): ProceduralTreePresetDefinition {
  const preset = PROCEDURAL_TREE_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown procedural tree preset "${id}".`);
  }
  return preset;
}

function addTransform(
  engine: Engine,
  entityId: number,
  position: [number, number, number],
  yaw: number,
  scale: number,
): void {
  engine.world.addComponent(entityId, LocalTransform, {
    px: position[0],
    py: position[1],
    pz: position[2],
    rotX: 0,
    rotY: yaw,
    rotZ: 0,
    scaleX: scale,
    scaleY: scale,
    scaleZ: scale,
  });
  engine.world.addComponent(entityId, WorldMatrix, {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  });
}

function spawnRenderableEntity(
  engine: Engine,
  options: {
    meshHandle: number;
    materialHandle: number;
    label: string;
    position: [number, number, number];
    yaw: number;
    scale: number;
  },
): number {
  const entityId = engine.world.spawn().id;
  addTransform(engine, entityId, options.position, options.yaw, options.scale);
  engine.world.addComponent(entityId, Visible, { _tag: 1 });
  engine.world.addComponent(entityId, MeshRef, { handle: options.meshHandle });
  engine.world.addComponent(entityId, MaterialRef, { handle: options.materialHandle });
  engine.setEntityLabel(entityId, options.label);
  return entityId;
}

async function createMaterialHandle(
  device: GPUDevice,
  engine: Engine,
  material: MeshPhongMaterial,
  alphaCutoff: number,
): Promise<number> {
  const params: PBRMaterialParams = {
    albedo: colorToLinearRgba(material.color ?? null),
    roughness: 0.82,
    metallic: 0,
    alphaCutoff,
  };

  if (material.map) {
    params.albedoTexture = await loadTextureFromThreeTexture(device, material.map, true);
  }
  if (material.normalMap) {
    params.normalTexture = await loadTextureFromThreeTexture(device, material.normalMap, false);
  }

  return engine.createMaterial(params).handle;
}

async function loadTextureFromThreeTexture(
  device: GPUDevice,
  texture: Texture,
  sRGB: boolean,
): Promise<GPUTexture | undefined> {
  const externalImage = await resolveThreeTextureImage(texture);
  if (externalImage) {
    return createTextureFromExternalImage(device, externalImage, sRGB, texture.flipY);
  }
  const src = getThreeTextureSourceUrl(texture);
  if (!src) return undefined;
  return loadTexture(device, src, { sRGB, flipY: texture.flipY });
}

function getThreeTextureSourceUrl(texture: Texture): string | undefined {
  const image = texture.source?.data ?? texture.image;
  if (!image) return undefined;
  const currentSrc = (image as { currentSrc?: string }).currentSrc;
  if (typeof currentSrc === 'string' && currentSrc.length > 0) return currentSrc;
  const src = (image as { src?: string }).src;
  if (typeof src === 'string' && src.length > 0) return src;
  return undefined;
}

async function resolveThreeTextureImage(texture: Texture): Promise<GPUImageCopyExternalImageSource | null> {
  const image = texture.source?.data ?? texture.image;
  if (!image) return null;

  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return image;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image;
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    return image;
  }
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    return image;
  }
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    await waitForHtmlImage(image);
    return image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null;
  }

  return null;
}

function createTextureFromExternalImage(
  device: GPUDevice,
  image: GPUImageCopyExternalImageSource,
  sRGB: boolean,
  flipY: boolean,
): GPUTexture {
  const [width, height] = getExternalImageSize(image);
  const texture = device.createTexture({
    size: [width, height, 1],
    format: sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: image, flipY },
    { texture },
    [width, height],
  );

  return texture;
}

function getExternalImageSize(image: GPUImageCopyExternalImageSource): [number, number] {
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return [Math.max(1, image.naturalWidth || image.width), Math.max(1, image.naturalHeight || image.height)];
  }
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return [Math.max(1, image.width), Math.max(1, image.height)];
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    return [Math.max(1, image.width), Math.max(1, image.height)];
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return [Math.max(1, image.width), Math.max(1, image.height)];
  }
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    return [Math.max(1, image.width), Math.max(1, image.height)];
  }
  return [1, 1];
}

async function waitForHtmlImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoad = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`Failed to load procedural-tree texture "${image.currentSrc || image.src || 'unknown'}".`));
    };
    const cleanup = (): void => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
  }).catch(() => undefined);
}

function colorToLinearRgba(color: { r: number; g: number; b: number } | null): [number, number, number, number] {
  if (!color) return [1, 1, 1, 1];
  return [clamp01(color.r), clamp01(color.g), clamp01(color.b), 1];
}

function geometryToMeshData(geometry: BufferGeometry): MeshData | null {
  const geom = geometry.clone();
  const positionAttr = geom.getAttribute('position');
  if (!positionAttr) return null;

  if (!geom.getAttribute('normal')) {
    geom.computeVertexNormals();
  }

  const vertexCount = positionAttr.count;
  if (!geom.getAttribute('uv')) {
    geom.setAttribute('uv', new BufferAttribute(new Float32Array(vertexCount * 2), 2));
  }

  const normalAttr = geom.getAttribute('normal');
  const uvAttr = geom.getAttribute('uv');
  if (!normalAttr || !uvAttr) return null;

  if (geom.index && typeof geom.computeTangents === 'function') {
    try {
      geom.computeTangents();
    } catch {
      // Default tangents are good enough for foliage and bark fallback.
    }
  }

  const tangentAttr = geom.getAttribute('tangent');
  const indices = geom.index
    ? new Uint32Array(geom.index.array as ArrayLike<number>)
    : buildSequentialIndices(vertexCount);

  return {
    positions: copyFloatAttribute(positionAttr, 3),
    normals: copyFloatAttribute(normalAttr, 3),
    uvs: copyFloatAttribute(uvAttr, 2),
    tangents: tangentAttr ? copyFloatAttribute(tangentAttr, 4) : buildDefaultTangents(vertexCount),
    indices,
  };
}

function copyFloatAttribute(
  attribute: { count: number; array: ArrayLike<number> },
  itemSize: number,
): Float32Array {
  const count = attribute.count * itemSize;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = Number(attribute.array[i] ?? 0);
  }
  return out;
}

function buildSequentialIndices(vertexCount: number): Uint32Array {
  const out = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) out[i] = i;
  return out;
}

function buildDefaultTangents(vertexCount: number): Float32Array {
  const tangents = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    tangents[i * 4] = 1;
    tangents[i * 4 + 3] = 1;
  }
  return tangents;
}

function computeCombinedBounds(meshes: MeshData[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const mesh of meshes) {
    const positions = mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  const center: [number, number, number] = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];

  let radius = 0;
  for (const mesh of meshes) {
    const positions = mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i]! - center[0];
      const dy = positions[i + 1]! - center[1];
      const dz = positions[i + 2]! - center[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center,
    radius,
  };
}

function scaleBounds(bounds: SceneBounds, position: [number, number, number], scale: number): SceneBounds {
  const min: [number, number, number] = [
    bounds.min[0] * scale + position[0],
    bounds.min[1] * scale + position[1],
    bounds.min[2] * scale + position[2],
  ];
  const max: [number, number, number] = [
    bounds.max[0] * scale + position[0],
    bounds.max[1] * scale + position[1],
    bounds.max[2] * scale + position[2],
  ];
  const center: [number, number, number] = [
    bounds.center[0] * scale + position[0],
    bounds.center[1] * scale + position[1],
    bounds.center[2] * scale + position[2],
  ];
  return {
    min,
    max,
    center,
    radius: bounds.radius * Math.abs(scale),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

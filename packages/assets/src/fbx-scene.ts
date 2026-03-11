import type { Engine } from '@engine/core';
import {
  LocalTransform,
  WorldMatrix,
  MeshRef,
  MaterialRef,
  Visible,
  Parent,
  HierarchyDepth,
} from '@engine/ecs';
import { GPUMesh, type MeshData, type PBRMaterialParams } from '@engine/renderer-webgpu';
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { loadTexture } from './texture-loader.js';

export interface SceneBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  radius: number;
}

export interface LoadedFbxScene {
  meshHandles: number[];
  materialHandles: number[];
  entityIds: number[];
  bounds: SceneBounds | null;
}

export interface FbxSceneOptions {
  offset?: [number, number, number];
  parentEntityId?: number;
  groupLabel?: string;
}

export async function loadFbxScene(
  device: GPUDevice,
  url: string,
  engine: Engine,
  options: FbxSceneOptions = {},
): Promise<LoadedFbxScene> {
  const loader = new FBXLoader();
  const root = await loader.loadAsync(url);
  const world = engine.world;
  const offset = options.offset ?? [0, 0, 0];
  const meshHandles: number[] = [];
  const entityIds: number[] = [];
  const boundsState = createBoundsState();
  let parentEntityId = options.parentEntityId;

  root.updateWorldMatrix(true, true);
  const materialHandle = await createFbxMaterial(device, engine, url, root);

  if (parentEntityId === undefined) {
    const group = world.spawn();
    parentEntityId = group.id;
    group.add(LocalTransform, {
      px: 0,
      py: 0,
      pz: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    group.add(WorldMatrix, identityWorldMatrix());
    engine.setEntityLabel(group.id, options.groupLabel ?? deriveSceneLabel(url));
    entityIds.push(group.id);
  }

  root.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;

    const meshData = geometryToMeshData(object.geometry);
    if (!meshData) return;

    const meshHandle = engine.registerMesh(GPUMesh.create(device, meshData));
    meshHandles.push(meshHandle);

    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    object.matrixWorld.decompose(position, rotation, scale);
    position.x += offset[0];
    position.y += offset[1];
    position.z += offset[2];

    const euler = new Euler().setFromQuaternion(rotation, 'XYZ');
    const entity = world.spawn();
    entityIds.push(entity.id);

    entity.add(LocalTransform, {
      px: position.x,
      py: position.y,
      pz: position.z,
      rotX: euler.x,
      rotY: euler.y,
      rotZ: euler.z,
      scaleX: scale.x,
      scaleY: scale.y,
      scaleZ: scale.z,
    });
    entity.add(WorldMatrix, identityWorldMatrix());
    entity.add(MeshRef, { handle: meshHandle });
    entity.add(MaterialRef, { handle: materialHandle });
    entity.add(Visible, { _tag: 1 });
    entity.add(Parent, { entity: parentEntityId! });
    entity.add(HierarchyDepth, { depth: 1 });
    engine.setEntityLabel(entity.id, sanitizeObjectLabel(object.name, options.groupLabel));

    const worldBounds = computeWorldBounds(object.geometry, object.matrixWorld, offset);
    if (worldBounds) {
      expandBounds(boundsState, worldBounds.min);
      expandBounds(boundsState, worldBounds.max);
    }
  });

  return {
    meshHandles,
    materialHandles: [materialHandle],
    entityIds,
    bounds: finalizeBounds(boundsState),
  };
}

function deriveSceneLabel(url: string): string {
  const fileName = url.split('/').pop() ?? 'Scene';
  return fileName.replace(/\.[^./?]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Scene';
}

function sanitizeObjectLabel(name: string, fallback?: string): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) return trimmed;
  return fallback ? `${fallback} Part` : 'Mesh Part';
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
      // Fall back to a default tangent basis below.
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
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;
  return indices;
}

function buildDefaultTangents(vertexCount: number): Float32Array {
  const tangents = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    tangents[i * 4] = 1;
    tangents[i * 4 + 3] = 1;
  }
  return tangents;
}

async function createFbxMaterial(
  device: GPUDevice,
  engine: Engine,
  url: string,
  root: Object3D,
): Promise<number> {
  const sourceMaterial = findFirstMaterial(root);
  const params: PBRMaterialParams = {
    albedo: extractMaterialColor(sourceMaterial),
    metallic: extractMaterialMetallic(sourceMaterial),
    roughness: extractMaterialRoughness(sourceMaterial),
  };

  const albedoTexture = await loadFirstTexture(device, textureCandidates(url, 'albedo'), true);
  if (albedoTexture) params.albedoTexture = albedoTexture;

  const normalTexture = await loadFirstTexture(device, textureCandidates(url, 'normal'), false);
  if (normalTexture) params.normalTexture = normalTexture;

  const { handle } = engine.createMaterial(params);
  return handle;
}

function findFirstMaterial(root: Object3D): Material | null {
  let found: Material | null = null;
  root.traverse((object: Object3D) => {
    if (found || !(object instanceof Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (material) found = material;
  });
  return found;
}

function extractMaterialColor(material: Material | null): [number, number, number, number] {
  const fallback: [number, number, number, number] = [0.78, 0.78, 0.78, 1];
  if (!material) return fallback;
  const maybeColor = (material as Material & { color?: { r: number; g: number; b: number } }).color;
  if (!maybeColor) return fallback;
  return [maybeColor.r, maybeColor.g, maybeColor.b, 1];
}

function extractMaterialRoughness(material: Material | null): number {
  if (!material) return 0.88;
  const value = (material as Material & { roughness?: number }).roughness;
  return typeof value === 'number' ? value : 0.88;
}

function extractMaterialMetallic(material: Material | null): number {
  if (!material) return 0;
  const value = (material as Material & { metalness?: number }).metalness;
  return typeof value === 'number' ? value : 0;
}

type TextureKind = 'albedo' | 'normal';

function textureCandidates(url: string, kind: TextureKind): string[] {
  const base = url.replace(/\.[^./?]+$/, '');
  const suffixes = kind === 'albedo'
    ? ['_4K_BaseColor.jpg', '_4K_Albedo.jpg', '_BaseColor.jpg', '_Albedo.jpg', '_4K_BaseColor.png', '_4K_Albedo.png']
    : ['_4K_Normal.jpg', '_Normal.jpg', '_4K_Normal.png', '_Normal.png'];
  return suffixes.map((suffix) => `${base}${suffix}`);
}

async function loadFirstTexture(
  device: GPUDevice,
  candidates: string[],
  srgb: boolean,
): Promise<GPUTexture | null> {
  for (const candidate of candidates) {
    try {
      return await loadTexture(device, candidate, { sRGB: srgb });
    } catch {
      // Try the next naming variant.
    }
  }
  return null;
}

function computeWorldBounds(
  geometry: BufferGeometry,
  matrixWorld: Matrix4,
  offset: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } | null {
  const geom = geometry.clone();
  geom.computeBoundingBox();
  if (!geom.boundingBox) return null;

  const bounds = geom.boundingBox.clone();
  bounds.applyMatrix4(matrixWorld);
  bounds.min.x += offset[0];
  bounds.min.y += offset[1];
  bounds.min.z += offset[2];
  bounds.max.x += offset[0];
  bounds.max.y += offset[1];
  bounds.max.z += offset[2];

  return {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  };
}

function identityWorldMatrix() {
  return {
    m0: 1, m1: 0, m2: 0, m3: 0,
    m4: 0, m5: 1, m6: 0, m7: 0,
    m8: 0, m9: 0, m10: 1, m11: 0,
    m12: 0, m13: 0, m14: 0, m15: 1,
  };
}

function createBoundsState() {
  return {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
}

function expandBounds(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  point: [number, number, number],
): void {
  bounds.min[0] = Math.min(bounds.min[0], point[0]);
  bounds.min[1] = Math.min(bounds.min[1], point[1]);
  bounds.min[2] = Math.min(bounds.min[2], point[2]);
  bounds.max[0] = Math.max(bounds.max[0], point[0]);
  bounds.max[1] = Math.max(bounds.max[1], point[1]);
  bounds.max[2] = Math.max(bounds.max[2], point[2]);
}

function finalizeBounds(bounds: { min: [number, number, number]; max: [number, number, number] }): SceneBounds | null {
  if (!Number.isFinite(bounds.min[0]) || !Number.isFinite(bounds.max[0])) return null;
  const center: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
  const dx = bounds.max[0] - center[0];
  const dy = bounds.max[1] - center[1];
  const dz = bounds.max[2] - center[2];
  return {
    min: bounds.min,
    max: bounds.max,
    center,
    radius: Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz)),
  };
}

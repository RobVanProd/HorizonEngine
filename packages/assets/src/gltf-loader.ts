/**
 * glTF 2.0 loader. Parses .gltf (JSON) and .glb (binary) formats.
 * Extracts meshes, materials (PBR metallic-roughness), textures, and scene hierarchy.
 */

export interface GltfMeshPrimitive {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  tangents: Float32Array;
  indices: Uint32Array;
  materialIndex: number;
  /** Skinning joint indices — 4 per vertex (present when mesh is skinned). */
  joints?: Uint16Array;
  /** Skinning joint weights — 4 per vertex (present when mesh is skinned). */
  weights?: Float32Array;
}

export interface GltfMaterial {
  name: string;
  albedo: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  albedoTextureIndex: number;
  normalTextureIndex: number;
  mrTextureIndex: number;
  emissiveTextureIndex: number;
}

export interface GltfTexture {
  data: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface GltfNode {
  name: string;
  meshIndex: number;
  skinIndex: number;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  children: number[];
}

export interface GltfSkin {
  name: string;
  /** Node indices for each joint. */
  jointNodeIndices: number[];
  /** Flat Float32Array of 4x4 inverse bind matrices, one per joint. */
  inverseBindMatrices: Float32Array;
  skeletonRoot: number;
}

export interface GltfAnimationChannel {
  /** Index into GltfSkin.jointNodeIndices (resolved from node index). */
  targetNodeIndex: number;
  path: 'translation' | 'rotation' | 'scale' | 'weights';
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  times: Float32Array;
  values: Float32Array;
}

export interface GltfAnimation {
  name: string;
  channels: GltfAnimationChannel[];
}

export interface GltfScene {
  meshes: GltfMeshPrimitive[][];
  materials: GltfMaterial[];
  textures: GltfTexture[];
  nodes: GltfNode[];
  rootNodes: number[];
  skins: GltfSkin[];
  animations: GltfAnimation[];
}

const GLTF_MAGIC = 0x46546C67;
const JSON_CHUNK = 0x4E4F534A;
const BIN_CHUNK = 0x004E4942;

export async function loadGltf(url: string): Promise<GltfScene> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load glTF: ${url} (${response.status})`);

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);

  if (view.getUint32(0, true) === GLTF_MAGIC) {
    return parseGlb(buffer);
  }

  const text = new TextDecoder().decode(buffer);
  const json = JSON.parse(text);
  const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
  return parseGltfJson(json, baseUrl);
}

async function parseGltfJson(json: any, baseUrl: string): Promise<GltfScene> {
  // Load external buffers
  const buffers: ArrayBuffer[] = [];
  for (const bufDef of json.buffers ?? []) {
    if (bufDef.uri) {
      const resp = await fetch(baseUrl + bufDef.uri);
      buffers.push(await resp.arrayBuffer());
    }
  }

  return extractScene(json, buffers);
}

function parseGlb(buffer: ArrayBuffer): GltfScene {
  const view = new DataView(buffer);
  let offset = 12; // skip header

  let json: any = null;
  let binChunk: ArrayBuffer | null = null;

  while (offset < buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;

    if (chunkType === JSON_CHUNK) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, offset, chunkLength));
      json = JSON.parse(text);
    } else if (chunkType === BIN_CHUNK) {
      binChunk = buffer.slice(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!json) throw new Error('Invalid GLB: no JSON chunk');
  return extractScene(json, binChunk ? [binChunk] : []);
}

function extractScene(json: any, buffers: ArrayBuffer[]): GltfScene {
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];

  function getAccessorData(index: number): { data: ArrayBuffer; count: number; componentType: number; type: string } {
    const acc = accessors[index];
    const bv = bufferViews[acc.bufferView ?? 0];
    const buf = buffers[bv.buffer ?? 0];
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return {
      data: buf!.slice(byteOffset, byteOffset + bv.byteLength),
      count: acc.count,
      componentType: acc.componentType,
      type: acc.type,
    };
  }

  function toFloat32(acc: ReturnType<typeof getAccessorData>, components: number): Float32Array {
    if (acc.componentType === 5126) {
      return new Float32Array(acc.data, 0, acc.count * components);
    }
    const src = new Uint8Array(acc.data);
    const out = new Float32Array(acc.count * components);
    for (let i = 0; i < out.length; i++) out[i] = src[i]! / 255;
    return out;
  }

  function toUint16(acc: ReturnType<typeof getAccessorData>, components: number): Uint16Array {
    if (acc.componentType === 5123) {
      return new Uint16Array(acc.data, 0, acc.count * components);
    }
    if (acc.componentType === 5121) {
      const src = new Uint8Array(acc.data, 0, acc.count * components);
      const out = new Uint16Array(acc.count * components);
      for (let i = 0; i < out.length; i++) out[i] = src[i]!;
      return out;
    }
    if (acc.componentType === 5125) {
      const src = new Uint32Array(acc.data, 0, acc.count * components);
      const out = new Uint16Array(acc.count * components);
      for (let i = 0; i < out.length; i++) out[i] = src[i]!;
      return out;
    }
    return new Uint16Array(acc.count * components);
  }

  function toUint32Indices(acc: ReturnType<typeof getAccessorData>): Uint32Array {
    if (acc.componentType === 5125) return new Uint32Array(acc.data, 0, acc.count);
    if (acc.componentType === 5123) {
      const src = new Uint16Array(acc.data, 0, acc.count);
      const out = new Uint32Array(acc.count);
      for (let i = 0; i < acc.count; i++) out[i] = src[i]!;
      return out;
    }
    const src = new Uint8Array(acc.data, 0, acc.count);
    const out = new Uint32Array(acc.count);
    for (let i = 0; i < acc.count; i++) out[i] = src[i]!;
    return out;
  }

  // Parse meshes
  const meshes: GltfMeshPrimitive[][] = [];
  for (const meshDef of json.meshes ?? []) {
    const primitives: GltfMeshPrimitive[] = [];
    for (const prim of meshDef.primitives ?? []) {
      const attrs = prim.attributes;
      const posAcc = getAccessorData(attrs.POSITION);
      const positions = toFloat32(posAcc, 3);

      let normals: Float32Array;
      if (attrs.NORMAL !== undefined) {
        normals = toFloat32(getAccessorData(attrs.NORMAL), 3);
      } else {
        normals = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) normals[i + 1] = 1;
      }

      let uvs: Float32Array;
      if (attrs.TEXCOORD_0 !== undefined) {
        uvs = toFloat32(getAccessorData(attrs.TEXCOORD_0), 2);
      } else {
        uvs = new Float32Array((positions.length / 3) * 2);
      }

      let tangents: Float32Array;
      if (attrs.TANGENT !== undefined) {
        tangents = toFloat32(getAccessorData(attrs.TANGENT), 4);
      } else {
        tangents = new Float32Array((positions.length / 3) * 4);
        for (let i = 0; i < tangents.length; i += 4) {
          tangents[i] = 1;
          tangents[i + 3] = 1;
        }
      }

      let indices: Uint32Array;
      if (prim.indices !== undefined) {
        indices = toUint32Indices(getAccessorData(prim.indices));
      } else {
        indices = new Uint32Array(positions.length / 3);
        for (let i = 0; i < indices.length; i++) indices[i] = i;
      }

      let joints: Uint16Array | undefined;
      let weights: Float32Array | undefined;
      if (attrs.JOINTS_0 !== undefined && attrs.WEIGHTS_0 !== undefined) {
        const jointAcc = getAccessorData(attrs.JOINTS_0);
        joints = toUint16(jointAcc, 4);
        weights = toFloat32(getAccessorData(attrs.WEIGHTS_0), 4);
      }

      primitives.push({
        positions,
        normals,
        uvs,
        tangents,
        indices,
        materialIndex: prim.material ?? 0,
        joints,
        weights,
      });
    }
    meshes.push(primitives);
  }

  // Parse materials
  const materials: GltfMaterial[] = [];
  for (const matDef of json.materials ?? []) {
    const pbr = matDef.pbrMetallicRoughness ?? {};
    const bc = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const emissive = matDef.emissiveFactor ?? [0, 0, 0];

    materials.push({
      name: matDef.name ?? 'Unnamed',
      albedo: [bc[0], bc[1], bc[2], bc[3]],
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      emissive: [emissive[0], emissive[1], emissive[2]],
      albedoTextureIndex: pbr.baseColorTexture?.index ?? -1,
      normalTextureIndex: matDef.normalTexture?.index ?? -1,
      mrTextureIndex: pbr.metallicRoughnessTexture?.index ?? -1,
      emissiveTextureIndex: matDef.emissiveTexture?.index ?? -1,
    });
  }

  if (materials.length === 0) {
    materials.push({
      name: 'Default',
      albedo: [0.8, 0.8, 0.8, 1],
      metallic: 0,
      roughness: 0.5,
      emissive: [0, 0, 0],
      albedoTextureIndex: -1,
      normalTextureIndex: -1,
      mrTextureIndex: -1,
      emissiveTextureIndex: -1,
    });
  }

  // Parse textures (embedded only for now)
  const textures: GltfTexture[] = [];
  for (const texDef of json.textures ?? []) {
    const imgDef = (json.images ?? [])[texDef.source ?? 0];
    if (imgDef && imgDef.bufferView !== undefined) {
      const bv = bufferViews[imgDef.bufferView];
      const buf = buffers[bv.buffer ?? 0]!;
      const data = new Uint8Array(buf, bv.byteOffset ?? 0, bv.byteLength);
      textures.push({ data: new Uint8Array(data), mimeType: imgDef.mimeType ?? 'image/png' });
    } else if (imgDef && imgDef.uri) {
      textures.push({ data: new Uint8Array(0), mimeType: imgDef.mimeType ?? 'image/png' });
    }
  }

  // Parse nodes
  const nodes: GltfNode[] = [];
  for (const nodeDef of json.nodes ?? []) {
    nodes.push({
      name: nodeDef.name ?? '',
      meshIndex: nodeDef.mesh ?? -1,
      skinIndex: nodeDef.skin ?? -1,
      translation: nodeDef.translation ?? [0, 0, 0],
      rotation: nodeDef.rotation ?? [0, 0, 0, 1],
      scale: nodeDef.scale ?? [1, 1, 1],
      children: nodeDef.children ?? [],
    });
  }

  // Parse skins
  const skins: GltfSkin[] = [];
  for (const skinDef of json.skins ?? []) {
    const jointNodeIndices: number[] = skinDef.joints ?? [];
    let ibm: Float32Array;
    if (skinDef.inverseBindMatrices !== undefined) {
      const acc = getAccessorData(skinDef.inverseBindMatrices);
      ibm = new Float32Array(acc.data, 0, acc.count * 16);
    } else {
      ibm = new Float32Array(jointNodeIndices.length * 16);
      for (let j = 0; j < jointNodeIndices.length; j++) {
        ibm[j * 16 + 0] = 1; ibm[j * 16 + 5] = 1;
        ibm[j * 16 + 10] = 1; ibm[j * 16 + 15] = 1;
      }
    }
    skins.push({
      name: skinDef.name ?? '',
      jointNodeIndices,
      inverseBindMatrices: ibm,
      skeletonRoot: skinDef.skeleton ?? -1,
    });
  }

  // Parse animations
  const animations: GltfAnimation[] = [];
  for (const animDef of json.animations ?? []) {
    const samplers = animDef.samplers ?? [];
    const channels: GltfAnimationChannel[] = [];

    for (const chDef of animDef.channels ?? []) {
      const targetNode = chDef.target?.node;
      const path = chDef.target?.path;
      if (targetNode === undefined || !path) continue;

      const sampler = samplers[chDef.sampler ?? 0];
      if (!sampler) continue;

      const inputAcc = getAccessorData(sampler.input);
      const outputAcc = getAccessorData(sampler.output);
      const times = new Float32Array(inputAcc.data, 0, inputAcc.count);
      const valComponents = path === 'rotation' ? 4 : path === 'scale' || path === 'translation' ? 3 : 1;
      const values = toFloat32(outputAcc, valComponents);

      channels.push({
        targetNodeIndex: targetNode,
        path,
        interpolation: (sampler.interpolation ?? 'LINEAR') as 'LINEAR' | 'STEP' | 'CUBICSPLINE',
        times,
        values,
      });
    }

    animations.push({ name: animDef.name ?? '', channels });
  }

  const sceneDef = (json.scenes ?? [])[json.scene ?? 0] ?? { nodes: [] };
  const rootNodes: number[] = sceneDef.nodes ?? [];

  return { meshes, materials, textures, nodes, rootNodes, skins, animations };
}

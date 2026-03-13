import { Engine } from '@engine/core';
import { AnimationPlayer, HierarchyDepth, LocalTransform, MaterialRef, MeshRef, Parent, SkeletonRef, Visible, WorldMatrix, createTransformSystem, } from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import { buildSkeletonsAndClips, loadFbxScene, loadGltf, loadGltfScene, loadHDR, loadTexture, } from '@engine/assets';
import { createAnimationSystem } from '@engine/animation';
import { GPUMesh, createPlane, createRenderSystem, createSphere, } from '@engine/renderer-webgpu';
import { EmitterFlags, ParticleEmitter, ParticleRenderer, getEffectsRuntime } from '@engine/effects';
import { EngineAI } from '@engine/ai';
import { Editor, registerEditorCommands } from '@engine/editor';
import { BiomeId, generateScatterInstances, getWorldRegistry, OccupancyMap, sampleHeightWorld } from '@engine/world';
import { userPackBaseUrl, userPackEntries } from 'virtual:user-pack-manifest';
import { naturePackBaseUrl, naturePackEntries } from 'virtual:nature-pack-manifest';
import { GameDemo, createGameHud } from './game-demo.js';
const BOOT_VIDEO_URL = new URL('../../../horizon_loader_blender.mp4', import.meta.url).href;
async function main() {
    await playBootIntro();
    const engine = new Engine();
    const hdrUrl = new URL('../../animation-demo/public/environment.hdr', import.meta.url).href;
    const foxUrl = new URL('../../animation-demo/public/models/Fox.glb', import.meta.url).href;
    let hdrData;
    try {
        hdrData = await loadHDR(hdrUrl);
    }
    catch (err) {
        console.warn('[EditorDemo] Failed to load HDRI, falling back to procedural sky', err);
    }
    await engine.initialize({ renderer: 'pbr' }, {
        environment: { sunDirection: [0.5, 0.8, 0.3], sunIntensity: 50.0, cubemapSize: 512, hdrData },
        shadow: { resolution: 2048, frustumSize: 80 },
    });
    const world = engine.world;
    const device = engine.gpu.device;
    const renderer = engine.pbrRenderer;
    renderer.enableProfiling();
    const animRegistries = {
        skeletons: new Map(),
        clips: new Map(),
        jointBuffers: new Map(),
    };
    const transformSys = createTransformSystem(world);
    engine.scheduler.addSystem(Phase.TRANSFORM, () => transformSys.propagate(), 'transform');
    const animSys = createAnimationSystem(world, animRegistries);
    engine.scheduler.addSystem(Phase.ANIMATE, animSys.update, 'animation');
    const { bounds: sceneBounds } = await loadPreferredDemoScene(engine, device, animRegistries, foxUrl);
    const effects = getEffectsRuntime(engine);
    const particleRenderer = new ParticleRenderer(device, engine.gpu.format);
    engine.scheduler.addSystem(Phase.SIMULATE, (ctx) => effects.update(ctx.deltaTime), 'effects');
    spawnAmbientEmitter(engine, sceneBounds);
    const editor = Editor.create(engine);
    applyCameraPreset(editor, sceneBounds);
    const registry = getWorldRegistry(engine);
    editor.viewport.camera.setPlayModeGroundSampler((x, z) => registry.sampleGroundHeight(x, z));
    const gameDemo = new GameDemo(engine);
    gameDemo.spawn({
        bounds: sceneBounds,
        groundSampler: (x, z) => registry.sampleGroundHeight(x, z),
    });
    const gameHud = createGameHud();
    editor.layout.viewport.appendChild(gameHud.root);
    let wasPlayMode = false;
    engine.scheduler.addSystem(Phase.SIMULATE, () => {
        const playMode = editor.viewport.playMode;
        if (playMode) {
            if (!wasPlayMode)
                gameHud.show();
            const eye = editor.viewport.camera.getEye();
            const state = gameDemo.update(eye);
            gameHud.update(state);
        }
        else {
            if (wasPlayMode)
                gameHud.hide();
        }
        wasPlayMode = playMode;
    }, 'game-demo');
    const ai = EngineAI.attach(engine);
    registerEditorCommands(ai.router, editor);
    engine.scheduler.removeSystemByLabel(Phase.RENDER, 'pbr-render');
    const rs = createRenderSystem(world, {
        renderer,
        registries: { meshes: engine.meshes, materials: engine.materials, waterMaterials: engine.waterMaterials },
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
    window.editor = editor;
    window.engine = engine;
    window.ai = ai;
    window.effects = effects;
}
async function loadPreferredDemoScene(engine, device, animRegistries, foxUrl) {
    if (naturePackBaseUrl && naturePackEntries.length > 0) {
        const packBounds = await loadNaturePackDemo(engine, device);
        if (packBounds)
            return { bounds: packBounds };
    }
    if (userPackBaseUrl && userPackEntries.length > 0) {
        const packBounds = await loadConstructionPackDemo(engine, device);
        if (packBounds)
            return { bounds: packBounds };
    }
    const bounds = await loadFallbackAnimationDemo(engine, device, animRegistries, foxUrl);
    return { bounds };
}
/** Curated nature models with biome-specific, height-band, and slope-aware placement. */
const NATURE_SCATTER_ASSETS = [
    // Trees: Forest + Plains (grassland), relaxed slope for rolling terrain
    { file: 'CommonTree_1.gltf', density: 0.08, minScale: 0.85, maxScale: 1.35, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.8, maxSlope: 0.12, occupationRadiusPixels: 6 },
    { file: 'CommonTree_2.gltf', density: 0.06, minScale: 0.9, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.8, maxSlope: 0.12, occupationRadiusPixels: 6 },
    { file: 'Pine_1.gltf', density: 0.07, minScale: 0.8, maxScale: 1.25, allowedBiomes: [BiomeId.Forest, BiomeId.Plains, BiomeId.Alpine], minNormalizedHeight: 0.15, maxNormalizedHeight: 0.9, maxSlope: 0.14, occupationRadiusPixels: 6 },
    { file: 'Pine_2.gltf', density: 0.05, minScale: 0.85, maxScale: 1.15, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.75, maxSlope: 0.12, occupationRadiusPixels: 6 },
    { file: 'TwistedTree_1.gltf', density: 0.04, minScale: 0.9, maxScale: 1.1, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.1, maxNormalizedHeight: 0.7, maxSlope: 0.1, occupationRadiusPixels: 5 },
    { file: 'CommonTree_3.gltf', density: 0.05, minScale: 0.85, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Plains], minNormalizedHeight: 0.12, maxNormalizedHeight: 0.75, maxSlope: 0.12, occupationRadiusPixels: 6 },
    { file: 'Pine_3.gltf', density: 0.04, minScale: 0.8, maxScale: 1.2, allowedBiomes: [BiomeId.Forest, BiomeId.Alpine], minNormalizedHeight: 0.2, maxNormalizedHeight: 0.9, maxSlope: 0.15, occupationRadiusPixels: 5 },
    // Rocks: higher elevation, rocky/snowy
    { file: 'Rock_Medium_1.gltf', density: 0.02, minScale: 0.6, maxScale: 1.4, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.55, maxNormalizedHeight: 0.95, maxSlope: 0.4, occupationRadiusPixels: 4 },
    { file: 'Rock_Medium_2.gltf', density: 0.015, minScale: 0.5, maxScale: 1.2, allowedBiomes: [BiomeId.Alpine], minNormalizedHeight: 0.5, maxNormalizedHeight: 0.9, maxSlope: 0.45, occupationRadiusPixels: 4 },
    // Bushes: plains, low elevation, above water
    { file: 'Bush_Common.gltf', density: 0.03, minScale: 0.7, maxScale: 1.2, allowedBiomes: [BiomeId.Plains], minNormalizedHeight: 0.08, maxNormalizedHeight: 0.4, maxSlope: 0.05, occupationRadiusPixels: 3 },
    { file: 'Plant_1_Big.gltf', density: 0.025, minScale: 0.6, maxScale: 1.0, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.06, maxNormalizedHeight: 0.5, maxSlope: 0.06, occupationRadiusPixels: 2 },
    { file: 'Fern_1.gltf', density: 0.04, minScale: 0.5, maxScale: 1.1, allowedBiomes: [BiomeId.Forest], minNormalizedHeight: 0.1, maxNormalizedHeight: 0.6, maxSlope: 0.08, noiseScale: 0.2, noiseThreshold: 0.4, noiseSeedOffset: 100 },
    // Grass: organic clumping via noise
    { file: 'Grass_Common_Tall.gltf', density: 0.25, minScale: 0.4, maxScale: 0.9, allowedBiomes: [BiomeId.Plains, BiomeId.Forest], minNormalizedHeight: 0.05, maxNormalizedHeight: 0.7, maxSlope: 0.1, noiseScale: 0.15, noiseThreshold: 0.35, noiseSeedOffset: 200 },
];
async function loadNaturePackDemo(engine, device) {
    engine.lighting = {
        direction: [-0.28, -0.92, -0.24],
    color: [1.0, 0.985, 0.96],
    intensity: 4.9,
    ambient: [0.03, 0.04, 0.045],
    envIntensity: 1.05,
    shadowBias: 0.0024,
    shadowNormalBias: 0.0012,
    exposure: 0.98,
    fog: {
      color: [0.78, 0.86, 0.93],
      density: 0.0095,
      heightFalloff: 0.065,
      startDistance: 24,
      maxOpacity: 0.22,
    },
  };
    const registry = getWorldRegistry(engine);
    const terrainSize = 200;
    const cellSize = 2;
    const originX = -terrainSize * 0.5;
    const originZ = -terrainSize * 0.5;
    const PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/aerial_grass_rock';
    let terrainMat;
    try {
        const [albedoTex, normalTex, roughTex] = await Promise.all([
            loadTexture(device, `${PH}/aerial_grass_rock_diff_2k.jpg`, { sRGB: true }),
            loadTexture(device, `${PH}/aerial_grass_rock_nor_gl_2k.jpg`),
            loadTexture(device, `${PH}/aerial_grass_rock_rough_2k.jpg`),
        ]);
        terrainMat = engine.createMaterial({
            albedo: [0.9, 0.9, 0.9, 1],
            roughness: 0.92,
            metallic: 0,
            albedoTexture: albedoTex,
            normalTexture: normalTex,
            mrTexture: roughTex,
        });
    }
    catch (err) {
        console.warn('[EditorDemo] Terrain textures failed, using flat material', err);
        terrainMat = engine.createMaterial({
            albedo: [0.22, 0.28, 0.18, 1],
            roughness: 0.92,
            metallic: 0,
        });
    }
    const terrainResult = registry.spawnTerrain({
        seed: 12345,
        width: 100,
        depth: 100,
        cellSize,
        originX,
        originZ,
        baseHeight: 0,
        heightScale: 16,
        materialHandle: terrainMat.handle,
        waterThreshold: 0.1,
        uvScale: 8,
        uvOffset: [0.37, 0.61],
        uvRotation: 0.4,
    });
    engine.setEntityLabel(terrainResult.entityId, 'Nature Terrain');
    const terrainRec = registry.terrains.get(terrainResult.entityId);
    if (!terrainRec)
        return null;
    const heightfield = terrainRec.heightfield;
    const occupancy = new OccupancyMap(heightfield.width, heightfield.depth);
    const aggregate = createBoundsAccumulator();
    mergeBounds(aggregate, {
        min: [originX, heightfield.minHeight, originZ],
        max: [originX + 100 * cellSize, heightfield.maxHeight, originZ + 100 * cellSize],
        center: [originX + 50 * cellSize, (heightfield.minHeight + heightfield.maxHeight) * 0.5, originZ + 50 * cellSize],
        radius: Math.hypot(50 * cellSize, 50 * cellSize),
    });
    const availableFiles = new Set(naturePackEntries.map((e) => e.file));
    let placedCount = 0;
    for (const asset of NATURE_SCATTER_ASSETS) {
        if (!availableFiles.has(asset.file))
            continue;
        const sceneUrl = `${naturePackBaseUrl}/${encodeURIComponent(asset.file)}`;
        let loaded;
        try {
            loaded = await loadGltfScene(device, sceneUrl, engine);
        }
        catch (err) {
            console.warn('[EditorDemo] Failed to load nature asset', asset.file, err);
            continue;
        }
        const rootId = loaded.entityIds[0];
        if (rootId === undefined)
            continue;
        const instances = generateScatterInstances(heightfield, {
            seed: hashSeed(asset.file),
            density: asset.density,
            minScale: asset.minScale,
            maxScale: asset.maxScale,
            allowedBiomes: asset.allowedBiomes,
            minNormalizedHeight: asset.minNormalizedHeight,
            maxNormalizedHeight: asset.maxNormalizedHeight,
            minSlope: asset.minSlope,
            maxSlope: asset.maxSlope,
            occupancy,
            occupationRadiusPixels: asset.occupationRadiusPixels,
            noiseScale: asset.noiseScale,
            noiseThreshold: asset.noiseThreshold,
            noiseSeedOffset: asset.noiseSeedOffset,
        });
        for (const inst of instances) {
            cloneEntityHierarchy(engine, rootId, inst.position[0], inst.position[1], inst.position[2], inst.scale, inst.rotationY);
            placedCount++;
        }
        destroyEntityHierarchy(engine, rootId);
    }
    if (placedCount === 0)
        return null;
    const bounds = finalizeAggregateBounds(aggregate);
    return bounds;
}
function hashSeed(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h >>> 0;
}
function getChildren(world, parentId) {
    const children = [];
    world.query(Parent).each((arch, count) => {
        const parentCol = arch.getColumn(Parent, 'entity');
        const ids = arch.entities.data;
        for (let i = 0; i < count; i++) {
            if (parentCol[i] === parentId)
                children.push(ids[i]);
        }
    });
    return children;
}
function cloneEntityHierarchy(engine, rootId, offsetX, offsetY, offsetZ, scale, rotationY) {
    const world = engine.world;
    const copyComp = (src, dst, comp) => {
        if (!world.hasComponent(src, comp))
            return;
        world.addComponent(dst, comp);
        for (const field of comp.fieldNames) {
            world.setField(dst, comp, field, world.getField(src, comp, field));
        }
    };
    function cloneRecursive(srcId, newParentId, isRoot) {
        const dst = world.spawn().id;
        copyComp(srcId, dst, LocalTransform);
        copyComp(srcId, dst, WorldMatrix);
        copyComp(srcId, dst, MeshRef);
        copyComp(srcId, dst, MaterialRef);
        copyComp(srcId, dst, Visible);
        if (isRoot) {
            world.setField(dst, LocalTransform, 'px', offsetX);
            world.setField(dst, LocalTransform, 'py', offsetY);
            world.setField(dst, LocalTransform, 'pz', offsetZ);
            world.setField(dst, LocalTransform, 'rotY', rotationY);
            world.setField(dst, LocalTransform, 'scaleX', scale);
            world.setField(dst, LocalTransform, 'scaleY', scale);
            world.setField(dst, LocalTransform, 'scaleZ', scale);
        }
        if (newParentId !== null) {
            world.addComponent(dst, Parent, { entity: newParentId });
            world.addComponent(dst, HierarchyDepth, { depth: 1 });
        }
        for (const childId of getChildren(world, srcId)) {
            cloneRecursive(childId, dst, false);
        }
        return dst;
    }
    return cloneRecursive(rootId, null, true);
}
function destroyEntityHierarchy(engine, rootId) {
    const world = engine.world;
    const ids = [];
    function collect(id) {
        if (!world.has(id))
            return;
        ids.push(id);
        for (const c of getChildren(world, id))
            collect(c);
    }
    collect(rootId);
    for (const id of ids.reverse()) {
        if (world.has(id))
            world.destroy(id);
    }
}
async function loadConstructionPackDemo(engine, device) {
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
    const roadSpline = [
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
        const sceneUrl = buildPackAssetUrl(userPackBaseUrl, entry.dir, entry.file);
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
        }
        catch (err) {
            console.warn('[EditorDemo] Failed to load user FBX asset', entry.file, err);
        }
    }
    const bounds = finalizeAggregateBounds(aggregate);
    if (loadedScenes === 0 || !bounds) {
        return null;
    }
    const terrainRec = registry.terrains.get(terrainResult.entityId);
    const groundY = terrainRec ? terrainRec.heightfield.minHeight - 0.5 : bounds.min[1] - 0.5;
    spawnGround(engine, 220, bounds.center[0], bounds.center[2], groundY, {
        albedo: [0.22, 0.26, 0.2, 1],
        roughness: 0.95,
        metallic: 0.0,
    });
    return bounds;
}
async function loadFallbackAnimationDemo(engine, device, animRegistries, foxUrl) {
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
    for (let i = 0; i < skeletons.length; i++)
        animRegistries.skeletons.set(i, skeletons[i]);
    for (let i = 0; i < clips.length; i++)
        animRegistries.clips.set(i, clips[i]);
    const gltfMatHandles = [];
    for (const mat of gltfScene.materials) {
        const params = {
            albedo: mat.albedo,
            metallic: mat.metallic,
            roughness: mat.roughness,
            emissive: mat.emissive,
        };
        if (mat.albedoTextureIndex >= 0) {
            const tex = await loadEmbeddedTexture(device, gltfScene, mat.albedoTextureIndex, true);
            if (tex)
                params.albedoTexture = tex;
        }
        if (mat.normalTextureIndex >= 0) {
            const tex = await loadEmbeddedTexture(device, gltfScene, mat.normalTextureIndex, false);
            if (tex)
                params.normalTexture = tex;
        }
        if (mat.mrTextureIndex >= 0) {
            const tex = await loadEmbeddedTexture(device, gltfScene, mat.mrTextureIndex, false);
            if (tex)
                params.mrTexture = tex;
        }
        const { handle } = engine.createMaterial(params);
        gltfMatHandles.push(handle);
    }
    const gltfMeshHandles = [];
    for (const primGroup of gltfScene.meshes) {
        const handles = [];
        for (const prim of primGroup) {
            const meshData = {
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
    const nodeEntities = new Map();
    for (let ni = 0; ni < gltfScene.nodes.length; ni++) {
        const node = gltfScene.nodes[ni];
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
                entity.add(MeshRef, { handle: gltfMeshHandles[node.meshIndex][0] });
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
        const node = gltfScene.nodes[ni];
        const parentId = nodeEntities.get(ni);
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
        { albedo: [0.95, 0.64, 0.54, 1], roughness: 0.1, metallic: 1.0 },
        { albedo: [0.1, 0.5, 0.9, 1], roughness: 0.7, metallic: 0.0 },
        { albedo: [0.9, 0.9, 0.2, 1], roughness: 0.3, metallic: 0.8 },
    ];
    for (let i = 0; i < sphereMaterials.length; i++) {
        const { handle } = engine.createMaterial(sphereMaterials[i]);
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
function spawnGround(engine, size, centerX, centerZ, y, material) {
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
function spawnAmbientEmitter(engine, bounds) {
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
function applyEntityOffset(engine, entityId, dx, dy, dz) {
    if (entityId === 0 || !engine.world.has(entityId) || !engine.world.hasComponent(entityId, LocalTransform)) {
        return;
    }
    engine.world.setField(entityId, LocalTransform, 'px', dx);
    engine.world.setField(entityId, LocalTransform, 'py', dy);
    engine.world.setField(entityId, LocalTransform, 'pz', dz);
}
function offsetBounds(bounds, dx, dy, dz) {
    return {
        min: [bounds.min[0] + dx, bounds.min[1] + dy, bounds.min[2] + dz],
        max: [bounds.max[0] + dx, bounds.max[1] + dy, bounds.max[2] + dz],
        center: [bounds.center[0] + dx, bounds.center[1] + dy, bounds.center[2] + dz],
        radius: bounds.radius,
    };
}
function humanizeAssetLabel(dir, file) {
    const source = dir.trim().length > 0 ? dir : file.replace(/\.[^./?]+$/, '');
    return source
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
async function playBootIntro() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        zIndex: '999999',
    });
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
    });
    overlay.appendChild(video);
    document.body.appendChild(overlay);
    await new Promise((resolve) => {
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
function applyCameraPreset(editor, bounds) {
    const targetY = Math.max(bounds.center[1] + 1.5, bounds.min[1] + 1.5);
    editor.viewport.camera.target = [bounds.center[0], targetY, bounds.center[2]];
    editor.viewport.camera.distance = Math.max(12, bounds.radius * 0.65);
    editor.viewport.camera.far = Math.max(5000, bounds.radius * 12);
    editor.viewport.camera.yaw = Math.PI * 0.82;
    editor.viewport.camera.pitch = -0.32;
}
function buildPackAssetUrl(baseUrl, ...segments) {
    return `${baseUrl}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}
function createBoundsAccumulator() {
    return {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
    };
}
function mergeBounds(aggregate, bounds) {
    aggregate.min[0] = Math.min(aggregate.min[0], bounds.min[0]);
    aggregate.min[1] = Math.min(aggregate.min[1], bounds.min[1]);
    aggregate.min[2] = Math.min(aggregate.min[2], bounds.min[2]);
    aggregate.max[0] = Math.max(aggregate.max[0], bounds.max[0]);
    aggregate.max[1] = Math.max(aggregate.max[1], bounds.max[1]);
    aggregate.max[2] = Math.max(aggregate.max[2], bounds.max[2]);
}
function finalizeAggregateBounds(aggregate) {
    if (!Number.isFinite(aggregate.min[0]) || !Number.isFinite(aggregate.max[0]))
        return null;
    const center = [
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
function quaternionToEulerXYZ(q) {
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
async function loadEmbeddedTexture(device, scene, textureIndex, srgb) {
    try {
        const texData = scene.textures?.[textureIndex];
        if (!texData || texData.data.length === 0)
            return null;
        const blob = new Blob([texData.data.buffer], { type: texData.mimeType });
        const bitmap = await createImageBitmap(blob);
        const format = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
        const texture = device.createTexture({
            size: [bitmap.width, bitmap.height],
            format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
        return texture;
    }
    catch (err) {
        console.warn('[EditorDemo] Failed to load embedded texture', textureIndex, err);
        return null;
    }
}
main().catch(console.error);
//# sourceMappingURL=main.js.map

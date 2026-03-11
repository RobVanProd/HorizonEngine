/**
 * Game Demo — a compact narrative quest slice for the editor demo.
 * Uses simple proximity-based triggers so the same pattern can be extended by AI-authored levels.
 */
import { LocalTransform, MaterialRef, MeshRef, Visible, WorldMatrix } from '@engine/ecs';
import { EmitterFlags, ParticleEmitter } from '@engine/effects';
import { GPUMesh, createSphere, createTorus } from '@engine/renderer-webgpu';
import { sampleHeightWorld } from '@engine/world';
import { QuestChainManager } from './quest-system.js';
const COLLECT_RADIUS = 4.75;
const LANDMARK_RADIUS = 7;
const QUEST_CHAIN_TITLE = 'Echoes In The Hollow';
export class GameDemo {
    _engine;
    _collectibleIds = new Set();
    _collected = 0;
    _total = 0;
    _complete = false;
    _levelName = 'Playable Slice';
    _collectibleMeshHandle = 0;
    _collectibleMaterialHandle = 0;
    _ringMeshHandle = 0;
    _campMaterialHandle = 0;
    _shrineMaterialHandle = 0;
    _overlookMaterialHandle = 0;
    _springEmitterId = 0;
    _quest = null;
    _anchors = null;
    constructor(engine) {
        this._engine = engine;
    }
    spawn(options) {
        const { bounds, heightfield, groundSampler } = options;
        const world = this._engine.world;
        const device = this._engine.gpu.device;
        this._levelName = options.levelName ?? 'Playable Slice';
        const sampleHeight = groundSampler ?? (heightfield ? (x, z) => sampleHeightWorld(heightfield, x, z) : () => 0);
        this._collectibleMeshHandle = this._engine.registerMesh(GPUMesh.create(device, createSphere(0.55, 20, 16)));
        this._ringMeshHandle = this._engine.registerMesh(GPUMesh.create(device, createTorus(1.55, 0.14, 42, 14)));
        this._collectibleMaterialHandle = this._engine.createMaterial({
            albedo: [0.98, 0.86, 0.3, 1],
            metallic: 0.12,
            roughness: 0.12,
            emissive: [1.2, 0.95, 0.45],
        }).handle;
        this._campMaterialHandle = this._engine.createMaterial({
            albedo: [0.92, 0.5, 0.16, 1],
            metallic: 0.05,
            roughness: 0.2,
            emissive: [1.05, 0.42, 0.14],
        }).handle;
        this._shrineMaterialHandle = this._engine.createMaterial({
            albedo: [0.24, 0.78, 0.92, 1],
            metallic: 0.08,
            roughness: 0.18,
            emissive: [0.14, 0.62, 0.9],
        }).handle;
        this._overlookMaterialHandle = this._engine.createMaterial({
            albedo: [0.95, 0.84, 0.42, 1],
            metallic: 0.18,
            roughness: 0.16,
            emissive: [0.92, 0.74, 0.2],
        }).handle;
        const route = options.interestPoints && options.interestPoints.length > 0
            ? options.interestPoints
            : buildFallbackRoute(bounds);
        this._anchors = resolveQuestAnchors(bounds, route, options.questAnchors);
        this._quest = new QuestChainManager(QUEST_CHAIN_TITLE, [
            {
                id: 'reach_camp',
                title: 'Find The Campsite',
                description: 'Head to the ranger camp and read the field signal.',
                storyText: 'The hollow is quiet. Follow the worn path to the abandoned camp and look for the first beacon.',
                completionText: 'Camp signal recovered. The ranger notes point toward three echo seeds hidden along the trail.',
            },
            {
                id: 'collect_echoes',
                title: 'Recover Echo Seeds',
                description: 'Gather the three echo seeds scattered along the valley route.',
                storyText: 'The camp journal says the spring can be restored if the seeds are returned to the shrine at the heart of the valley.',
                targetCount: 3,
                completionText: 'All three seeds resonate. Return them to the shrine.',
            },
            {
                id: 'restore_spring',
                title: 'Restore The Spring',
                description: 'Carry the recovered seeds back to the shrine and rekindle the water.',
                storyText: 'The shrine is dormant, but the air around it is charged. Bring the seeds close and the spring should wake.',
                completionText: 'The spring is active again. Follow the renewed waterline to the overlook.',
            },
            {
                id: 'reach_overlook',
                title: 'Reach The Overlook',
                description: 'Climb to the overlook and confirm the valley has stabilized.',
                storyText: 'The valley is waking up. Reach the overlook to complete the survey and close the loop.',
                completionText: 'Survey complete. The hollow is stable again.',
            },
        ]);
        spawnLandmark(this._engine, this._ringMeshHandle, this._campMaterialHandle, sampleHeight, this._anchors.camp, 'Ranger Camp Beacon', 0.2, 1.0);
        spawnLandmark(this._engine, this._ringMeshHandle, this._shrineMaterialHandle, sampleHeight, this._anchors.shrine, 'Shrine Beacon', 0.28, 1.15);
        spawnLandmark(this._engine, this._ringMeshHandle, this._overlookMaterialHandle, sampleHeight, this._anchors.overlook, 'Overlook Beacon', 0.38, 1.25);
        spawnLandmark(this._engine, this._ringMeshHandle, this._shrineMaterialHandle, sampleHeight, this._anchors.spring, 'Spring Focus', -0.12, 0.9);
        const collectiblePositions = pickCollectiblePositions(route, this._anchors);
        for (const [x, _, z] of collectiblePositions) {
            const h = sampleHeight(x, z) + 0.8;
            const e = world.spawn();
            e.add(LocalTransform, {
                px: x, py: h, pz: z,
                rotX: 0, rotY: 0, rotZ: 0,
                scaleX: 1, scaleY: 1, scaleZ: 1,
            });
            e.add(WorldMatrix);
            e.add(MeshRef, { handle: this._collectibleMeshHandle });
            e.add(MaterialRef, { handle: this._collectibleMaterialHandle });
            e.add(Visible, { _tag: 1 });
            this._engine.setEntityLabel(e.id, 'Echo Seed');
            this._collectibleIds.add(e.id);
        }
        this._total = this._collectibleIds.size;
        const springEmitter = world.spawn();
        const springY = sampleHeight(this._anchors.spring[0], this._anchors.spring[2]) + 0.4;
        springEmitter.add(LocalTransform, {
            px: this._anchors.spring[0],
            py: springY,
            pz: this._anchors.spring[2],
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
        });
        springEmitter.add(WorldMatrix);
        springEmitter.add(ParticleEmitter, {
            rate: 18,
            lifetime: 2.2,
            speed: 0.85,
            spread: 0.28,
            size: 0.2,
            maxParticles: 180,
            colorR: 0.34,
            colorG: 0.88,
            colorB: 1,
            colorA: 0.42,
            flags: EmitterFlags.Looping | EmitterFlags.Additive,
            splineEntity: 0,
            terrainEntity: 0,
            biomeFilter: 0xffffffff,
        });
        this._engine.setEntityLabel(springEmitter.id, 'Restored Spring VFX');
        this._springEmitterId = springEmitter.id;
    }
    update(playerEye) {
        const world = this._engine.world;
        const quest = this._quest;
        const anchors = this._anchors;
        if (!quest || !anchors)
            return this.getState();
        if (quest.isCurrent('reach_camp') && isNear(playerEye, anchors.camp, LANDMARK_RADIUS)) {
            quest.complete('reach_camp');
        }
        const toCollect = [];
        for (const id of this._collectibleIds) {
            if (!world.has(id)) {
                this._collectibleIds.delete(id);
                continue;
            }
            const px = world.getField(id, LocalTransform, 'px');
            const py = world.getField(id, LocalTransform, 'py');
            const pz = world.getField(id, LocalTransform, 'pz');
            const dist = Math.hypot(playerEye[0] - px, playerEye[1] - py, playerEye[2] - pz);
            if (dist <= COLLECT_RADIUS) {
                toCollect.push(id);
            }
        }
        for (const id of toCollect) {
            if (world.has(id))
                world.destroy(id);
            this._collectibleIds.delete(id);
            this._collected++;
            quest.addProgress('collect_echoes', 1);
        }
        if (quest.isCurrent('restore_spring') && isNear(playerEye, anchors.shrine, LANDMARK_RADIUS)) {
            quest.complete('restore_spring');
            this.activateSpringEmitter();
        }
        if (quest.isCurrent('reach_overlook') && isNear(playerEye, anchors.overlook, LANDMARK_RADIUS)) {
            quest.complete('reach_overlook');
        }
        this._complete = quest.getState().complete;
        return this.getState();
    }
    getState() {
        return {
            levelName: this._levelName,
            collected: this._collected,
            total: this._total,
            complete: this._complete,
            quest: this._quest?.getState() ?? {
                chainTitle: QUEST_CHAIN_TITLE,
                currentStep: null,
                completedSteps: 0,
                totalSteps: 0,
                complete: false,
                latestEvent: '',
            },
        };
    }
    activateSpringEmitter() {
        if (this._springEmitterId === 0 || !this._engine.world.has(this._springEmitterId))
            return;
        this._engine.world.setField(this._springEmitterId, ParticleEmitter, 'flags', EmitterFlags.Playing | EmitterFlags.Looping | EmitterFlags.Additive);
    }
}
export function createGameHud() {
    const root = document.createElement('div');
    Object.assign(root.style, {
        position: 'absolute',
        top: '16px',
        left: '16px',
        width: 'min(380px, calc(100vw - 32px))',
        padding: '14px 16px',
        background: 'linear-gradient(180deg, rgba(7,16,22,0.82), rgba(8,13,18,0.72))',
        border: '1px solid rgba(126, 183, 194, 0.2)',
        borderRadius: '14px',
        color: '#edf7f8',
        fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
        fontSize: '14px',
        lineHeight: '1.35',
        pointerEvents: 'none',
        zIndex: '100',
        display: 'none',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 14px 32px rgba(0,0,0,0.24)',
    });
    const levelLabel = document.createElement('div');
    Object.assign(levelLabel.style, {
        fontSize: '11px',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: '#87d7e7',
        opacity: '0.82',
    });
    root.appendChild(levelLabel);
    const objective = document.createElement('div');
    Object.assign(objective.style, {
        marginTop: '6px',
        fontSize: '20px',
        fontWeight: '700',
    });
    root.appendChild(objective);
    const story = document.createElement('div');
    Object.assign(story.style, {
        marginTop: '8px',
        fontSize: '13px',
        color: 'rgba(237, 247, 248, 0.82)',
    });
    root.appendChild(story);
    const progress = document.createElement('div');
    Object.assign(progress.style, {
        marginTop: '10px',
        fontSize: '12px',
        color: '#bde8ef',
    });
    root.appendChild(progress);
    const eventLine = document.createElement('div');
    Object.assign(eventLine.style, {
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid rgba(137, 197, 205, 0.16)',
        fontSize: '12px',
        color: 'rgba(255, 225, 160, 0.88)',
        minHeight: '24px',
    });
    root.appendChild(eventLine);
    const hint = document.createElement('div');
    Object.assign(hint.style, {
        marginTop: '10px',
        fontSize: '11px',
        color: 'rgba(255,255,255,0.58)',
    });
    hint.textContent = 'WASD move  |  Mouse look  |  Walk into beacons and echo seeds';
    root.appendChild(hint);
    return {
        root,
        update(state) {
            levelLabel.textContent = state.levelName;
            if (state.quest.complete) {
                objective.textContent = 'Valley Restored';
                objective.style.color = '#a4f1b9';
                story.textContent = 'The spring is active, the trail is clear, and the survey route is complete.';
                progress.textContent = `Quest chain complete • Echo seeds recovered ${state.collected}/${state.total}`;
            }
            else if (state.quest.currentStep) {
                objective.textContent = state.quest.currentStep.title;
                objective.style.color = '#edf7f8';
                story.textContent = state.quest.currentStep.storyText;
                progress.textContent = state.quest.currentStep.targetCount > 1
                    ? `${state.quest.currentStep.description} (${state.quest.currentStep.progress}/${state.quest.currentStep.targetCount})`
                    : state.quest.currentStep.description;
            }
            else {
                objective.textContent = 'Explore The Hollow';
                objective.style.color = '#edf7f8';
                story.textContent = 'Move through the valley and look for the next signal.';
                progress.textContent = 'No active quest';
            }
            eventLine.textContent = state.quest.latestEvent;
        },
        show() {
            root.style.display = 'block';
        },
        hide() {
            root.style.display = 'none';
        },
    };
}
function resolveQuestAnchors(bounds, route, explicit) {
    const centerX = bounds.center[0];
    const centerZ = bounds.center[2];
    const fallback = buildFallbackRoute(bounds);
    const source = route.length > 0 ? route : fallback;
    return {
        trailhead: explicit?.trailhead ?? source[0] ?? [centerX - 12, 0, centerZ - 10],
        camp: explicit?.camp ?? source[1] ?? [centerX - 8, 0, centerZ - 6],
        shrine: explicit?.shrine ?? source[Math.floor(source.length * 0.5)] ?? [centerX, 0, centerZ],
        spring: explicit?.spring ?? source[Math.max(1, source.length - 3)] ?? [centerX + 8, 0, centerZ + 4],
        overlook: explicit?.overlook ?? source[source.length - 1] ?? [centerX + 12, 0, centerZ + 12],
    };
}
function pickCollectiblePositions(route, anchors) {
    if (route.length >= 5) {
        return [route[1], route[2], route[4]];
    }
    return [
        [anchors.camp[0] + 8, 0, anchors.camp[2] + 3],
        [anchors.shrine[0] - 6, 0, anchors.shrine[2] + 9],
        [anchors.spring[0] + 4, 0, anchors.spring[2] - 6],
    ];
}
function buildFallbackRoute(bounds) {
    const cx = bounds.center[0];
    const cz = bounds.center[2];
    const dx = (bounds.max[0] - bounds.min[0]) * 0.3;
    const dz = (bounds.max[2] - bounds.min[2]) * 0.28;
    return [
        [cx - dx, 0, cz - dz],
        [cx - dx * 0.6, 0, cz - dz * 0.1],
        [cx - dx * 0.15, 0, cz + dz * 0.12],
        [cx + dx * 0.18, 0, cz + dz * 0.02],
        [cx + dx * 0.45, 0, cz + dz * 0.2],
        [cx + dx * 0.82, 0, cz + dz * 0.55],
    ];
}
function spawnLandmark(engine, meshHandle, materialHandle, sampleHeight, point, label, rotX, yOffset) {
    const world = engine.world;
    const groundY = sampleHeight(point[0], point[2]);
    const marker = world.spawn();
    marker.add(LocalTransform, {
        px: point[0],
        py: groundY + yOffset,
        pz: point[2],
        rotX,
        rotY: 0,
        rotZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
    });
    marker.add(WorldMatrix);
    marker.add(MeshRef, { handle: meshHandle });
    marker.add(MaterialRef, { handle: materialHandle });
    marker.add(Visible, { _tag: 1 });
    engine.setEntityLabel(marker.id, label);
}
function isNear(playerEye, point, radius) {
    return Math.hypot(playerEye[0] - point[0], playerEye[2] - point[2]) <= radius;
}
//# sourceMappingURL=game-demo.js.map

/**
 * Game Demo — showcases the engine with a simple collectible exploration game.
 * Spawns collectibles around the scene; player collects by proximity.
 */
import { LocalTransform, MaterialRef, MeshRef, Visible, WorldMatrix } from '@engine/ecs';
import { GPUMesh, createSphere } from '@engine/renderer-webgpu';
import { sampleHeightWorld } from '@engine/world';
const COLLECT_RADIUS = 5;
const COLLECTIBLE_COUNT = 8;
export class GameDemo {
    _engine;
    _collectibleIds = new Set();
    _collected = 0;
    _total = 0;
    _complete = false;
    _meshHandle = 0;
    _materialHandle = 0;
    constructor(engine) {
        this._engine = engine;
    }
    spawn(options) {
        const { bounds, heightfield, groundSampler } = options;
        const world = this._engine.world;
        const device = this._engine.gpu.device;
        this._meshHandle = this._engine.registerMesh(GPUMesh.create(device, createSphere(0.55, 20, 16)));
        this._materialHandle = this._engine.createMaterial({
            albedo: [1, 0.9, 0.25, 1],
            metallic: 0.1,
            roughness: 0.2,
            emissive: [1, 0.95, 0.4],
        }).handle;
        const cx = bounds.center[0];
        const cz = bounds.center[2];
        const dx = (bounds.max[0] - bounds.min[0]) * 0.35;
        const dz = (bounds.max[2] - bounds.min[2]) * 0.35;
        const fallbackPositions = [
            [cx - dx * 0.6, 0, cz - dz * 0.5],
            [cx + dx * 0.4, 0, cz - dz * 0.7],
            [cx + dx * 0.7, 0, cz],
            [cx + dx * 0.5, 0, cz + dz * 0.6],
            [cx, 0, cz + dz * 0.5],
            [cx - dx * 0.5, 0, cz + dz * 0.3],
            [cx - dx * 0.8, 0, cz - dz * 0.2],
            [cx + dx * 0.2, 0, cz - dz * 0.3],
        ];
        const positions = options.interestPoints && options.interestPoints.length > 0
            ? [...options.interestPoints, ...fallbackPositions].slice(0, COLLECTIBLE_COUNT)
            : fallbackPositions.slice(0, COLLECTIBLE_COUNT);
        const sampleHeight = groundSampler ?? (heightfield ? (x, z) => sampleHeightWorld(heightfield, x, z) : () => 0);
        for (const [x, _, z] of positions) {
            const h = sampleHeight(x, z) + 0.5;
            const e = world.spawn();
            e.add(LocalTransform, {
                px: x, py: h, pz: z,
                rotX: 0, rotY: 0, rotZ: 0,
                scaleX: 1, scaleY: 1, scaleZ: 1,
            });
            e.add(WorldMatrix);
            e.add(MeshRef, { handle: this._meshHandle });
            e.add(MaterialRef, { handle: this._materialHandle });
            e.add(Visible, { _tag: 1 });
            this._engine.setEntityLabel(e.id, `Collectible`);
            this._collectibleIds.add(e.id);
        }
        this._total = this._collectibleIds.size;
    }
    update(playerEye) {
        if (this._complete) {
            return { collected: this._collected, total: this._total, complete: true };
        }
        const world = this._engine.world;
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
        }
        this._complete = this._collectibleIds.size === 0;
        return { collected: this._collected, total: this._total, complete: this._complete };
    }
    getState() {
        return {
            collected: this._collected,
            total: this._total,
            complete: this._complete,
        };
    }
}
export function createGameHud() {
    const root = document.createElement('div');
    Object.assign(root.style, {
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 20px',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '8px',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        pointerEvents: 'none',
        zIndex: '100',
        display: 'none',
    });
    const objective = document.createElement('div');
    objective.textContent = 'Objective: Collect all orbs';
    root.appendChild(objective);
    const progress = document.createElement('div');
    progress.style.marginTop = '4px';
    progress.style.fontSize = '12px';
    progress.style.opacity = '0.9';
    root.appendChild(progress);
    const hint = document.createElement('div');
    hint.style.marginTop = '4px';
    hint.style.fontSize = '11px';
    hint.style.opacity = '0.7';
    hint.textContent = 'WASD move · Mouse look · Esc exit';
    root.appendChild(hint);
    return {
        root,
        update(state) {
            progress.textContent = state.total > 0
                ? `Collected: ${state.collected}/${state.total}`
                : 'Explore the scene';
            if (state.complete && state.total > 0) {
                objective.textContent = 'Mission complete!';
                objective.style.color = '#7bed9f';
            }
        },
        show() {
            root.style.display = 'block';
        },
        hide() {
            root.style.display = 'none';
        },
    };
}
//# sourceMappingURL=game-demo.js.map

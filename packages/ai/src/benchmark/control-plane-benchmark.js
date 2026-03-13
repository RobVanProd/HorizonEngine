import { LocalTransform } from '@engine/ecs';
export async function runControlPlaneBenchmarkSuite(options) {
    const results = [];
    for (const task of options.tasks) {
        const context = await options.createContext();
        try {
            results.push(await runControlPlaneBenchmarkTask(context, task));
        }
        finally {
            await context.cleanup?.();
        }
    }
    return {
        suiteName: options.suiteName,
        results,
        allPassed: results.every((result) => result.pass),
    };
}
export async function runControlPlaneBenchmarkTask(context, task) {
    const plan = task.buildPlan(context);
    const entityCountBefore = context.engine.world.entityCount;
    const action = task.mode === 'preview' ? 'scene.previewPlan' : 'scene.applyPlan';
    const start = now();
    const commandResult = await context.ai.execute({
        action,
        params: { plan },
    });
    const executionTimingMs = Number((now() - start).toFixed(3));
    const entityCountAfter = context.engine.world.entityCount;
    const data = asPlanResponse(commandResult.data);
    const validationIssueCount = Array.isArray(data.validation?.issues) ? data.validation.issues.length : 0;
    const notes = [];
    if (!commandResult.ok && commandResult.error) {
        notes.push(commandResult.error);
    }
    const result = {
        taskName: task.name,
        mode: task.mode,
        path: context.path,
        pass: false,
        validationIssueCount,
        applySuccess: task.mode === 'apply' ? Boolean(commandResult.ok && data.applied) : false,
        undoSuccess: null,
        executionTimingMs,
        entityCountBefore,
        entityCountAfter,
        notes,
        error: commandResult.ok ? undefined : commandResult.error,
        idRemaps: Array.isArray(data.idRemaps) ? data.idRemaps : [],
    };
    let pass = task.mode === 'preview'
        ? Boolean(commandResult.ok && data.canApply)
        : result.applySuccess;
    if (task.verify) {
        const verification = task.verify(context, result);
        pass = pass && verification.pass;
        if (verification.notes) {
            result.notes.push(...verification.notes);
        }
    }
    if (task.mode === 'apply' && context.path === 'editor' && context.undoController && result.applySuccess) {
        const canUndo = context.undoController.canUndo();
        if (!canUndo) {
            result.undoSuccess = false;
            result.notes.push('Editor benchmark run did not register an undo entry');
            pass = false;
        }
        else {
            context.undoController.undo();
            let undoSuccess = true;
            if (task.verifyUndo) {
                const undoVerification = task.verifyUndo(context, result);
                undoSuccess = undoVerification.pass;
                if (undoVerification.notes) {
                    result.notes.push(...undoVerification.notes);
                }
            }
            result.undoSuccess = undoSuccess;
            pass = pass && undoSuccess;
        }
    }
    result.pass = pass;
    return result;
}
export function createMinimalControlPlaneBenchmarkTasks() {
    return [
        {
            name: 'preview create',
            mode: 'preview',
            buildPlan: () => ({
                label: 'Benchmark Preview Create',
                actions: [{
                        actionId: 'create-preview',
                        kind: 'entity.create',
                        payload: {
                            name: 'Benchmark Create Preview',
                            transform: { position: [2, 0, 1] },
                        },
                    }],
            }),
            verify: (_context, result) => ({
                pass: result.entityCountBefore === result.entityCountAfter,
                notes: result.entityCountBefore === result.entityCountAfter
                    ? []
                    : ['Preview create mutated entity count'],
            }),
        },
        {
            name: 'apply create',
            mode: 'apply',
            buildPlan: () => ({
                label: 'Benchmark Apply Create',
                actions: [{
                        actionId: 'create-apply',
                        kind: 'entity.create',
                        payload: {
                            name: 'Benchmark Create Apply',
                            transform: { position: [3, 0, 2] },
                        },
                    }],
            }),
            verify: (context, result) => {
                const createdEntityId = result.idRemaps[0]?.entityId;
                const createdName = createdEntityId !== undefined
                    ? context.engine.getEntityLabel(createdEntityId)
                    : null;
                return {
                    pass: result.entityCountAfter === result.entityCountBefore + 1
                        && result.idRemaps.length === 1
                        && createdName === 'Benchmark Create Apply',
                    notes: [],
                };
            },
            verifyUndo: (context, result) => ({
                pass: context.engine.world.entityCount === result.entityCountBefore,
                notes: context.engine.world.entityCount === result.entityCountBefore
                    ? []
                    : ['Undo did not restore entity count after create'],
            }),
        },
        {
            name: 'preview rename',
            mode: 'preview',
            buildPlan: (context) => ({
                label: 'Benchmark Preview Rename',
                actions: [{
                        actionId: 'rename-preview',
                        kind: 'entity.rename',
                        entityId: context.seedEntityId,
                        payload: { name: 'Renamed Preview' },
                    }],
            }),
            verify: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.getEntityLabel(context.seedEntityId) === 'Benchmark Seed',
                notes: [],
            }),
        },
        {
            name: 'apply rename',
            mode: 'apply',
            buildPlan: (context) => ({
                label: 'Benchmark Apply Rename',
                actions: [{
                        actionId: 'rename-apply',
                        kind: 'entity.rename',
                        entityId: context.seedEntityId,
                        payload: { name: 'Renamed Applied' },
                    }],
            }),
            verify: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.getEntityLabel(context.seedEntityId) === 'Renamed Applied',
                notes: [],
            }),
            verifyUndo: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.getEntityLabel(context.seedEntityId) === 'Benchmark Seed',
                notes: [],
            }),
        },
        {
            name: 'preview transform',
            mode: 'preview',
            buildPlan: (context) => ({
                label: 'Benchmark Preview Transform',
                actions: [{
                        actionId: 'transform-preview',
                        kind: 'entity.setTransform',
                        entityId: context.seedEntityId,
                        payload: { position: [9, 1, 4] },
                    }],
            }),
            verify: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'px') === 1
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'py') === 2
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'pz') === 3,
                notes: [],
            }),
        },
        {
            name: 'apply transform',
            mode: 'apply',
            buildPlan: (context) => ({
                label: 'Benchmark Apply Transform',
                actions: [{
                        actionId: 'transform-apply',
                        kind: 'entity.setTransform',
                        entityId: context.seedEntityId,
                        payload: { position: [9, 1, 4] },
                    }],
            }),
            verify: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'px') === 9
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'py') === 1
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'pz') === 4,
                notes: [],
            }),
            verifyUndo: (context) => ({
                pass: context.seedEntityId !== undefined
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'px') === 1
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'py') === 2
                    && context.engine.world.getField(context.seedEntityId, LocalTransform, 'pz') === 3,
                notes: [],
            }),
        },
    ];
}
export function collectForestStressMetrics(engine) {
    let rendererFrame = null;
    try {
        const frame = engine.pbrRenderer.frameStats;
        rendererFrame = {
            drawCount: frame.drawCount,
            triangleCount: frame.triangleCount,
            meshletCount: frame.meshletCount,
            culledObjects: frame.culledObjects,
            culledTriangles: frame.culledTriangles,
        };
    }
    catch {
        rendererFrame = null;
    }
    return {
        entityCount: engine.world.entityCount,
        meshCount: engine.meshes.size,
        materialCount: engine.materials.size,
        rendererFrame,
    };
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function asPlanResponse(value) {
    return typeof value === 'object' && value !== null
        ? value
        : {};
}

import { applyAiActionPlan, previewAiActionPlan, } from './plan-executor.js';
import { readEntityDetail, readEntitySummaries, } from './entity-snapshots.js';
export function registerControlPlaneCommands(router, engine, options = {}) {
    router.register({
        action: 'scene.read.entities',
        description: 'Read a stable minimal entity summary list including hierarchy, transform, tags if available, and component names.',
        params: {
            limit: { type: 'number', description: 'Maximum entities to return', default: 200 },
            entityIds: { type: 'array', description: 'Optional explicit entity IDs to read', items: { type: 'number' } },
        },
    }, (params) => {
        const limit = params['limit'] !== undefined ? Number(params['limit']) : undefined;
        const entityIds = Array.isArray(params['entityIds'])
            ? params['entityIds'].map((value) => Number(value))
            : undefined;
        return {
            ok: true,
            data: readEntitySummaries(engine, { limit, entityIds }),
        };
    });
    router.register({
        action: 'scene.read.entity',
        description: 'Read detailed information for one entity including transform, tags if available, component names, and component field values.',
        params: {
            entityId: { type: 'number', required: true, description: 'Target entity ID' },
        },
    }, (params) => {
        const entityId = Number(params['entityId']);
        const detail = readEntityDetail(engine, entityId);
        if (!detail) {
            return { ok: false, error: `Entity ${entityId} not found` };
        }
        return { ok: true, data: detail };
    });
    router.register({
        action: 'scene.previewPlan',
        description: 'Validate and preview a minimal AI scene action plan without mutating the scene.',
        params: {
            plan: { type: 'object', required: true, description: 'AI control-plane v0 plan payload' },
        },
    }, (params) => {
        const plan = params['plan'] ?? null;
        return {
            ok: true,
            data: previewAiActionPlan(engine, plan, {
                editorUndoAvailable: Boolean(options.undoBridge),
            }),
        };
    });
    router.register({
        action: 'scene.applyPlan',
        description: 'Apply a minimal AI scene action plan with revalidation and diff output.',
        params: {
            plan: { type: 'object', required: true, description: 'AI control-plane v0 plan payload' },
        },
    }, (params) => {
        const plan = params['plan'] ?? null;
        const preview = previewAiActionPlan(engine, plan, {
            editorUndoAvailable: Boolean(options.undoBridge),
        });
        if (!preview.validation.ok) {
            return {
                ok: false,
                data: {
                    ...preview,
                    applied: false,
                    appliedActionCount: 0,
                    idRemaps: [],
                    undo: { available: false, label: null },
                },
            };
        }
        const result = options.undoBridge && preview.plan.options.registerUndo
            ? options.undoBridge.applyPlanWithUndo(preview.plan)
            : applyAiActionPlan(engine, preview.plan, {
                editorUndoAvailable: false,
                undoAvailable: false,
            });
        return { ok: true, data: result };
    });
}

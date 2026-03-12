import type { Engine } from '@engine/core';
import { LocalTransform } from '@engine/ecs';
import type {
  AiActionPlan,
  AiNormalizedActionPlan,
  AiPlanValidationResult,
  AiValidationIssue,
  CreateEntityPayload,
  RenameEntityPayload,
  SetTransformPayload,
} from './plan-types.js';

const SUPPORTED_ACTIONS = new Set([
  'entity.create',
  'entity.rename',
  'entity.setTransform',
]);

export function normalizePlan(plan: AiActionPlan | null | undefined): AiNormalizedActionPlan {
  const actions = Array.isArray(plan?.actions) ? plan!.actions : [];
  return {
    planId: plan?.planId,
    label: typeof plan?.label === 'string' && plan.label.trim().length > 0 ? plan.label.trim() : 'AI Action Plan',
    source: plan?.source,
    target: plan?.target ?? 'runtime',
    actions: actions.map((action, index) => ({
      actionId: typeof action?.actionId === 'string' && action.actionId.trim().length > 0
        ? action.actionId.trim()
        : `action-${index + 1}`,
      kind: typeof action?.kind === 'string' ? action.kind : 'unknown',
      entityId: typeof action?.entityId === 'number' ? action.entityId : undefined,
      payload: action?.payload && typeof action.payload === 'object' ? action.payload : {},
    })),
    options: {
      previewOnly: Boolean(plan?.options?.previewOnly),
      allowPartial: Boolean(plan?.options?.allowPartial),
      registerUndo: plan?.options?.registerUndo !== false,
      validateOnly: Boolean(plan?.options?.validateOnly),
    },
  };
}

export function validatePlan(
  engine: Engine,
  plan: AiNormalizedActionPlan,
  options: {
    editorUndoAvailable?: boolean;
  } = {},
): AiPlanValidationResult {
  const issues: AiValidationIssue[] = [];

  if (plan.actions.length === 0) {
    issues.push(issue({
      severity: 'error',
      code: 'INVALID_PAYLOAD',
      message: 'Plan must contain at least one action',
    }));
  }

  if (plan.target === 'editor' && !options.editorUndoAvailable) {
    issues.push(issue({
      severity: 'error',
      code: 'EDITOR_REQUIRED',
      message: 'Editor-targeted plan requires editor control-plane integration',
    }));
  }

  for (const action of plan.actions) {
    if (!SUPPORTED_ACTIONS.has(action.kind)) {
      issues.push(issue({
        actionId: action.actionId,
        entityId: action.entityId,
        severity: 'error',
        code: 'UNSUPPORTED_ACTION',
        message: `Unsupported action kind: ${action.kind}`,
      }));
      continue;
    }

    switch (action.kind) {
      case 'entity.create':
        validateCreateAction(engine, action.payload as CreateEntityPayload, action.actionId, issues);
        break;
      case 'entity.rename':
        validateRenameAction(engine, action.entityId, action.payload as unknown as RenameEntityPayload, action.actionId, issues);
        break;
      case 'entity.setTransform':
        validateTransformAction(engine, action.entityId, action.payload as SetTransformPayload, action.actionId, issues);
        break;
    }
  }

  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    issues,
  };
}

function validateCreateAction(
  engine: Engine,
  payload: CreateEntityPayload,
  actionId: string,
  issues: AiValidationIssue[],
): void {
  if (payload.parentId != null) {
    if (!engine.world.has(payload.parentId)) {
      issues.push(issue({
        actionId,
        entityId: payload.parentId,
        severity: 'error',
        code: 'INVALID_PARENT',
        message: `Parent entity ${payload.parentId} not found`,
      }));
    }
  }

  if (payload.transform) {
    validateTransformPayload(payload.transform, actionId, issues);
  }
}

function validateRenameAction(
  engine: Engine,
  entityId: number | undefined,
  payload: RenameEntityPayload,
  actionId: string,
  issues: AiValidationIssue[],
): void {
  if (!validateEntityExists(engine, entityId, actionId, issues)) return;
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    issues.push(issue({
      actionId,
      entityId,
      severity: 'error',
      code: 'INVALID_PAYLOAD',
      message: 'Rename action requires a non-empty name',
    }));
  }
}

function validateTransformAction(
  engine: Engine,
  entityId: number | undefined,
  payload: SetTransformPayload,
  actionId: string,
  issues: AiValidationIssue[],
): void {
  if (!validateEntityExists(engine, entityId, actionId, issues)) return;
  if (!engine.world.hasComponent(entityId!, LocalTransform)) {
    issues.push(issue({
      actionId,
      entityId,
      severity: 'error',
      code: 'MISSING_TRANSFORM_COMPONENT',
      message: `Entity ${entityId} has no LocalTransform component`,
    }));
    return;
  }
  validateTransformPayload(payload, actionId, issues, entityId);
}

function validateEntityExists(
  engine: Engine,
  entityId: number | undefined,
  actionId: string,
  issues: AiValidationIssue[],
): boolean {
  if (typeof entityId !== 'number') {
    issues.push(issue({
      actionId,
      severity: 'error',
      code: 'INVALID_PAYLOAD',
      message: 'Action requires entityId',
    }));
    return false;
  }
  if (!engine.world.has(entityId)) {
    issues.push(issue({
      actionId,
      entityId,
      severity: 'error',
      code: 'ENTITY_NOT_FOUND',
      message: `Entity ${entityId} not found`,
    }));
    return false;
  }
  return true;
}

function validateTransformPayload(
  payload: Partial<SetTransformPayload>,
  actionId: string,
  issues: AiValidationIssue[],
  entityId?: number,
): void {
  const hasValue = payload.position !== undefined || payload.rotation !== undefined || payload.scale !== undefined;
  if (!hasValue) {
    issues.push(issue({
      actionId,
      entityId,
      severity: 'error',
      code: 'INVALID_PAYLOAD',
      message: 'Transform action requires position, rotation, or scale payload',
    }));
  }

  validateVec3(payload.position, 'position', actionId, issues, entityId);
  validateVec3(payload.rotation, 'rotation', actionId, issues, entityId);
  validateVec3(payload.scale, 'scale', actionId, issues, entityId);
}

function validateVec3(
  value: unknown,
  label: string,
  actionId: string,
  issues: AiValidationIssue[],
  entityId?: number,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    issues.push(issue({
      actionId,
      entityId,
      severity: 'error',
      code: 'INVALID_TRANSFORM',
      message: `${label} must be a finite [x, y, z] vector`,
    }));
  }
}

function issue(entry: AiValidationIssue): AiValidationIssue {
  return entry;
}

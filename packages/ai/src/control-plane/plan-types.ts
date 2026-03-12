export type AiControlPlaneTarget = 'runtime' | 'editor';
export type AiTagSupport = 'unavailable';

export type AiActionKind =
  | 'entity.create'
  | 'entity.rename'
  | 'entity.setTransform';

export interface AiActionPlan {
  planId?: string;
  label: string;
  source?: 'ai' | 'editor' | 'script';
  target?: AiControlPlaneTarget;
  actions: AiAction[];
  options?: {
    previewOnly?: boolean;
    allowPartial?: boolean;
    registerUndo?: boolean;
    validateOnly?: boolean;
  };
}

export interface AiAction {
  actionId?: string;
  kind: string;
  entityId?: number;
  payload: Record<string, unknown>;
}

export interface AiNormalizedAction extends Omit<AiAction, 'kind'> {
  kind: AiActionKind | string;
  actionId: string;
}

export interface AiNormalizedActionPlan extends Omit<AiActionPlan, 'actions' | 'label' | 'target' | 'options'> {
  label: string;
  target: AiControlPlaneTarget;
  actions: AiNormalizedAction[];
  options: {
    previewOnly: boolean;
    allowPartial: boolean;
    registerUndo: boolean;
    validateOnly: boolean;
  };
}

export interface EntityTransformSnapshot {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface EntitySnapshot {
  entityId: number | null;
  name: string | null;
  parentId: number | null;
  tags: string[];
  tagSupport: AiTagSupport;
  components: string[];
  transform: EntityTransformSnapshot | null;
}

export interface AiPlanSnapshotEntry {
  actionId: string;
  entityId?: number;
  before: EntitySnapshot | null;
  after: EntitySnapshot | null;
}

export interface AiPlanDiff {
  createdEntities: Array<{
    actionId: string;
    entityId?: number;
    name: string | null;
    after: EntitySnapshot;
  }>;
  updatedEntities: Array<{
    actionId: string;
    entityId: number;
    before: EntitySnapshot;
    after: EntitySnapshot;
    changedFields: string[];
  }>;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type AiValidationCode =
  | 'UNSUPPORTED_ACTION'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_PARENT'
  | 'INVALID_TRANSFORM'
  | 'INVALID_PAYLOAD'
  | 'MISSING_TRANSFORM_COMPONENT'
  | 'EDITOR_REQUIRED';

export interface AiValidationIssue {
  actionId?: string;
  entityId?: number;
  severity: ValidationSeverity;
  code: AiValidationCode;
  message: string;
}

export interface AiPlanValidationResult {
  ok: boolean;
  issues: AiValidationIssue[];
}

export interface SceneEntitySummary {
  entityId: number;
  name: string | null;
  parentId: number | null;
  children: number[];
  tags: string[];
  tagSupport: AiTagSupport;
  components: string[];
  transform: EntityTransformSnapshot | null;
}

export interface SceneEntityDetail extends SceneEntitySummary {
  componentFields: Record<string, Record<string, number>>;
}

export interface AiPlanPreviewResult {
  plan: AiNormalizedActionPlan;
  validation: AiPlanValidationResult;
  snapshots: AiPlanSnapshotEntry[];
  diff: AiPlanDiff;
  canApply: boolean;
}

export interface AiIdRemap {
  actionId: string;
  entityId: number;
}

export interface AiPlanApplyResult extends AiPlanPreviewResult {
  applied: boolean;
  appliedActionCount: number;
  idRemaps: AiIdRemap[];
  undo: {
    available: boolean;
    label: string | null;
  };
}

export interface AiPlanUndoBridge {
  applyPlanWithUndo(plan: AiNormalizedActionPlan): AiPlanApplyResult;
}

export interface CreateEntityPayload {
  name?: string;
  parentId?: number | null;
  transform?: Partial<EntityTransformSnapshot>;
}

export interface RenameEntityPayload {
  name: string;
}

export interface SetTransformPayload {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

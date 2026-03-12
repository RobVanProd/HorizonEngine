# AI Control Plane v0

## Objective

Define the first minimal AI control-plane contract for safe scene inspection and bounded scene mutation in HorizonEngine.

This document is intentionally narrow. It covers only:

- scene read API
- scene write API
- preview, diff, undo, and validation hooks
- module boundaries
- editor/runtime integration notes

It does not cover semantic world primitives, benchmark execution, or advanced world-generation flows.

## Design Constraints

- Reuse the existing `EngineAI` + `CommandRouter` command surface.
- Reuse the editor undo/redo stack rather than inventing a second undo system.
- Keep the runtime path functional without requiring the editor UI.
- Treat preview and apply as separate stages.
- Make validation structured and machine-readable.

## Current State

The engine already exposes:

- read commands such as `scene.list`, `scene.inspect`, `scene.query`, `scene.getHierarchy`
- direct mutation commands such as `scene.spawn`, `scene.destroy`, `scene.setPosition`, `scene.setRotation`, `scene.setScale`, `scene.setLabel`
- editor undo/redo through `UndoRedoStack`

The gap is that AI mutations currently execute immediately and bypass a common action envelope for:

- preview
- diff generation
- validation
- undo metadata
- batched application

## v0 Design Decision

Add a thin action-plan layer above the existing router instead of replacing the router.

That layer introduces:

- a canonical action envelope
- explicit preview and apply flows
- structured diff output
- validation hooks
- optional editor-backed undo registration

The existing direct commands remain for compatibility, but v0 should treat the action-plan path as the preferred AI integration path for scene editing.

## API Surface

### Read API v0

Required v0 coverage:

- entities
- hierarchy
- transforms
- tags
- component names

Recommended read actions:

```ts
scene.read.entities
scene.read.entity
scene.read.hierarchy
scene.read.selection
scene.read.capabilities
```

### Write API v0

Required v0 coverage:

- create entity
- delete entity
- rename entity
- set transform
- add tag
- remove tag

Recommended write actions:

```ts
scene.plan
scene.previewPlan
scene.applyPlan
scene.undoLastPlan
scene.redoLastPlan
```

## Canonical Action Envelope

```ts
type AiActionKind =
  | 'entity.create'
  | 'entity.delete'
  | 'entity.rename'
  | 'entity.setTransform'
  | 'entity.addTag'
  | 'entity.removeTag';

interface AiActionPlan {
  planId?: string;
  label: string;
  source?: 'ai' | 'editor' | 'script';
  target?: 'runtime' | 'editor';
  actions: AiAction[];
  options?: {
    previewOnly?: boolean;
    allowPartial?: boolean;
    registerUndo?: boolean;
    validateOnly?: boolean;
  };
}

interface AiAction {
  actionId?: string;
  kind: AiActionKind;
  entityId?: number;
  payload: Record<string, unknown>;
}
```

## Read Schemas

### `scene.read.entities`

Returns compact entity summaries for AI inspection.

```ts
interface SceneEntitySummary {
  entityId: number;
  name: string | null;
  parentId: number | null;
  children: number[];
  tags: string[];
  components: string[];
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  } | null;
}
```

Parameters:

```ts
{
  limit?: number;
  entityIds?: number[];
  includeChildren?: boolean;
  includeComponents?: boolean;
  includeTags?: boolean;
}
```

### `scene.read.entity`

Returns one fully expanded entity view.

```ts
interface SceneEntityDetail extends SceneEntitySummary {
  componentFields: Record<string, Record<string, number | string | boolean | null>>;
}
```

### `scene.read.hierarchy`

Returns a hierarchy tree with names and tags for AI reasoning.

```ts
interface SceneHierarchyNode {
  entityId: number;
  name: string | null;
  tags: string[];
  children: SceneHierarchyNode[];
}
```

### `scene.read.capabilities`

Returns the supported v0 action kinds and execution features.

```ts
interface AiControlPlaneCapabilities {
  version: 'v0';
  readActions: string[];
  writeActions: string[];
  supportsPreview: boolean;
  supportsDiff: boolean;
  supportsUndo: boolean;
  supportsValidation: boolean;
  supportsBatchApply: boolean;
  target: 'runtime' | 'editor' | 'hybrid';
}
```

## Write Payload Schemas

### `entity.create`

```ts
interface CreateEntityPayload {
  name?: string;
  parentId?: number | null;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  tags?: string[];
}
```

### `entity.delete`

```ts
interface DeleteEntityPayload {
  recursive?: boolean;
}
```

### `entity.rename`

```ts
interface RenameEntityPayload {
  name: string;
}
```

### `entity.setTransform`

```ts
interface SetTransformPayload {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}
```

### `entity.addTag` / `entity.removeTag`

```ts
interface TagMutationPayload {
  tag: string;
}
```

## Diff Schema

Preview and apply both return a structured diff.

```ts
interface AiPlanDiff {
  createdEntities: Array<{
    tempId?: string;
    entityId?: number;
    name: string | null;
  }>;
  deletedEntities: Array<{
    entityId: number;
    name: string | null;
  }>;
  updatedEntities: Array<{
    entityId: number;
    before: EntitySnapshot;
    after: EntitySnapshot;
    changedFields: string[];
  }>;
}

interface EntitySnapshot {
  name: string | null;
  parentId: number | null;
  tags: string[];
  components: string[];
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  } | null;
}
```

## Validation Schema

Validation must be structured and non-fatal where possible.

```ts
type ValidationSeverity = 'error' | 'warning' | 'info';

interface AiValidationIssue {
  actionId?: string;
  entityId?: number;
  severity: ValidationSeverity;
  code:
    | 'ENTITY_NOT_FOUND'
    | 'INVALID_PARENT'
    | 'INVALID_TRANSFORM'
    | 'DUPLICATE_TAG'
    | 'MISSING_TAG'
    | 'UNSUPPORTED_ACTION'
    | 'EDITOR_REQUIRED'
    | 'UNDO_UNAVAILABLE';
  message: string;
}

interface AiPlanValidationResult {
  ok: boolean;
  issues: AiValidationIssue[];
}
```

## Execution Flow

### Preview

`scene.previewPlan(plan)`:

1. Normalize action payloads.
2. Resolve target mode: runtime or editor.
3. Validate every action.
4. Build before/after snapshots without mutating the live scene.
5. Return:
   - normalized plan
   - validation result
   - diff
   - `canApply`

### Apply

`scene.applyPlan(plan)`:

1. Re-run validation against current scene state.
2. If validation fails with errors, abort.
3. If editor target and `registerUndo !== false`, wrap mutations in one undo command.
4. Execute actions in order.
5. Return:
   - applied action count
   - entity ID remaps for creations
   - resulting diff
   - undo token or undo label

### Undo / Redo

For editor-backed plans:

- apply one `UndoCommand` per plan, not per atomic field write
- store:
  - label
  - execute callback
  - undo callback

For runtime-only plans:

- return `supportsUndo: false` unless a runtime transaction store exists

## Module Boundaries

v0 should be implemented as a small extension layer inside `@engine/ai`.

### `@engine/ai`

New modules:

```text
packages/ai/src/control-plane/plan-types.ts
packages/ai/src/control-plane/entity-snapshots.ts
packages/ai/src/control-plane/plan-validator.ts
packages/ai/src/control-plane/plan-diff.ts
packages/ai/src/control-plane/plan-executor.ts
packages/ai/src/control-plane/control-plane-api.ts
```

Responsibilities:

- type definitions
- action normalization
- diff generation
- validation
- execution orchestration
- command registration

### `@engine/editor`

New modules or narrow additions:

```text
packages/editor/src/ai/ai-plan-undo.ts
packages/editor/src/editor.ts
packages/editor/src/ai-commands.ts
```

Responsibilities:

- bridge plan application into `UndoRedoStack`
- expose editor capability checks
- optionally expose editor selection/target context

### `@engine/core`

No redesign required.

Expected usage only:

- world mutation
- entity labels
- camera state

### `@engine/ecs`

No redesign required.

Potential additive need:

- a lightweight tag component or tag registry if tags are not already standardized

## Integration Notes

### Runtime Path

Runtime integration should support:

- read APIs
- preview validation
- apply for direct scene mutation

Runtime v0 may omit undo if no transaction log exists.

### Editor Path

Editor integration should be the preferred mutation path for authoring tasks because it already has:

- undo/redo stack
- selection state
- serializer
- viewport context

Editor-backed plans should execute as grouped undoable commands.

### Compatibility Layer

Existing commands should remain valid:

- `scene.spawn`
- `scene.destroy`
- `scene.setPosition`
- `scene.setRotation`
- `scene.setScale`
- `scene.setLabel`

v0 should wrap or reuse them internally where possible rather than duplicating mutation logic.

## Minimal Implementation Slice

The first implementation slice after this design should cover:

1. `scene.read.entities`
2. `scene.read.entity`
3. `scene.previewPlan`
4. `scene.applyPlan`
5. editor-backed grouped undo for:
   - create entity
   - delete entity
   - rename entity
   - set transform
   - add/remove tag

## Known Limitations In v0

- No semantic world primitives yet.
- No benchmark harness yet.
- No multi-user conflict handling.
- Runtime undo may remain unsupported initially.
- Tags may require a lightweight standardization layer if current usage is ad hoc.
- Preview diffs for deletions with deep hierarchies may be shallow in the first slice.

## Review Checklist

This design is complete for v0 only if it provides:

- read coverage for entities, hierarchy, transforms, tags, and component names
- write coverage for create, delete, rename, transform, add tag, remove tag
- explicit preview, diff, undo, and validation hooks
- module boundaries and editor/runtime integration notes

export { EngineAI } from './engine-ai.js';
export { CommandRouter } from './command-router.js';
export { registerSceneCommands } from './scene-api.js';
export { registerAudioCommands } from './audio-commands.js';
export { registerDebugCommands, type DebugState } from './debug-commands.js';
export {
  InferenceEngine,
  type InferenceBackend,
  type InferenceModel,
  type InferenceModelInfo,
  type InferenceResult,
  type TensorDescriptor,
  type InferenceEngineOptions,
} from './inference.js';
export {
  InferenceBehavior,
  INFERENCE_FLAG_ENABLED,
  createInferenceSystem,
  type InferenceRegistries,
  type InputCollector,
  type OutputProcessor,
  type InferenceSystemConfig,
} from './inference-system.js';
export { registerMLCommands } from './ml-commands.js';
export { registerAdvancedCommands } from './advanced-commands.js';
export { registerControlPlaneCommands, type ControlPlaneRegistrationOptions } from './control-plane/control-plane-api.js';
export {
  previewAiActionPlan,
  applyAiActionPlan,
  applyAiActionPlanWithUndoLog,
  undoAiActionPlanExecution,
} from './control-plane/plan-executor.js';
export {
  runControlPlaneBenchmarkSuite,
  runControlPlaneBenchmarkTask,
  createMinimalControlPlaneBenchmarkTasks,
  collectForestStressMetrics,
  type ControlPlaneBenchmarkContext,
  type ControlPlaneBenchmarkTask,
  type ControlPlaneBenchmarkTaskCheckResult,
  type ControlPlaneBenchmarkTaskResult,
  type ControlPlaneBenchmarkSuiteResult,
  type ControlPlaneBenchmarkUndoController,
  type ForestStressMetricsSnapshot,
} from './benchmark/control-plane-benchmark.js';
export {
  runForestStressBenchmarkRun,
  runForestStressBenchmarkMatrix,
  serializeForestStressBenchmarkRun,
  getForestStressBenchmarkOutputPath,
  type ForestStressBenchmarkContext,
  type ForestStressBenchmarkSetupResult,
  type ForestStressBenchmarkRun,
  type ForestStressBenchmarkStatus,
  type ForestStressDensityLabel,
} from './benchmark/forest-stress-benchmark.js';
export {
  SceneContextLoop,
  type SceneContextLoopOptions,
  type SceneContextSnapshot,
} from './scene-context-loop.js';
export { WebSocketTransport } from './transports/websocket.js';
export { WorkerTransport } from './transports/worker.js';
export type {
  Command,
  CommandResult,
  CommandHandler,
  CommandSchema,
  ToolDefinition,
  ParamDef,
  Transport,
} from './types.js';
export type {
  AiAction,
  AiActionKind,
  AiActionPlan,
  AiIdRemap,
  AiNormalizedAction,
  AiNormalizedActionPlan,
  AiPlanApplyResult,
  AiPlanDiff,
  AiPlanPreviewResult,
  AiPlanSnapshotEntry,
  AiPlanUndoBridge,
  AiPlanValidationResult,
  AiValidationIssue,
  EntitySnapshot,
  EntityTransformSnapshot,
  SceneEntityDetail,
  SceneEntitySummary,
} from './control-plane/plan-types.js';

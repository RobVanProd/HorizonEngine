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

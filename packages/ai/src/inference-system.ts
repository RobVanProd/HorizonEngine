import { FieldType } from '@engine/memory';
import { defineComponent, type World, type Query } from '@engine/ecs';
import type { FrameContext } from '@engine/scheduler';
import type { InferenceEngine, TensorDescriptor } from './inference.js';

/**
 * ECS component that attaches an ML model to an entity.
 *   modelHandle  — index into InferenceRegistries.models (U32)
 *   interval     — seconds between inference runs (F32, 0 = every frame)
 *   lastRun      — elapsed time of last inference (F32)
 *   flags        — bit 0: enabled
 */
export const InferenceBehavior = defineComponent('InferenceBehavior', {
  modelHandle: FieldType.U32,
  interval: FieldType.F32,
  lastRun: FieldType.F32,
  flags: FieldType.U32,
});

export const INFERENCE_FLAG_ENABLED = 1;

export interface InferenceRegistries {
  /** Map from model handle to model name in the InferenceEngine. */
  modelNames: Map<number, string>;
}

/**
 * Callback to collect inputs for a specific entity before inference.
 * Return a map of tensor name -> descriptor, or null to skip this entity.
 */
export type InputCollector = (
  entityId: number,
  modelName: string,
) => Map<string, TensorDescriptor> | null;

/**
 * Callback to process inference outputs for a specific entity.
 */
export type OutputProcessor = (
  entityId: number,
  modelName: string,
  outputs: Map<string, TensorDescriptor>,
) => void;

export interface InferenceSystemConfig {
  engine: InferenceEngine;
  registries: InferenceRegistries;
  collectInputs: InputCollector;
  processOutputs: OutputProcessor;
}

/**
 * Creates an ECS system that runs ML inference for entities with InferenceBehavior.
 * Runs in Phase.SIMULATE each frame.
 */
export function createInferenceSystem(
  world: World,
  config: InferenceSystemConfig,
): { query: Query; update: (ctx: FrameContext) => void } {

  const query = world.query(InferenceBehavior);

  // Batch entities by model for efficient inference
  const pendingByModel = new Map<string, number[]>();

  function update(ctx: FrameContext): void {
    pendingByModel.clear();

    query.each((arch, count) => {
      const modelHandles = arch.getColumn(InferenceBehavior, 'modelHandle') as Uint32Array;
      const intervals = arch.getColumn(InferenceBehavior, 'interval') as Float32Array;
      const lastRuns = arch.getColumn(InferenceBehavior, 'lastRun') as Float32Array;
      const flags = arch.getColumn(InferenceBehavior, 'flags') as Uint32Array;
      const entityIds = arch.entities.data as Uint32Array;

      for (let i = 0; i < count; i++) {
        if ((flags[i]! & INFERENCE_FLAG_ENABLED) === 0) continue;

        const interval = intervals[i]!;
        if (interval > 0 && (ctx.elapsedTime - lastRuns[i]!) < interval) continue;

        lastRuns[i] = ctx.elapsedTime;

        const modelName = config.registries.modelNames.get(modelHandles[i]!);
        if (!modelName) continue;

        const model = config.engine.getModel(modelName);
        if (!model) continue;

        if (!pendingByModel.has(modelName)) {
          pendingByModel.set(modelName, []);
        }
        pendingByModel.get(modelName)!.push(entityIds[i]!);
      }
    });

    // Run inference for each model batch (fire-and-forget for async models)
    for (const [modelName, entityIds] of pendingByModel) {
      for (const eid of entityIds) {
        const inputs = config.collectInputs(eid, modelName);
        if (!inputs) continue;

        void config.engine.infer(modelName, Object.fromEntries(
          Array.from(inputs.entries()).map(([k, v]) => [k, { data: Array.from(v.data as Float32Array), shape: v.shape }]),
        )).then(result => {
          config.processOutputs(eid, modelName, result.outputs);
        }).catch(err => {
          console.warn(`[InferenceSystem] Error for entity ${eid} model ${modelName}:`, err);
        });
      }
    }
  }

  return { query, update };
}

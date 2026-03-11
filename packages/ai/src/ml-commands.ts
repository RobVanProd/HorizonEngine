import type { CommandRouter } from './command-router.js';
import type { InferenceEngine } from './inference.js';

/**
 * Registers ML inference commands onto a CommandRouter.
 */
export function registerMLCommands(router: CommandRouter, inference: InferenceEngine): void {

  // ─── ml.loadModel ─────────────────────────────────────────────
  router.register(
    {
      action: 'ml.loadModel',
      description: 'Load an ONNX model from a URL and register it by name',
      params: {
        url: { type: 'string', required: true, description: 'URL to the .onnx model file' },
        name: { type: 'string', required: true, description: 'Name to register the model under' },
        backend: { type: 'string', description: 'Execution backend', enum: ['webgpu', 'wasm', 'cpu'], default: 'wasm' },
      },
    },
    async (params) => {
      const url = params['url'] as string;
      const name = params['name'] as string;
      const backend = (params['backend'] as 'webgpu' | 'wasm' | 'cpu') ?? 'wasm';

      try {
        const model = await inference.loadModel(url, name, backend);
        return {
          ok: true,
          data: {
            name: model.name,
            inputNames: model.info.inputNames,
            outputNames: model.info.outputNames,
            backend: model.info.backend,
          },
        };
      } catch (err) {
        return { ok: false, error: `Failed to load model: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── ml.infer ─────────────────────────────────────────────────
  router.register(
    {
      action: 'ml.infer',
      description: 'Run inference on a loaded model with the given inputs',
      params: {
        model: { type: 'string', required: true, description: 'Model name' },
        inputs: {
          type: 'object',
          required: true,
          description: 'Input tensors as { tensorName: { data: number[], shape: number[] } }',
        },
      },
    },
    async (params) => {
      const modelName = params['model'] as string;
      const rawInputs = params['inputs'] as Record<string, { data: number[]; shape: number[] }>;

      try {
        const result = await inference.infer(modelName, rawInputs);
        const outputData: Record<string, { data: number[]; shape: number[] }> = {};

        for (const [name, tensor] of result.outputs) {
          outputData[name] = {
            data: Array.from(tensor.data as Float32Array),
            shape: tensor.shape,
          };
        }

        return {
          ok: true,
          data: {
            outputs: outputData,
            inferenceTimeMs: result.inferenceTimeMs,
          },
        };
      } catch (err) {
        return { ok: false, error: `Inference failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── ml.listModels ────────────────────────────────────────────
  router.register(
    {
      action: 'ml.listModels',
      description: 'List all loaded ML models and their metadata',
      params: {},
    },
    () => {
      const models = inference.listModels();
      return {
        ok: true,
        data: {
          count: models.length,
          models: models.map(m => ({
            name: m.name,
            url: m.url,
            backend: m.backend,
            inputs: m.inputNames,
            outputs: m.outputNames,
          })),
        },
      };
    },
  );

  // ─── ml.disposeModel ──────────────────────────────────────────
  router.register(
    {
      action: 'ml.disposeModel',
      description: 'Unload and dispose a model by name',
      params: {
        name: { type: 'string', required: true, description: 'Model name to dispose' },
      },
    },
    (params) => {
      const name = params['name'] as string;
      inference.disposeModel(name);
      return { ok: true, data: { disposed: name } };
    },
  );
}

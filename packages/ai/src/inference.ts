/**
 * ML Inference Engine — wraps ONNX Runtime Web (or any compatible runtime).
 * Provides a unified interface for loading and running neural network models.
 *
 * Supports both WebGPU and WASM execution backends.
 * Models are loaded by URL and cached by name for reuse.
 */

export type InferenceBackend = 'webgpu' | 'wasm' | 'cpu';

export interface TensorDescriptor {
  name: string;
  shape: number[];
  data: Float32Array | Int32Array | Uint8Array;
}

export interface InferenceModelInfo {
  name: string;
  url: string;
  backend: InferenceBackend;
  inputNames: string[];
  outputNames: string[];
}

export interface InferenceResult {
  outputs: Map<string, TensorDescriptor>;
  inferenceTimeMs: number;
}

/**
 * Abstract interface for a loaded inference model.
 * Implementations wrap specific runtimes (ONNX, TF.js, etc.).
 */
export interface InferenceModel {
  readonly name: string;
  readonly info: InferenceModelInfo;
  run(inputs: Map<string, TensorDescriptor>): Promise<InferenceResult>;
  dispose(): void;
}

export interface InferenceEngineOptions {
  defaultBackend?: InferenceBackend;
}

/**
 * Central ML inference manager.
 * Load models, run inference, and manage model lifecycle.
 */
export class InferenceEngine {
  private _models = new Map<string, InferenceModel>();
  private _defaultBackend: InferenceBackend;
  private _ort: any = null;

  constructor(options?: InferenceEngineOptions) {
    this._defaultBackend = options?.defaultBackend ?? 'wasm';
  }

  get modelCount(): number { return this._models.size; }

  listModels(): InferenceModelInfo[] {
    return Array.from(this._models.values()).map(m => m.info);
  }

  getModel(name: string): InferenceModel | undefined {
    return this._models.get(name);
  }

  /**
   * Load an ONNX model from a URL.
   * Dynamically imports onnxruntime-web if available.
   */
  async loadModel(
    url: string,
    name: string,
    backend?: InferenceBackend,
  ): Promise<InferenceModel> {
    const be = backend ?? this._defaultBackend;

    if (this._models.has(name)) {
      return this._models.get(name)!;
    }

    // Try to load ONNX Runtime Web dynamically
    const ort = await this._getOrt();
    if (!ort) {
      // Fallback: create a stub model for environments without ONNX
      const stub = this._createStubModel(name, url, be);
      this._models.set(name, stub);
      return stub;
    }

    const session = await ort.InferenceSession.create(url, {
      executionProviders: [be === 'webgpu' ? 'webgpu' : 'wasm'],
    });

    const inputNames = session.inputNames as string[];
    const outputNames = session.outputNames as string[];

    const info: InferenceModelInfo = {
      name, url, backend: be, inputNames, outputNames,
    };

    const model: InferenceModel = {
      name,
      info,
      async run(inputs: Map<string, TensorDescriptor>): Promise<InferenceResult> {
        const feeds: Record<string, any> = {};
        for (const [key, tensor] of inputs) {
          feeds[key] = new ort.Tensor(
            tensor.data instanceof Float32Array ? 'float32'
              : tensor.data instanceof Int32Array ? 'int32' : 'uint8',
            tensor.data,
            tensor.shape,
          );
        }

        const t0 = performance.now();
        const results = await session.run(feeds);
        const inferenceTimeMs = performance.now() - t0;

        const outputs = new Map<string, TensorDescriptor>();
        for (const outName of outputNames) {
          const t = results[outName];
          if (t) {
            outputs.set(outName, {
              name: outName,
              shape: t.dims as number[],
              data: t.data as Float32Array,
            });
          }
        }

        return { outputs, inferenceTimeMs };
      },
      dispose(): void {
        session.release();
      },
    };

    this._models.set(name, model);
    return model;
  }

  /**
   * Run inference on a named model.
   */
  async infer(
    modelName: string,
    inputs: Record<string, { data: number[]; shape: number[] }>,
  ): Promise<InferenceResult> {
    const model = this._models.get(modelName);
    if (!model) throw new Error(`Model "${modelName}" not loaded`);

    const inputMap = new Map<string, TensorDescriptor>();
    for (const [key, val] of Object.entries(inputs)) {
      inputMap.set(key, {
        name: key,
        shape: val.shape,
        data: new Float32Array(val.data),
      });
    }

    return model.run(inputMap);
  }

  /**
   * Dispose a model by name.
   */
  disposeModel(name: string): void {
    const model = this._models.get(name);
    if (model) {
      model.dispose();
      this._models.delete(name);
    }
  }

  /**
   * Dispose all models and clean up.
   */
  destroy(): void {
    for (const model of this._models.values()) {
      model.dispose();
    }
    this._models.clear();
  }

  private async _getOrt(): Promise<any> {
    if (this._ort) return this._ort;
    try {
      // Evade Vite's static import analysis — onnxruntime-web is an optional peer dependency
      const moduleName = ['onnxruntime', 'web'].join('-');
      this._ort = await (new Function('m', 'return import(m)'))(moduleName);
      return this._ort;
    } catch {
      console.warn('[InferenceEngine] onnxruntime-web not available — using stub models');
      return null;
    }
  }

  private _createStubModel(name: string, url: string, backend: InferenceBackend): InferenceModel {
    const info: InferenceModelInfo = {
      name, url, backend, inputNames: [], outputNames: [],
    };

    return {
      name,
      info,
      async run(): Promise<InferenceResult> {
        return { outputs: new Map(), inferenceTimeMs: 0 };
      },
      dispose(): void {},
    };
  }
}

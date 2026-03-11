/**
 * Asset loading handle. Wraps a Promise with observable state
 * so systems can poll readiness without awaiting.
 */

export const enum LoadState {
  Pending = 0,
  Loading = 1,
  Loaded = 2,
  Error = 3,
}

export class Handle<T> {
  state: LoadState = LoadState.Pending;
  data: T | undefined = undefined;
  error: Error | undefined = undefined;

  private _promise: Promise<T>;
  private _resolve!: (value: T) => void;
  private _reject!: (error: Error) => void;

  constructor() {
    this._promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get isLoaded(): boolean {
    return this.state === LoadState.Loaded;
  }

  get isError(): boolean {
    return this.state === LoadState.Error;
  }

  get promise(): Promise<T> {
    return this._promise;
  }

  /** @internal */
  _begin(): void {
    this.state = LoadState.Loading;
  }

  /** @internal */
  _complete(value: T): void {
    this.data = value;
    this.state = LoadState.Loaded;
    this._resolve(value);
  }

  /** @internal */
  _fail(err: Error): void {
    this.error = err;
    this.state = LoadState.Error;
    this._reject(err);
  }
}

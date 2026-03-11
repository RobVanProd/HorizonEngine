import { Handle } from './handle.js';

/**
 * Generic resource cache with deduplication.
 * Loads are keyed by string (typically URL or path).
 * Subsequent loads of the same key return the same Handle.
 */
export class ResourceCache {
  private _entries: Map<string, Handle<any>> = new Map();

  /**
   * Load a resource. If already loaded or loading, returns the existing handle.
   * Otherwise calls the loader function and caches the result.
   */
  load<T>(key: string, loader: () => Promise<T>): Handle<T> {
    const existing = this._entries.get(key);
    if (existing) return existing as Handle<T>;

    const handle = new Handle<T>();
    this._entries.set(key, handle);

    handle._begin();
    loader()
      .then(value => handle._complete(value))
      .catch(err => handle._fail(err instanceof Error ? err : new Error(String(err))));

    return handle;
  }

  get<T>(key: string): Handle<T> | undefined {
    return this._entries.get(key) as Handle<T> | undefined;
  }

  has(key: string): boolean {
    return this._entries.has(key);
  }

  remove(key: string): boolean {
    return this._entries.delete(key);
  }

  clear(): void {
    this._entries.clear();
  }

  get size(): number {
    return this._entries.size;
  }
}

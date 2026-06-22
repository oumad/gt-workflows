/**
 * Tiny in-memory TTL cache. Used by the analytics service to avoid re-running
 * 100ms+ aggregation queries on every refresh. One process only — switch to a
 * Redis-backed cache when we run > 1 API instance.
 */

export class TtlCache {
  private store = new Map<string, { data: unknown; at: number }>()
  constructor(private readonly ttlMs: number) {}

  /** Returns the cached value when fresh, otherwise calls `load()`, caches the
   *  result, and returns it. The only access pattern this cache needs. */
  async memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data as T
    const data = await load()
    this.store.set(key, { data, at: Date.now() })
    return data
  }
}

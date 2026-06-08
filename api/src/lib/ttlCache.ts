/**
 * Tiny in-memory TTL cache. Used by the analytics service to avoid re-running
 * 100ms+ aggregation queries on every refresh. One process only — switch to a
 * Redis-backed cache when we run > 1 API instance.
 */

export class TtlCache {
  private store = new Map<string, { data: unknown; at: number }>()
  constructor(private readonly ttlMs: number) {}

  get<T>(key: string): T | null {
    const hit = this.store.get(key)
    if (!hit) return null
    if (Date.now() - hit.at >= this.ttlMs) {
      this.store.delete(key)
      return null
    }
    return hit.data as T
  }

  set(key: string, data: unknown): void {
    this.store.set(key, { data, at: Date.now() })
  }

  /** Wraps a loader: returns cached value when fresh, otherwise calls
   *  `load()`, caches the result, and returns it. */
  async memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== null) return hit
    const data = await load()
    this.set(key, data)
    return data
  }
}

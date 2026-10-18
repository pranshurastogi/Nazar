/**
 * Tiny least-recently-used map with a per-entry lifetime. A Map keeps insertion order, so
 * re-inserting on read moves an entry to the young end and the oldest key is always first.
 */
export class Lru<K, V> {
  private readonly map = new Map<K, { value: V; expires: number }>()

  constructor(
    readonly max: number,
    readonly ttlMs = Infinity,
    private readonly now: () => number = Date.now,
  ) {}

  get size() {
    return this.map.size
  }

  get(key: K): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    if (hit.expires <= this.now()) return undefined
    this.map.set(key, hit)
    return hit.value
  }

  set(key: K, value: V) {
    this.map.delete(key)
    this.map.set(key, { value, expires: this.now() + this.ttlMs })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K)
  }

  clear() {
    this.map.clear()
  }
}

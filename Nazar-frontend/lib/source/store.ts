// A tiny IndexedDB key-value store. Everything here is a cache: when IndexedDB is missing
// (private mode, old browsers, server render) reads return undefined and writes are dropped.

const DB = 'nazar'
const STORE = 'kv'

let dbp: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbp
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    (db) =>
      db
        ? new Promise<T | undefined>((resolve) => {
            try {
              const req = fn(db.transaction(STORE, mode).objectStore(STORE))
              req.onsuccess = () => resolve(req.result as T)
              req.onerror = () => resolve(undefined)
            } catch {
              resolve(undefined)
            }
          })
        : undefined,
    () => undefined,
  )
}

export const idbGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key))
export const idbSet = (key: string, value: unknown) => run<IDBValidKey>('readwrite', (s) => s.put(value, key)).then(() => undefined)

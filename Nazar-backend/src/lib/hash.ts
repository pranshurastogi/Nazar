import { createHash } from 'node:crypto'

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Short, stable id derived from several parts (used for row ids and case ids). */
export const stableId = (...parts: (string | number)[]) => sha256(parts.join('␟')).slice(0, 24)

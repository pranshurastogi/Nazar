/** Base class so callers can tell pipeline failures from programming errors. */
export class NazarError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

/** Network or upstream failure that is worth retrying. */
export class TransientError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, 'TRANSIENT', details, options)
  }
}

/** Upstream answered but the response can never succeed (404, robots disallow, bad content type). */
export class PermanentError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, 'PERMANENT', details, options)
  }
}

export class ExtractionError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, 'EXTRACTION', details, options)
  }
}

export class ConfigError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG', details)
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

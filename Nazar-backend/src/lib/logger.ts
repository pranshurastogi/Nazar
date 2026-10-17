import pino from 'pino'

import { env } from '../config/env.ts'

const e = env()

export const logger = pino({
  level: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
  base: { app: 'nazar' },
  redact: { paths: ['*.privateKey', '*.apiKey', 'privateKey', 'apiKey'], censor: '[redacted]' },
  ...(e.NODE_ENV === 'development' && process.stdout.isTTY
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
})

export type Logger = typeof logger
export const child = (component: string) => logger.child({ component })

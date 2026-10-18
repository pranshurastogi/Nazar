// Nazar's lightweight i18n: typed dictionaries (en.ts is the source of truth), a provider, and
// useT(). Server code imports './core' (and './server' for the request's cookie) directly.
export * from './core'
export { detectLocale, LocaleProvider, LocaleScope, useT } from './provider'

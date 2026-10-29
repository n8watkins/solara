// The deployed entry point (package.json "main" is its compiled lib/index.js).
//
// Each feature folder declares its Cloud Functions in its own `functions.ts`, so features
// change independently and a new function needs no edit here. Every export of those
// modules is deployed under its exported name: renaming one deletes the old function and
// creates a new one, and only Cloud Functions may be exported from them.

import { installRequestBodyLimit } from './shared/body-limit'

// Stack traces point at the TypeScript source (lib/ ships with source maps).
process.setSourceMapsEnabled(true)

// Bodies over an endpoint's limit are refused before the Functions Framework reads them
// (REVIEW8 SEC L1); the framework creates its server after loading this module.
installRequestBodyLimit()

export * from './account/functions'
export * from './billing/functions'
export * from './events/functions'
export * from './feed/functions'
export * from './notifications/functions'
export * from './ops/functions'
export * from './forecast/functions'

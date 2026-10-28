// The deployed entry point (package.json "main" is its compiled lib/index.js).
//
// Each feature folder declares its Cloud Functions in its own `functions.ts`, so features
// change independently and a new function needs no edit here. Every export of those
// modules is deployed under its exported name: renaming one deletes the old function and
// creates a new one, and only Cloud Functions may be exported from them.

// Stack traces point at the TypeScript source (lib/ ships with source maps).
process.setSourceMapsEnabled(true)

export * from './account/functions'
export * from './billing/functions'
export * from './events/functions'
export * from './feed/functions'
export * from './notifications/functions'
export * from './ops/functions'
export * from './forecast/functions'

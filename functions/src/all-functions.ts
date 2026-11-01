// Every Cloud Function, the `all` set of the entry point (src/index.ts).
//
// Each feature folder declares its Cloud Functions in its own `functions.ts`, so features
// change independently and a new function needs no edit here. Every export of those
// modules is deployed under its exported name: renaming one deletes the old function and
// creates a new one, and only Cloud Functions may be exported from them.

export * from './account/functions'
export * from './billing/functions'
export * from './events/functions'
export * from './feed/functions'
export * from './notifications/functions'
export * from './ops/functions'
// The budget kill switch, also deployable on its own as the `budget-guard` set.
export * from './ops/budget-guard'
export * from './forecast/functions'

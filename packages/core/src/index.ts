// @solara/core: business logic shared by the web app and Cloud Functions.
// The web app imports this TypeScript source directly; Functions load the
// CommonJS build in functions/core (npm run build:core).
//
// The package is marked `"sideEffects": false`, so the web app's bundle drops the
// modules re-exported here that nothing it loads uses; no module in this package may run
// code with effects when it is imported. Imported events and the .ics reader are a
// separate entry point, `@solara/core/event-import` (event-import.ts), so they never
// depend on how well a bundler prunes this barrel. Every other module is an entry point
// of its own too (`@solara/core/<module>`, `#core/<module>` in the Functions): the
// planning modules moved from the web app (tiers, planner, next-slot, ...) are imported
// that way.

export * from './alerts'
export * from './briefing'
export * from './exposure'
export * from './feed-token'
export * from './forecast'
export * from './forecast-quality'
export * from './functions-api'
export * from './geocoding'
export * from './planning'
export * from './plans'
export * from './ics'
export * from './prefs'
export * from './recommendation'
export * from './redact'
export * from './schema'
export * from './scheduled'
export * from './sun-times'
export * from './uv-scale'

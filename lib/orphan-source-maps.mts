// Turbopack writes an empty source map for the chunk group of a Web Worker
// (new Worker(new URL(...)), used by lib/events.ts) even when browser source maps are
// off, next to a chunk it never emits. scripts/drop-orphan-source-maps.mjs removes
// such maps after `npm run build`, so the export publishes no source map
// (tests/e2e/switched-off-integrations.spec.ts).
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Every `.map` file under `dir` whose script (the same path without `.map`) is missing. */
export function orphanSourceMaps(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.map'))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(file => !existsSync(file.slice(0, -'.map'.length)))
}

/** Removes the orphan maps under `dir` and returns their paths. */
export function dropOrphanSourceMaps(dir: string): string[] {
  const orphans = orphanSourceMaps(dir)
  for (const file of orphans) rmSync(file)
  return orphans
}

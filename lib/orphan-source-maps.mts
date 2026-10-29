// Turbopack writes an empty source map for the chunk group of a Web Worker
// (new Worker(new URL(...)), used by lib/events.ts) even when browser source maps are
// off, next to a chunk it never emits. scripts/drop-orphan-source-maps.mjs removes
// such maps after `npm run build`, so the export publishes no source map
// (tests/e2e/switched-off-integrations.spec.ts).
//
// A map belongs to a script either by name (`a.js.map` beside `a.js`) or, as Turbopack
// names them, through the script's `sourceMappingURL` comment (`a.js` ending in
// `//# sourceMappingURL=0_x.js.map`). Both are kept: a build with browser source maps
// (BROWSER_SOURCE_MAPS=1) uploads them to Sentry before the deploy removes them.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const SOURCE_MAPPING_URL = /[#@] sourceMappingURL=([^\s'"*]+)\s*(?:\*\/\s*)?$/

/** The map a script or stylesheet names in its last `sourceMappingURL` comment, if any. */
function referencedMap(file: string): string | null {
  const tail = readFileSync(file, 'utf8').slice(-1024)
  const url = SOURCE_MAPPING_URL.exec(tail)?.[1]
  if (!url || /^[a-z][a-z\d+.-]*:/i.test(url)) return null
  return resolve(dirname(file), decodeURIComponent(url.replace(/[?#].*$/, '')))
}

/** Every `.map` file under `dir` that no script or stylesheet there belongs to. */
export function orphanSourceMaps(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
  const referenced = new Set(
    files
      .filter(file => /\.(js|mjs|css)$/.test(file))
      .map(referencedMap)
      .filter(map => map !== null),
  )
  return files.filter(
    file =>
      file.endsWith('.map') &&
      !referenced.has(resolve(file)) &&
      !existsSync(file.slice(0, -'.map'.length)),
  )
}

/** Removes the orphan maps under `dir` and returns their paths. */
export function dropOrphanSourceMaps(dir: string): string[] {
  const orphans = orphanSourceMaps(dir)
  for (const file of orphans) rmSync(file)
  return orphans
}

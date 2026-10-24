#!/usr/bin/env node
// Deletes the browser source maps from a static export after the deploy workflow
// has uploaded them to Sentry, and the `sourceMappingURL` comments that point to
// them, so the published site never serves a .map file.
// check-public-env.mjs --built fails if any remain.
//
// Usage: node .github/scripts/remove-source-maps.mjs <exportDir>
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const COMMENT_LINE = /^\/[/*][#@] sourceMappingURL=.*(?:\r?\n)?/gm

/** Removes source map comments from a script or stylesheet. */
export function stripSourceMapComments(text) {
  return text.replace(COMMENT_LINE, '')
}

/**
 * Deletes every .map file under `dir` and strips the comments that reference them.
 * @param {string} dir
 * @returns {{ maps: number, files: number }}
 */
export function removeSourceMaps(dir) {
  let maps = 0
  let files = 0
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (entry.name.endsWith('.map')) {
      rmSync(path)
      maps++
    } else if (/\.(js|css)$/.test(entry.name)) {
      const text = readFileSync(path, 'utf8')
      const stripped = stripSourceMapComments(text)
      if (stripped !== text) {
        writeFileSync(path, stripped)
        files++
      }
    }
  }
  return { maps, files }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node .github/scripts/remove-source-maps.mjs <exportDir>')
    process.exit(2)
  }
  const { maps, files } = removeSourceMaps(dir)
  console.log(`Removed ${maps} source maps and their comments from ${files} files in ${dir}.`)
}

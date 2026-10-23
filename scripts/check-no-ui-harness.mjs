#!/usr/bin/env node
// Fails if a static export contains the UI harness (app/harness/page.harness.tsx).
//
// Runs automatically after `npm run build` (postbuild) against `out/`, so CI and
// local production builds prove the harness route and its fixtures never ship.
// Usage: node scripts/check-no-ui-harness.mjs [exportDir]   (default: out)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Keep in sync with HARNESS_MARKER in tests/harness/fixtures.ts.
const MARKER = 'solara-ui-harness'
const TEXT_EXTENSIONS = /\.(html|js|mjs|json|txt|css|rsc)$/

const dir = process.argv[2] || 'out'

if (!process.argv[2] && process.env.NEXT_PUBLIC_UI_HARNESS === '1') {
  console.log('check-no-ui-harness: skipped for a UI harness build (it exports elsewhere).')
  process.exit(0)
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`check-no-ui-harness: ${dir} does not exist. Run the build first.`)
  process.exit(2)
}

function* walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const problems = []
if (existsSync(join(dir, 'harness'))) problems.push(`${join(dir, 'harness')}/ exists`)

let scanned = 0
for (const file of walk(dir)) {
  if (!TEXT_EXTENSIONS.test(file)) continue
  scanned++
  if (readFileSync(file, 'utf8').includes(MARKER)) problems.push(`${relative(dir, file)} contains "${MARKER}"`)
}

if (problems.length) {
  console.error(`check-no-ui-harness: the UI harness leaked into ${dir}:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`check-no-ui-harness: ${dir} has no harness route or harness code (${scanned} files scanned).`)

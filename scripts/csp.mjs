#!/usr/bin/env node
// Writes a hash-based Content-Security-Policy <meta> into every HTML page of a
// static export. Runs after `npm run build` (postbuild); see lib/csp.mts for why
// the policy is split between this meta tag and the header in firebase.json.
//
// Usage: node scripts/csp.mjs [exportDir]   (default: out)
// Fails the build if a page has no <head> or uses inline event handlers.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import nextEnv from '@next/env'
import {
  cspEnvFrom,
  injectCspMeta,
  inlineEventHandlers,
  inlineScriptHashes,
  isSiteVerificationFile,
  pagePolicy,
  serializePolicy,
} from '../lib/csp.mts'

const dir = process.argv[2] || 'out'

if (!process.argv[2] && process.env.NEXT_PUBLIC_UI_HARNESS === '1') {
  console.log('csp: skipped for a UI harness build (it exports elsewhere).')
  process.exit(0)
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`csp: ${dir} does not exist. Run the build first.`)
  process.exit(2)
}

// Same env resolution as `next build`, so the policy matches the bundle.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error })
const env = cspEnvFrom(process.env)

function* walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.html')) yield full
  }
}

const problems = []
let pages = 0
let hashCount = 0
for (const file of walk(dir)) {
  const html = readFileSync(file, 'utf8')
  if (isSiteVerificationFile(basename(file), html)) continue
  const handlers = inlineEventHandlers(html)
  if (handlers.length) {
    problems.push(`${relative(dir, file)} uses inline event handlers: ${handlers.join(', ')}`)
    continue
  }
  const hashes = inlineScriptHashes(html)
  try {
    writeFileSync(file, injectCspMeta(html, serializePolicy(pagePolicy(hashes, env))))
  } catch (error) {
    problems.push(`${relative(dir, file)}: ${error.message}`)
    continue
  }
  pages++
  hashCount += hashes.length
}

if (problems.length) {
  console.error('csp: could not secure every page:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
if (pages === 0) {
  console.error(`csp: ${dir} has no HTML pages.`)
  process.exit(1)
}

console.log(`csp: wrote hash-based policies into ${pages} pages (${hashCount} inline scripts).`)

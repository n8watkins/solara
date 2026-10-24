#!/usr/bin/env node
// Makes the pages that need no JavaScript truly static: the landing page (`/`).
//
// Next.js ships its framework runtime (about 120 KB gzip) with every page, even one
// with no client components, so it can hydrate. The landing page has nothing to
// hydrate: it is HTML and CSS plus two inline scripts of our own (the theme, which
// must run before first paint, and the redirect that sends an account to the app),
// which carry the `data-static` attribute. This removes every other script, so the landing page loads no
// framework code and nothing from Firebase (target: under 100 KB of JavaScript).
//
// Runs after `next build` and before scripts/csp.mjs, which then hashes only the
// scripts that remain. Fails the build when the export no longer looks the way this
// expects, rather than shipping a page that silently lost a script.
//
// Usage: node scripts/static-pages.mjs [exportDir]   (default: out)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATIC_PAGES, stripFrameworkScripts } from '../lib/static-pages.mts'

const dir = process.argv[2] || 'out'

if (!process.argv[2] && process.env.NEXT_PUBLIC_UI_HARNESS === '1') {
  console.log('static-pages: skipped for a UI harness build (it exports elsewhere).')
  process.exit(0)
}

const problems = []
for (const page of STATIC_PAGES) {
  const file = join(dir, page)
  if (!existsSync(file)) {
    problems.push(`${page} is missing`)
    continue
  }
  try {
    const { html, removed } = stripFrameworkScripts(readFileSync(file, 'utf8'))
    writeFileSync(file, html)
    console.log(`static-pages: ${page} is static (${removed} framework scripts removed).`)
  } catch (error) {
    problems.push(`${page}: ${error.message}`)
  }
}

if (problems.length) {
  console.error('static-pages: could not make every page static:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

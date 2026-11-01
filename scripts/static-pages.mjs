#!/usr/bin/env node
// Makes the pages that need no JavaScript truly static: the landing page (`/`).
// Also writes each page's language into `<html lang>`: every page under es/ is Spanish
// (ROADMAP item 46), while the one root layout writes English.
//
// Next.js ships its framework runtime (about 120 KB gzip) with every page, even one
// with no client components, so it can hydrate. The landing page has nothing to
// hydrate: it is HTML and CSS plus two inline scripts of our own (the theme, which
// must run before first paint, and the redirect that sends an account to the app),
// which carry the `data-static` attribute. This removes every other script, so the landing
// page loads no framework code and nothing from Firebase (target: under 100 KB of
// JavaScript). A kept script marked `data-head-first` (the Microsoft redirect page's
// hand-over) moves to the start of <head>, so no stylesheet or font can delay it.
//
// Runs after `next build` and before scripts/csp.mjs, which then hashes only the
// scripts that remain. Fails the build when the export no longer looks the way this
// expects, rather than shipping a page that silently lost a script.
//
// Usage: node scripts/static-pages.mjs [exportDir]   (default: out)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  FONT_PRELOAD_PAGES,
  HEAD_FIRST_PAGES,
  STATIC_PAGES,
  pageLanguage,
  stripFrameworkScripts,
  withDocumentLanguage,
  withFontPreload,
} from '../lib/static-pages.mts'

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
    const { html, removed, hoisted } = stripFrameworkScripts(readFileSync(file, 'utf8'))
    // The Microsoft redirect page's hand-over must run before anything else loads (REVIEW7 M1).
    if (HEAD_FIRST_PAGES.includes(page) && hoisted !== 1) {
      problems.push(`${page} must have exactly one script marked data-head-first (has ${hoisted})`)
      continue
    }
    writeFileSync(file, html)
    console.log(
      `static-pages: ${page} is static (${removed} framework scripts removed${hoisted ? `, ${hoisted} moved first` : ''}).`,
    )
  } catch (error) {
    problems.push(`${page}: ${error.message}`)
  }
}

// Every exported page in another language than English: its <html lang>.
const translated = existsSync(join(dir, 'es'))
  ? readdirSync(join(dir, 'es'), { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.html'))
      .map(file => relative(dir, join(dir, 'es', file)))
  : []
if (translated.length === 0) problems.push('no pages under es/ (the Spanish pages are missing)')
for (const page of translated) {
  const file = join(dir, page)
  try {
    writeFileSync(file, withDocumentLanguage(readFileSync(file, 'utf8'), pageLanguage(page)))
  } catch (error) {
    problems.push(`${page}: ${error.message}`)
  }
}
if (translated.length)
  console.log(`static-pages: ${translated.length} pages under es/ are in Spanish.`)

// The not-found page preloads the font like every other page (REVIEW10 QA L2).
const reference = join(dir, 'app', 'index.html')
for (const page of FONT_PRELOAD_PAGES) {
  const file = join(dir, page)
  if (!existsSync(file) || !existsSync(reference)) continue
  try {
    writeFileSync(
      file,
      withFontPreload(readFileSync(file, 'utf8'), readFileSync(reference, 'utf8')),
    )
  } catch (error) {
    problems.push(`${page}: ${error.message}`)
  }
}

if (problems.length) {
  console.error('static-pages: could not make every page static:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

#!/usr/bin/env node
// Builds the site's two service workers into a static export. Runs after `next build`
// (postbuild, after scripts/csp.mjs, so the pages are final).
//
// - sw.js, the app-shell worker (scripts/sw/shell.ts, rules in lib/sw-shell.mts): it
//   precaches the shell pages (`/` and `/app/`) and every file they load, so an
//   installed Solara opens offline. The list comes from the export itself: each page's
//   `/_next/static/` scripts, stylesheets and fonts (including the client chunks named
//   only in its inline RSC data), the files its tags reference, the manifest's icons and
//   the fonts its stylesheets load. The framework's own entry files from Next's build
//   manifest (.next/build-manifest.json) must be among them, so a change in how Next
//   writes pages fails the build instead of shipping a shell that misses a script.
//   The version is a hash of every precached file, so any change to the site installs
//   a new worker and an unchanged rebuild does not.
// - firebase-messaging-sw.js, the push worker (scripts/sw/firebase-messaging-sw.ts),
//   bundled with the app's npm Firebase SDK and the public Firebase web config. Firebase
//   Messaging registers it under its own scope when someone turns on notifications.
//
// Usage: node scripts/build-sw.mjs [exportDir]   (default: out)
//        node scripts/build-sw.mjs --dev          (push worker into public/ for `next dev`)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import {
  SHELL_PAGES,
  SHELL_WORKER_URL,
  manifestIcons,
  pageAssets,
  stylesheetAssets,
} from '../lib/sw-shell.mts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const dirArg = args.find(arg => !arg.startsWith('--'))
const dir = resolve(dirArg || 'out')

if (!dev && !dirArg && process.env.NEXT_PUBLIC_UI_HARNESS === '1') {
  console.log('build-sw: skipped for a UI harness build (it exports elsewhere).')
  process.exit(0)
}

// Same env files and precedence as Next: `next dev` (--dev) reads the development
// files, `next build` the production ones, and variables already set in the
// environment win over every file.
nextEnv.loadEnvConfig(root, dev, { info: () => {}, error: console.error })

const { build } = await import('rolldown')

/** Bundles one worker source into `file`, with `define` replacing its build-time values. */
async function bundle(source, file, define) {
  await build({
    input: join(root, 'scripts', 'sw', source),
    platform: 'browser',
    logLevel: 'warn',
    transform: { define },
    output: { file, format: 'iife', minify: true, sourcemap: false },
  })
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
}

async function buildPushWorker(outDir) {
  await bundle('firebase-messaging-sw.ts', join(outDir, 'firebase-messaging-sw.js'), {
    __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
  })
}

if (dev) {
  // The shell worker caches a production build only; `next dev` never registers one.
  await buildPushWorker(join(root, 'public'))
  console.log('build-sw: firebase-messaging-sw.js bundled into public/ for next dev.')
  process.exit(0)
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`build-sw: ${dir} does not exist. Run the build first.`)
  process.exit(2)
}

const problems = []
const fileOf = url => join(dir, url.slice(1))
const exists = url => existsSync(fileOf(url)) && statSync(fileOf(url)).isFile()

// Every file the shell pages load, then what the manifest and stylesheets load.
const assets = new Set()
for (const page of SHELL_PAGES) {
  const file = join(dir, page.file)
  if (!existsSync(file)) {
    problems.push(`${page.file} is missing`)
    continue
  }
  for (const url of pageAssets(readFileSync(file, 'utf8'))) assets.add(url)
}
for (const url of [...assets]) {
  if (!exists(url)) continue
  if (url.endsWith('.webmanifest')) {
    try {
      for (const icon of manifestIcons(JSON.parse(readFileSync(fileOf(url), 'utf8'))))
        assets.add(icon)
    } catch (error) {
      problems.push(`${url} is not valid JSON: ${error.message}`)
    }
  } else if (url.endsWith('.css')) {
    for (const ref of stylesheetAssets(readFileSync(fileOf(url), 'utf8'), url)) assets.add(ref)
  }
}
for (const url of assets) if (!exists(url)) problems.push(`${url} is referenced but not exported`)

// Next's own record of the framework entry files the app page boots with.
const manifestPath = join(root, '.next', 'build-manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entries = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]
  if (!entries.length) problems.push('.next/build-manifest.json lists no entry files')
  for (const entry of entries)
    if (!assets.has(`/_next/${entry}`))
      problems.push(`/_next/${entry} (from the build manifest) is not in the shell`)
} else {
  problems.push('.next/build-manifest.json is missing: run next build first')
}

if (problems.length) {
  console.error('build-sw: could not list the app shell:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const pages = SHELL_PAGES.map(page => page.url)
const assetList = [...assets].sort()
const hash = createHash('sha256')
for (const page of SHELL_PAGES)
  hash.update(`${page.url}\0`).update(readFileSync(join(dir, page.file)))
for (const url of assetList) hash.update(`${url}\0`).update(readFileSync(fileOf(url)))
const version = hash.digest('hex').slice(0, 16)

await bundle('shell.ts', join(dir, SHELL_WORKER_URL.slice(1)), {
  __SHELL__: JSON.stringify({ version, pages, assets: assetList }),
})
await buildPushWorker(dir)

const bytes = assetList.reduce((sum, url) => sum + statSync(fileOf(url)).size, 0)
console.log(
  `build-sw: sw.js precaches ${pages.length} pages and ${assetList.length} files ` +
    `(${Math.round(bytes / 1024)} KB, version ${version}); firebase-messaging-sw.js bundled.`,
)

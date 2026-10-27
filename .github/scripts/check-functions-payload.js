#!/usr/bin/env node
// Proves that the Functions deploy payload is self-contained, without deploying.
//
// `firebase deploy` uploads only the functions/ source directory, and Cloud
// Build installs its dependencies from functions/package.json alone, so nothing
// outside functions/ (such as the packages/core workspace) is available at run
// time. This script packages the source with the locked firebase-tools exactly
// as a deploy does (same ignore rules), unpacks it into an empty directory,
// installs production dependencies from the lockfile, and loads the package entry
// point (package.json "main", the compiled lib/index.js) there.
//
// Run `npm run build --prefix functions` first (the Functions predeploy hook does it
// on deploy): it compiles @solara/core into functions/core and the TypeScript source
// into functions/lib.
//
// Usage: node .github/scripts/check-functions-payload.js
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const functionsDir = path.join(root, 'functions')
const fromFunctions = request => require(require.resolve(request, { paths: [functionsDir] }))

/** Exports a deploy must find: a sample of HTTP, scheduled and feed functions. */
const EXPECTED_EXPORTS = ['calendarFeed', 'deleteAccount', 'maintenance', 'stripeWebhook']

async function main() {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'))
  const config = [firebaseJson.functions].flat()[0]
  if (config?.source !== 'functions')
    throw new Error('firebase.json functions.source is not functions')
  const { prepareFunctionsUpload } = fromFunctions(
    'firebase-tools/lib/deploy/functions/prepareFunctionsUpload.js',
  )
  const { pathToSource } = await prepareFunctionsUpload(
    root,
    functionsDir,
    { ...config, ignore: config.ignore && [...config.ignore] },
    [],
    undefined,
    { exportType: 'tar.gz' },
  )

  const payload = fs.mkdtempSync(path.join(os.tmpdir(), 'functions-payload-'))
  try {
    execFileSync('tar', ['-xzf', pathToSource, '-C', payload])
    const { main } = JSON.parse(fs.readFileSync(path.join(payload, 'package.json'), 'utf8'))
    for (const required of [main, 'package.json', 'package-lock.json', 'core/index.js']) {
      if (!fs.existsSync(path.join(payload, required))) {
        throw new Error(
          `the payload has no ${required} (run npm run build --prefix functions first)`,
        )
      }
    }
    if (fs.existsSync(path.join(payload, 'node_modules'))) {
      throw new Error('the payload includes node_modules')
    }

    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: payload,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    // A fresh process, so nothing resolves from this repository's node_modules.
    const loaded = execFileSync(
      process.execPath,
      [
        '-e',
        `const f = require(${JSON.stringify(payload)}); console.log(JSON.stringify(Object.keys(f)))`,
      ],
      { cwd: payload, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
    )
    const exported = JSON.parse(loaded.trim().split('\n').at(-1))
    const missing = EXPECTED_EXPORTS.filter(name => !exported.includes(name))
    if (missing.length) throw new Error(`${main} does not export ${missing.join(', ')}`)
    console.log(
      `The Functions payload loads on its own and exports ${exported.length} functions: ${exported.join(', ')}.`,
    )
  } finally {
    fs.rmSync(payload, { recursive: true, force: true })
    fs.rmSync(pathToSource, { force: true })
  }
}

main().catch(error => {
  console.log(`::error::The Functions deploy payload is not self-contained: ${error.message}`)
  process.exit(1)
})

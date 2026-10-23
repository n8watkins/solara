#!/usr/bin/env node
// Builds @solara/core (packages/core) as CommonJS into functions/core.
//
// `firebase deploy` uploads only the functions/ directory and installs its
// dependencies from functions/package.json, so a workspace package cannot be
// linked in. Instead the compiled core lives inside the Functions source, where
// Functions load it through the `#core` import in functions/package.json, and
// its runtime dependencies are declared in functions/package.json too. This
// script fails when those declarations drift from packages/core/package.json.
//
// The output is generated: it is gitignored and rebuilt by `npm test`, the
// Functions scripts and the Functions predeploy hook.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreDir = path.join(root, 'packages', 'core')
const outDir = path.join(root, 'functions', 'core')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

const core = readJson(path.join(coreDir, 'package.json'))
const functions = readJson(path.join(root, 'functions', 'package.json'))
const drift = Object.entries(core.dependencies ?? {}).filter(
  ([name, range]) => functions.dependencies?.[name] !== range,
)
if (drift.length) {
  for (const [name, range] of drift) {
    console.error(
      `functions/package.json must depend on ${name}@${range} (as packages/core does); it has ${functions.dependencies?.[name] ?? 'nothing'}.`,
    )
  }
  process.exit(1)
}

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
rmSync(outDir, { recursive: true, force: true })
execFileSync(process.execPath, [tsc, '-p', path.join(coreDir, 'tsconfig.build.json')], {
  stdio: 'inherit',
})
writeFileSync(
  path.join(outDir, 'README.md'),
  '# Generated\n\nCommonJS build of `packages/core`, written by `npm run build:core`.\nDo not edit; change `packages/core/src` instead.\n',
)
console.log(`Built @solara/core into ${path.relative(root, outDir)}/`)

#!/usr/bin/env node
// Proves a static export never connects to the Firebase Local Emulator Suite.
//
// lib/firebase-services.ts connects Auth, Firestore and App Check to local emulators only in
// builds made with NEXT_PUBLIC_FIREBASE_EMULATORS=1, which only the signed-in e2e
// suite makes (tests/e2e/signed-in/run.mjs, into its own directory). This check runs
// after `npm run build` (postbuild), the only production build, and fails when:
// - the flag is set in the environment or an .env file, so `npm run build` can never
//   produce an emulator build, or
// - any file in the export contains the marker text that only the emulator code
//   path carries, so the code path is provably compiled out.
//
// Usage: node scripts/check-no-emulators.mjs [exportDir]   (default: out)
//        node scripts/check-no-emulators.mjs <exportDir> --expect-emulators
// The second form asserts the opposite for the suite's own build, which shows the
// marker search really finds the emulator code path when it is there.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import nextEnv from '@next/env'

// Keep in sync with connectEmulators and emulatorAppCheckProvider in lib/firebase-services.ts.
const MARKER = 'solara-firebase-emulators'
const FLAG = 'NEXT_PUBLIC_FIREBASE_EMULATORS'
const TEXT_EXTENSIONS = /\.(html|js|mjs|json|txt|css|rsc)$/

const args = process.argv.slice(2)
const expectEmulators = args.includes('--expect-emulators')
const dirArg = args.find(arg => !arg.startsWith('--'))
const dir = dirArg || 'out'

if (!dirArg && process.env.NEXT_PUBLIC_UI_HARNESS === '1') {
  console.log('check-no-emulators: skipped for a UI harness build (it exports elsewhere).')
  process.exit(0)
}

if (!expectEmulators) {
  // Same env resolution as `next build`, so a flag in .env.local counts too.
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error })
  if (process.env[FLAG]) {
    console.error(
      `check-no-emulators: ${FLAG} is set. npm run build makes the production export and ` +
        'never connects to emulators; the signed-in e2e suite builds its own ' +
        '(npm run test:e2e:signed-in).',
    )
    process.exit(1)
  }
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`check-no-emulators: ${dir} does not exist. Run the build first.`)
  process.exit(2)
}

function* walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const hits = []
let scanned = 0
for (const file of walk(dir)) {
  if (!TEXT_EXTENSIONS.test(file)) continue
  scanned++
  if (readFileSync(file, 'utf8').includes(MARKER)) hits.push(relative(dir, file))
}

if (expectEmulators) {
  if (hits.length === 0) {
    console.error(
      `check-no-emulators: ${dir} was meant to be an emulator build but has no "${MARKER}".`,
    )
    process.exit(1)
  }
  console.log(
    `check-no-emulators: ${dir} is an emulator build (${hits.length} files carry the marker).`,
  )
  process.exit(0)
}

if (hits.length) {
  console.error(`check-no-emulators: the emulator connection code leaked into ${dir}:`)
  for (const hit of hits) console.error(`  - ${hit} contains "${MARKER}"`)
  process.exit(1)
}

console.log(
  `check-no-emulators: ${dir} has no emulator connection code (${scanned} files scanned).`,
)

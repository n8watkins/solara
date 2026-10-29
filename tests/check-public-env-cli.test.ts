import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

// The command itself, which loads the .env files `next build` reads (through
// @next/env, so it runs here with node_modules rather than in the workflow script
// tests, which run before any install). REVIEW8 SEC L9.
const script = fileURLToPath(new URL('../.github/scripts/check-public-env.mjs', import.meta.url))
const complete = {
  FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public-web-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'uv-activity-planner.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
  NEXT_PUBLIC_SITE_URL: 'https://solara-uv.web.app',
}
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-public-env-cli-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script], {
      cwd: dir,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', ...complete },
      encoding: 'utf8',
    })
    return { status: 0, out }
  } catch (error) {
    const failed = error as { status: number; stdout: string }
    return { status: failed.status, out: String(failed.stdout) }
  }
}

it('passes a complete configuration with no .env files', () => {
  expect(run()).toEqual({ status: 0, out: 'Public build configuration is complete.\n' })
})

it('refuses an App Check debug token from .env.production', () => {
  writeFileSync(join(dir, '.env.production'), 'NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=leaked\n')
  const { status, out } = run()
  expect(status).toBe(1)
  expect(out).toMatch(/::error::NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN is set/)
})

it('refuses Functions switched on in .env.local without the App Check site key', () => {
  writeFileSync(
    join(dir, '.env.local'),
    'ENABLE_BLAZE_FUNCTIONS=true\nNEXT_PUBLIC_FUNCTIONS_URL=https://us-central1-uv-activity-planner.cloudfunctions.net\n',
  )
  const { status, out } = run()
  expect(status).toBe(1)
  expect(out).toMatch(/NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY is empty/)
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkEnv, exportContains } from './check-public-env.mjs'

const complete = {
  FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public-web-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'uv-activity-planner.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
  NEXT_PUBLIC_SITE_URL: 'https://uv-activity-planner.web.app',
}

test('accepts a complete production configuration', () => {
  assert.deepEqual(checkEnv(complete), { errors: [], warnings: [] })
})

test('rejects a build without the Firebase web config', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_FIREBASE_API_KEY: ' ' })
  assert.match(errors.join('\n'), /NEXT_PUBLIC_FIREBASE_API_KEY is empty/)
})

test('rejects a bundle configured for a different project', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'other-project' })
  assert.match(errors.join('\n'), /deploys to uv-activity-planner/)
})

test('requires https URLs', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_SITE_URL: 'http://example.com' })
  assert.match(errors.join('\n'), /NEXT_PUBLIC_SITE_URL must use https/)
})

test('ties the Functions URL to the Functions deployment switch', () => {
  assert.match(
    checkEnv({ ...complete, ENABLE_BLAZE_FUNCTIONS: 'true' }).errors.join('\n'),
    /NEXT_PUBLIC_FUNCTIONS_URL is empty/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_FUNCTIONS_URL: 'https://fn.example.com' }).errors.join(
      '\n',
    ),
    /Functions are not deployed/,
  )
})

test('rejects secrets in public values', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_PRO_PRICE: 'sk_live_abc123' })
  assert.match(errors.join('\n'), /NEXT_PUBLIC_PRO_PRICE looks like a Stripe secret/)
})

test('warns, but does not fail, without a site URL', () => {
  const result = checkEnv({ ...complete, NEXT_PUBLIC_SITE_URL: '' })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
})

test('finds compiled values in nested export files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-public-env-'))
  try {
    mkdirSync(join(dir, '_next', 'static'), { recursive: true })
    writeFileSync(join(dir, '_next', 'static', 'app.js'), 'const p="uv-activity-planner"')
    assert.equal(exportContains(dir, 'uv-activity-planner'), true)
    assert.equal(exportContains(dir, 'missing-value'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

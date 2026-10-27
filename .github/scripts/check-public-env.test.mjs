import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkEnv, checkExport, exportContains, isSentryDsn } from './check-public-env.mjs'
import { removeSourceMaps, stripSourceMapComments } from './remove-source-maps.mjs'

const complete = {
  FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public-web-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'uv-activity-planner.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'uv-activity-planner',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
  NEXT_PUBLIC_SITE_URL: 'https://solara-uv.web.app',
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
    checkEnv({ ...complete, NEXT_PUBLIC_BILLING_ENABLED: '1' }).errors.join('\n'),
    /NEXT_PUBLIC_BILLING_ENABLED is set but Functions are not deployed/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_BILLING_ENABLED: 'true' }).errors.join('\n'),
    /must be '1' or empty/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_FUNCTIONS_URL: 'https://fn.example.com' }).errors.join(
      '\n',
    ),
    /Functions are not deployed/,
  )
})

test('rejects secrets in public values', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_GA_MEASUREMENT_ID: 'sk_live_abc123' })
  assert.match(errors.join('\n'), /NEXT_PUBLIC_GA_MEASUREMENT_ID looks like a Stripe secret/)
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

const DSN = 'https://abc123public@o11.ingest.us.sentry.io/22'

test('accepts only Sentry public DSNs', () => {
  assert.equal(isSentryDsn(DSN), true)
  assert.equal(isSentryDsn('http://abc@o1.ingest.sentry.io/2'), false)
  assert.equal(isSentryDsn('https://o1.ingest.sentry.io/2'), false)
  assert.equal(isSentryDsn('https://abc:secret@o1.ingest.sentry.io/2'), false)
  assert.equal(isSentryDsn('https://abc@o1.ingest.sentry.io/'), false)
  assert.deepEqual(checkEnv({ ...complete, NEXT_PUBLIC_SENTRY_DSN: DSN }).errors, [])
  assert.match(
    checkEnv({
      ...complete,
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc:secret@o1.ingest.sentry.io/2',
    }).errors.join('\n'),
    /not a Sentry public DSN/,
  )
})

test('rejects a Sentry auth token in a public value', () => {
  const { errors } = checkEnv({ ...complete, NEXT_PUBLIC_SENTRY_DSN: 'sntrys_abc' })
  assert.match(errors.join('\n'), /looks like a Sentry auth token/)
})

/** Writes `files` into a temporary export and runs `fn` with its path. */
function withExport(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'check-export-'))
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('refuses published source maps and their comments', () => {
  const errors = withExport(
    {
      '_next/static/chunks/a.js': 'let a=1\n//# sourceMappingURL=a.js.map',
      '_next/static/chunks/a.js.map': '{}',
    },
    dir => checkExport(dir, {}),
  )
  assert.match(errors.join('\n'), /1 source map\(s\)/)
  assert.match(errors.join('\n'), /still reference a source map/)
})

test('removes source maps and their comments, leaving the code', () => {
  assert.equal(
    stripSourceMapComments('let a=1\n//# sourceMappingURL=a.js.map\n//# debugId=x\n'),
    'let a=1\n//# debugId=x\n',
  )
  assert.equal(stripSourceMapComments('a{}\n/*# sourceMappingURL=a.css.map*/'), 'a{}\n')
  withExport(
    {
      '_next/static/chunks/a.js': 'let a=1\n//# sourceMappingURL=a.js.map',
      '_next/static/chunks/a.js.map': '{}',
      '_next/static/chunks/b.css': 'b{}\n/*# sourceMappingURL=b.css.map*/',
      '_next/static/chunks/b.css.map': '{}',
    },
    dir => {
      assert.deepEqual(removeSourceMaps(dir), { maps: 2, files: 2 })
      assert.deepEqual(checkExport(dir, {}), [])
    },
  )
})

test('refuses Sentry code in a build without a DSN, and a DSN that was not compiled in', () => {
  const sentryChunk = { '_next/static/chunks/s.js': 'g.__SENTRY__=g.__SENTRY__||{}' }
  assert.match(
    withExport(sentryChunk, dir => checkExport(dir, {})).join('\n'),
    /contains Sentry SDK code/,
  )
  assert.match(
    withExport(sentryChunk, dir => checkExport(dir, { NEXT_PUBLIC_SENTRY_DSN: DSN })).join('\n'),
    /NEXT_PUBLIC_SENTRY_DSN is not compiled into/,
  )
  assert.deepEqual(
    withExport({ ...sentryChunk, '_next/static/chunks/c.js': `init({dsn:"${DSN}"})` }, dir =>
      checkExport(dir, { NEXT_PUBLIC_SENTRY_DSN: DSN }),
    ),
    [],
  )
})

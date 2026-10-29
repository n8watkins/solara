import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  checkEnv,
  checkExport,
  checkStagingExport,
  exportContains,
  isSentryDsn,
  pointsAtProduction,
} from './check-public-env.mjs'
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
    checkEnv({ ...complete, NEXT_PUBLIC_FORECAST_PROXY: '1' }).errors.join('\n'),
    /NEXT_PUBLIC_FORECAST_PROXY is set but Functions are not deployed/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_ALERTS_ENABLED: '1' }).errors.join('\n'),
    /NEXT_PUBLIC_ALERTS_ENABLED is set but Functions are not deployed/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED: '1' }).errors.join('\n'),
    /NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED is set but Functions are not deployed/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_FUNCTIONS_URL: 'https://fn.example.com' }).errors.join(
      '\n',
    ),
    /Functions are not deployed/,
  )
})

const functionsOn = {
  ...complete,
  ENABLE_BLAZE_FUNCTIONS: 'true',
  NEXT_PUBLIC_FUNCTIONS_URL: 'https://us-central1-uv-activity-planner.cloudfunctions.net',
  NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lc-public-site-key',
}

test('refuses Functions without the App Check site key (REVIEW8 PLAN M3)', () => {
  assert.deepEqual(checkEnv(functionsOn), { errors: [], warnings: [] })
  assert.match(
    checkEnv({ ...functionsOn, NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: ' ' }).errors.join('\n'),
    /ENABLE_BLAZE_FUNCTIONS is true but NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY is empty/,
  )
  // A site key without Functions is fine: App Check protects Firestore on its own.
  assert.deepEqual(
    checkEnv({ ...complete, NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lc-public-site-key' })
      .errors,
    [],
  )
})

test('refuses alerts without the web push (VAPID) key (REVIEW8 PLAN M3)', () => {
  const alertsOn = { ...functionsOn, NEXT_PUBLIC_ALERTS_ENABLED: '1' }
  assert.match(
    checkEnv(alertsOn).errors.join('\n'),
    /NEXT_PUBLIC_ALERTS_ENABLED is set but NEXT_PUBLIC_FIREBASE_VAPID_KEY is empty/,
  )
  assert.deepEqual(
    checkEnv({ ...alertsOn, NEXT_PUBLIC_FIREBASE_VAPID_KEY: 'BPublicVapidKey' }).errors,
    [],
  )
})

test('refuses an App Check debug token in a deployed build (REVIEW8 SEC L9)', () => {
  assert.match(
    checkEnv({
      ...functionsOn,
      NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: 'debug-uuid',
    }).errors.join('\n'),
    /NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN is set/,
  )
  assert.deepEqual(
    checkEnv({ ...complete, NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: '' }).errors,
    [],
  )
})

test('shows events from Google Calendar only with the OAuth client ID', () => {
  const on = { ...complete, NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: '1' }
  assert.match(
    checkEnv(on).errors.join('\n'),
    /NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED is set but NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is empty/,
  )
  // No Functions needed: the browser reads the calendar itself.
  assert.deepEqual(
    checkEnv({ ...on, NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: 'id.apps.googleusercontent.com' }).errors,
    [],
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: 'yes' }).errors.join('\n'),
    /NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED must be '1' or empty/,
  )
})

test('shows events from Outlook only with a Microsoft client ID', () => {
  const on = { ...complete, NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: '1' }
  assert.match(
    checkEnv(on).errors.join('\n'),
    /NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED is set but NEXT_PUBLIC_MICROSOFT_CLIENT_ID is empty/,
  )
  // No Functions needed: the browser reads the calendar itself.
  const id = '6731de76-14a6-49ae-97bc-6eba6914391e'
  assert.deepEqual(checkEnv({ ...on, NEXT_PUBLIC_MICROSOFT_CLIENT_ID: id }).errors, [])
  // The client ID alone is allowed (the feature stays hidden).
  assert.deepEqual(checkEnv({ ...complete, NEXT_PUBLIC_MICROSOFT_CLIENT_ID: id }).errors, [])
  assert.match(
    checkEnv({ ...on, NEXT_PUBLIC_MICROSOFT_CLIENT_ID: 'solara' }).errors.join('\n'),
    /NEXT_PUBLIC_MICROSOFT_CLIENT_ID is not an Application \(client\) ID/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: 'true' }).errors.join(
      '\n',
    ),
    /NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED must be '1' or empty/,
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

const staging = {
  FIREBASE_PROJECT_ID: 'solara-staging',
  NEXT_PUBLIC_DEPLOY_ENVIRONMENT: 'staging',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-staging-web-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'solara-staging.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'solara-staging',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'solara-staging.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:456:web:def',
  NEXT_PUBLIC_SITE_URL: 'https://solara-staging.web.app',
  PRODUCTION_NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public-web-key',
  PRODUCTION_NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
}

test('accepts a complete staging configuration', () => {
  assert.deepEqual(checkEnv(staging), { errors: [], warnings: [] })
  assert.deepEqual(
    checkEnv({
      ...staging,
      ENABLE_BLAZE_FUNCTIONS: 'true',
      NEXT_PUBLIC_FUNCTIONS_URL: 'https://us-central1-solara-staging.cloudfunctions.net',
      NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lstaging',
    }).errors,
    [],
  )
})

test('refuses a staging build that deploys to production', () => {
  const { errors } = checkEnv({
    ...staging,
    FIREBASE_PROJECT_ID: 'uv-activity-planner',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'uv-activity-planner',
  })
  assert.match(errors.join('\n'), /cannot deploy to production's project uv-activity-planner/)
})

test('refuses a staging build pointed at any production value', () => {
  for (const [key, raw] of [
    ['NEXT_PUBLIC_SITE_URL', 'https://solara-uv.web.app'],
    ['NEXT_PUBLIC_SITE_URL', 'https://uv-activity-planner.web.app/'],
    ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'uv-activity-planner.firebaseapp.com'],
    ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'solara-uv.firebaseapp.com'],
    ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'uv-activity-planner.appspot.com'],
    ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'uv-activity-planner.firebasestorage.app'],
  ]) {
    const { errors } = checkEnv({ ...staging, [key]: raw })
    assert.ok(
      errors.some(error => error.startsWith(`${key} points at production`)),
      `${key}=${raw}`,
    )
  }
  const functions = checkEnv({
    ...staging,
    ENABLE_BLAZE_FUNCTIONS: 'true',
    NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lstaging',
    NEXT_PUBLIC_FUNCTIONS_URL: 'https://europe-west1-uv-activity-planner.cloudfunctions.net',
  }).errors.join('\n')
  assert.match(functions, /NEXT_PUBLIC_FUNCTIONS_URL points at production/)
  assert.match(functions, /not this build's project solara-staging/)
})

test("refuses a staging build that reuses production's keys", () => {
  const { errors } = checkEnv({
    ...staging,
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public-web-key',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
  })
  assert.match(errors.join('\n'), /NEXT_PUBLIC_FIREBASE_API_KEY is production's value/)
  assert.match(errors.join('\n'), /NEXT_PUBLIC_FIREBASE_APP_ID is production's value/)
})

test('a staging build must name its own site', () => {
  const { errors } = checkEnv({ ...staging, NEXT_PUBLIC_SITE_URL: '' })
  assert.match(errors.join('\n'), /a staging build must name its own site/)
})

test('staging names may contain production names without being production', () => {
  assert.equal(pointsAtProduction('https://solara-uv-staging.web.app'), false)
  assert.equal(pointsAtProduction('uv-activity-planner-staging'), false)
  assert.equal(
    pointsAtProduction('https://us-central1-uv-activity-planner.cloudfunctions.net'),
    true,
  )
  assert.equal(pointsAtProduction('uv-activity-planner'), true)
})

test('only staging or production may be named as the deploy environment', () => {
  assert.match(
    checkEnv({ ...staging, NEXT_PUBLIC_DEPLOY_ENVIRONMENT: 'preview' }).errors.join('\n'),
    /must be 'staging' or empty/,
  )
  assert.match(
    checkEnv({ ...complete, NEXT_PUBLIC_DEPLOY_ENVIRONMENT: 'production' }).errors.join('\n'),
    /must be 'staging' or empty/,
  )
})

test("refuses a production build that calls another project's Functions", () => {
  const { errors } = checkEnv({
    ...complete,
    ENABLE_BLAZE_FUNCTIONS: 'true',
    NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lproduction',
    NEXT_PUBLIC_FUNCTIONS_URL: 'https://us-central1-solara-staging.cloudfunctions.net',
  })
  assert.match(errors.join('\n'), /not this build's project uv-activity-planner/)
})

test('finds production values compiled into a staging export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'staging-export-'))
  try {
    writeFileSync(join(dir, 'index.html'), '<a href="https://solara-staging.web.app/">x</a>')
    assert.deepEqual(checkStagingExport(dir), [])
    writeFileSync(join(dir, 'app.js'), 'const c={projectId:"uv-activity-planner"}')
    assert.match(checkStagingExport(dir).join('\n'), /contains production's uv-activity-planner/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

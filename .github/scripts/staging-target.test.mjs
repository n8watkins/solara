// The staging deploy's settings (deploy-staging.yml): project to site and URL mapping,
// the guards that keep production's values out, and parity with deploy.yml.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dotenv, resolve } from './staging-target.mjs'

const minimal = {
  STAGING_FIREBASE_PROJECT_ID: 'solara-staging',
  STAGING_NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-staging',
  STAGING_NEXT_PUBLIC_FIREBASE_APP_ID: '1:456:web:def',
  STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER:
    'projects/1/locations/global/workloadIdentityPools/github/providers/github',
  STAGING_GCP_DEPLOY_SERVICE_ACCOUNT: 'deploy@solara-staging.iam.gserviceaccount.com',
}
// Production's repository variables, which a staging job also sees.
const production = {
  NEXT_PUBLIC_SITE_URL: 'https://solara-uv.web.app',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-production',
  GCP_DEPLOY_SERVICE_ACCOUNT: 'deploy@uv-activity-planner.iam.gserviceaccount.com',
}

const errorsOf = (vars, options) => resolve({ ...production, ...vars }, options).errors.join('\n')

test('skips cleanly while the staging project is not set', () => {
  const result = resolve(production)
  assert.equal(result.configured, false)
  assert.match(result.reason, /no STAGING_FIREBASE_PROJECT_ID variable/)
})

test('maps the staging project to its own site, origin and Functions', () => {
  const result = resolve({ ...production, ...minimal })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.target, {
    projectId: 'solara-staging',
    site: 'solara-staging',
    appUrl: 'https://solara-staging.web.app',
    channel: 'live',
    functions: false,
  })
  assert.equal(result.buildEnv.NEXT_PUBLIC_DEPLOY_ENVIRONMENT, 'staging')
  assert.equal(result.buildEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'solara-staging')
  assert.equal(result.buildEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, 'solara-staging.firebaseapp.com')
  assert.equal(
    result.buildEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    'solara-staging.firebasestorage.app',
  )
  assert.equal(result.buildEnv.NEXT_PUBLIC_SITE_URL, 'https://solara-staging.web.app')
  assert.equal(result.buildEnv.NEXT_PUBLIC_FUNCTIONS_URL, '')
  assert.equal(result.functionsParams.APP_URL, 'https://solara-staging.web.app')
})

test('a configurable project and site', () => {
  const { target, buildEnv, functionsParams } = resolve({
    ...minimal,
    STAGING_FIREBASE_PROJECT_ID: 'solara-uv-staging',
    STAGING_HOSTING_SITE: 'solara-stage',
    STAGING_ENABLE_BLAZE_FUNCTIONS: 'true',
    STAGING_NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '6Lstaging',
  })
  assert.equal(target.site, 'solara-stage')
  assert.equal(functionsParams.APP_URL, 'https://solara-stage.web.app')
  assert.equal(
    buildEnv.NEXT_PUBLIC_FUNCTIONS_URL,
    'https://us-central1-solara-uv-staging.cloudfunctions.net',
  )
})

test('refuses production as the staging project or site', () => {
  assert.match(
    errorsOf({ ...minimal, STAGING_FIREBASE_PROJECT_ID: 'uv-activity-planner' }),
    /production's project/,
  )
  for (const site of ['solara-uv', 'uv-activity-planner']) {
    assert.match(errorsOf({ ...minimal, STAGING_HOSTING_SITE: site }), /one of production's sites/)
  }
})

test("refuses a staging value pointed at production or equal to production's", () => {
  assert.match(
    errorsOf({
      ...minimal,
      STAGING_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'uv-activity-planner.firebaseapp.com',
    }),
    /NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN points at production/,
  )
  // A production value from a repository variable, and one still kept in a secret.
  assert.match(
    errorsOf({ ...minimal, STAGING_NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-production' }),
    /STAGING_NEXT_PUBLIC_FIREBASE_API_KEY is production's value/,
  )
  assert.match(
    errorsOf(
      { ...minimal, STAGING_NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc' },
      { production: { NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc' } },
    ),
    /STAGING_NEXT_PUBLIC_FIREBASE_APP_ID is production's value/,
  )
})

test('never reads production names: a missing staging value stays missing', () => {
  const result = resolve({
    ...production,
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
    NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-PRODUCTION',
    STAGING_FIREBASE_PROJECT_ID: 'solara-staging',
    STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER: minimal.STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER,
    STAGING_GCP_DEPLOY_SERVICE_ACCOUNT: minimal.STAGING_GCP_DEPLOY_SERVICE_ACCOUNT,
  })
  assert.equal(result.buildEnv.NEXT_PUBLIC_FIREBASE_API_KEY, '')
  assert.equal(result.buildEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID, '')
  assert.match(result.errors.join('\n'), /STAGING_NEXT_PUBLIC_FIREBASE_API_KEY is not set/)
  assert.match(result.errors.join('\n'), /STAGING_NEXT_PUBLIC_FIREBASE_APP_ID is not set/)
})

test('needs staging credentials, never production service accounts', () => {
  const { STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER: _p, ...withoutProvider } = minimal
  assert.match(errorsOf(withoutProvider), /No staging credentials/)
  assert.equal(errorsOf(withoutProvider, { hasKey: true }), '')
  assert.match(
    errorsOf({ ...minimal, STAGING_GCP_DEPLOY_SERVICE_ACCOUNT: '' }),
    /without STAGING_GCP_DEPLOY_SERVICE_ACCOUNT/,
  )
  for (const account of [
    'deploy@uv-activity-planner.iam.gserviceaccount.com',
    'other@uv-activity-planner.iam.gserviceaccount.com',
  ]) {
    assert.match(
      errorsOf({ ...minimal, STAGING_GCP_DEPLOY_SERVICE_ACCOUNT: account }),
      /is a production service account/,
    )
  }
  assert.match(
    errorsOf({
      ...minimal,
      STAGING_BUDGET_SERVICE_ACCOUNT: 'budget-guard@uv-activity-planner.iam.gserviceaccount.com',
    }),
    /STAGING_BUDGET_SERVICE_ACCOUNT .* is a production service account/,
  )
})

test('feature switches follow the Functions switch, as in deploy.yml', () => {
  const switches = {
    STAGING_BILLING_ENABLED: 'true',
    STAGING_FORECAST_PROXY_ENABLED: 'true',
    STAGING_ALERTS_ENABLED: 'true',
    STAGING_EVENTS_SUBSCRIPTIONS_ENABLED: 'true',
    STAGING_STRIPE_PRICE_ID: 'price_m',
    STAGING_STRIPE_YEARLY_PRICE_ID: 'price_y',
  }
  const off = resolve({ ...minimal, ...switches }).buildEnv
  for (const key of [
    'NEXT_PUBLIC_BILLING_ENABLED',
    'NEXT_PUBLIC_FORECAST_PROXY',
    'NEXT_PUBLIC_ALERTS_ENABLED',
    'NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED',
  ]) {
    assert.equal(off[key], '', key)
  }
  const on = resolve({ ...minimal, ...switches, STAGING_ENABLE_BLAZE_FUNCTIONS: 'true' })
  assert.equal(on.buildEnv.NEXT_PUBLIC_BILLING_ENABLED, '1')
  assert.equal(on.buildEnv.NEXT_PUBLIC_ALERTS_ENABLED, '1')
  assert.equal(on.functionsParams.BILLING_ENABLED, 'true')
  assert.equal(on.functionsParams.COST_GUARD_DETACH_BILLING, 'true')
  assert.match(
    errorsOf({
      ...minimal,
      ...switches,
      STAGING_ENABLE_BLAZE_FUNCTIONS: 'true',
      STAGING_STRIPE_PRICE_ID: '',
    }),
    /STAGING_STRIPE_PRICE_ID and STAGING_STRIPE_YEARLY_PRICE_ID/,
  )
})

test('a Sentry release only with a DSN, and preview channel names', () => {
  assert.equal(resolve(minimal, { commit: 'abc' }).buildEnv.NEXT_PUBLIC_SENTRY_RELEASE, '')
  assert.equal(
    resolve(
      { ...minimal, STAGING_NEXT_PUBLIC_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/2' },
      { commit: 'abc' },
    ).buildEnv.NEXT_PUBLIC_SENTRY_RELEASE,
    'abc',
  )
  assert.equal(resolve(minimal, { channel: 'pr-152' }).target.channel, 'pr-152')
  assert.match(errorsOf(minimal, { channel: 'PR 152' }), /preview channel/)
})

test('only main deploys the live staging site; any branch a preview', () => {
  assert.equal(errorsOf(minimal, { ref: 'refs/heads/main' }), '')
  assert.match(errorsOf(minimal, { ref: 'refs/heads/feature' }), /Only main deploys the live/)
  assert.match(
    errorsOf(minimal, { ref: 'refs/heads/feature', channel: ' live ' }),
    /Only main deploys the live/,
  )
  assert.equal(errorsOf(minimal, { ref: 'refs/heads/feature', channel: 'pr-152' }), '')
})

test('refuses line breaks, which could add lines to the build environment', () => {
  assert.match(
    errorsOf({ ...minimal, STAGING_NEXT_PUBLIC_FIREBASE_API_KEY: 'a\nNODE_OPTIONS=--x' }),
    /contains a line break/,
  )
})

// Parity: every value deploy.yml compiles in or writes for the Functions has a staging one.
const deployWorkflow = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')

test('builds with every public value deploy.yml compiles in', () => {
  const production = new Set(
    [...deployWorkflow.matchAll(/^ {6}(NEXT_PUBLIC_[A-Z0-9_]+):/gm)].map(match => match[1]),
  )
  const staging = Object.keys(resolve(minimal).buildEnv).filter(key =>
    key.startsWith('NEXT_PUBLIC_'),
  )
  assert.ok(production.size > 20)
  assert.deepEqual(
    [...production].sort(),
    staging.filter(key => key !== 'NEXT_PUBLIC_DEPLOY_ENVIRONMENT').sort(),
  )
})

test('writes every Functions param deploy.yml writes, plus APP_URL', () => {
  const production = [...deployWorkflow.matchAll(/printf '([A-Z_]+)=%s\\n'/g)].map(
    match => match[1],
  )
  assert.ok(production.length > 10)
  assert.deepEqual(
    [...production, 'APP_URL'].sort(),
    Object.keys(resolve(minimal).functionsParams).sort(),
  )
})

test('the command writes outputs, or a skip notice, and the Functions params file', () => {
  const script = fileURLToPath(new URL('./staging-target.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'staging-target-'))
  const run = (vars, args = []) =>
    execFileSync(process.execPath, [script, ...args], {
      env: {
        PATH: process.env.PATH,
        VARS: JSON.stringify(vars),
        GITHUB_OUTPUT: join(dir, 'output'),
        GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      },
      encoding: 'utf8',
    })
  try {
    assert.match(run(production), /::notice::Staging is not set up/)
    assert.match(readFileSync(join(dir, 'output'), 'utf8'), /^configured<<EOF_\w+\nfalse\n/)
    rmSync(join(dir, 'output'))

    assert.match(run(minimal, ['--check', '--commit', 'abc']), /Staging: project solara-staging/)
    const outputs = readFileSync(join(dir, 'output'), 'utf8')
    assert.match(outputs, /configured<<(EOF_\w+)\ntrue\n\1\n/)
    assert.match(
      outputs,
      /build-env<<(EOF_\w+)\n[^]*NEXT_PUBLIC_DEPLOY_ENVIRONMENT=staging\n[^]*\1\n/,
    )

    run(minimal, ['--functions-env', join(dir, 'env')])
    assert.equal(readFileSync(join(dir, 'env'), 'utf8'), dotenv(resolve(minimal).functionsParams))
    assert.match(
      readFileSync(join(dir, 'env'), 'utf8'),
      /^APP_URL=https:\/\/solara-staging\.web\.app$/m,
    )

    assert.throws(
      () => run({ ...minimal, STAGING_FIREBASE_PROJECT_ID: 'uv-activity-planner' }),
      error => /::error::STAGING_FIREBASE_PROJECT_ID is production's project/.test(error.stdout),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

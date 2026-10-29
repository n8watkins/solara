#!/usr/bin/env node
// Resolves and checks a staging deploy (deploy-staging.yml) from the `staging` GitHub
// environment's variables, so nothing about production can reach it.
//
// Every staging setting is a variable named STAGING_<name> in the `staging`
// environment. They never share a name with production's repository variables,
// because a job in an environment falls back to the repository's variable or secret of
// the same name when the environment has none: a missing staging value can only be
// missing, never production's. Production's values are read too, only to refuse any
// staging value that equals one of them.
//
// Usage (in the workflow):
//   node .github/scripts/staging-target.mjs --check [--commit <sha>] [--channel <id>]
//       writes configured, project, site, app-url, functions, channel and build-env to
//       $GITHUB_OUTPUT; exits 0 with configured=false when staging is not set up
//   node .github/scripts/staging-target.mjs --functions-env <file>
//       writes the staging project's Functions params (APP_URL included) to <file>
//
// Environment:
//   VARS                 toJSON(vars): the staging environment's and the repository's
//                        variables (production's NEXT_PUBLIC_* and GCP_* among them)
//   PRODUCTION_<key>     production's public values that live in secrets (the fallback
//                        deploy.yml still reads), compared like the variables
//   HAS_STAGING_KEY      'true' when the STAGING_FIREBASE_SERVICE_ACCOUNT secret is set
import { appendFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { PRODUCTION, PROJECT_VALUE_KEYS, pointsAtProduction } from './check-public-env.mjs'

/** A Google Cloud project id (also the default Hosting site name). */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

/** A Hosting preview channel id; `live` is the staging site itself. */
const CHANNEL = /^[a-z0-9][a-z0-9-]{0,19}$/

/** The region the Functions deploy to (functions/src, and production.json's URL). */
export const FUNCTIONS_REGION = 'us-central1'

/**
 * The staging setting for each build value deploy.yml compiles in, read from the
 * STAGING_<name> variable. Values derived from the project are added in resolve().
 */
const PASSED_THROUGH = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
  'NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY',
  'NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER',
  'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'NEXT_PUBLIC_SENTRY_DSN',
]

/** Required staging variables, beyond STAGING_FIREBASE_PROJECT_ID. */
const REQUIRED = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_APP_ID']

/**
 * Resolves the staging target. Pure, for tests.
 * @param {Record<string, string | undefined>} vars the variables (toJSON(vars))
 * @param {{ production?: Record<string, string | undefined>, hasKey?: boolean,
 *   commit?: string, channel?: string }} [options]
 *   production: production's public values from secrets, by NEXT_PUBLIC_* name
 */
export function resolve(vars, options = {}) {
  const value = key => String(vars[key] ?? '').trim()
  const staging = key => value(`STAGING_${key}`)
  const on = key => staging(key) === 'true'
  const errors = []
  const warnings = []

  const projectId = staging('FIREBASE_PROJECT_ID')
  if (!projectId) {
    return {
      configured: false,
      reason:
        'Staging is not set up: the staging environment has no STAGING_FIREBASE_PROJECT_ID variable (docs/DEPLOYMENT.md, Staging).',
    }
  }
  if (!PROJECT_ID.test(projectId))
    errors.push(`STAGING_FIREBASE_PROJECT_ID (${projectId}) is not a project id.`)
  if (projectId === PRODUCTION.projectId) {
    errors.push(`STAGING_FIREBASE_PROJECT_ID is production's project ${projectId}.`)
  }

  const site = staging('HOSTING_SITE') || projectId
  if (!PROJECT_ID.test(site))
    errors.push(`STAGING_HOSTING_SITE (${site}) is not a Hosting site name.`)
  if (PRODUCTION.hostingSites.includes(site)) {
    errors.push(`The staging Hosting site ${site} is one of production's sites.`)
  }
  const appUrl = `https://${site}.web.app`

  const channel = options.channel?.trim() || 'live'
  if (channel !== 'live' && !CHANNEL.test(channel)) {
    errors.push(
      `The preview channel "${channel}" must be up to 20 lowercase letters, digits and hyphens.`,
    )
  }

  for (const key of REQUIRED) {
    if (!staging(key)) errors.push(`STAGING_${key} is not set in the staging environment.`)
  }

  const functions = on('ENABLE_BLAZE_FUNCTIONS')
  const withFunctions = key => (functions && on(key) ? '1' : '')
  const dsn = staging('NEXT_PUBLIC_SENTRY_DSN')
  const microsoftClientId = staging('MICROSOFT_CLIENT_ID')
  const buildEnv = {
    FIREBASE_PROJECT_ID: projectId,
    ENABLE_BLAZE_FUNCTIONS: functions ? 'true' : '',
    NEXT_PUBLIC_DEPLOY_ENVIRONMENT: 'staging',
    ...Object.fromEntries(PASSED_THROUGH.map(key => [key, staging(key)])),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      staging('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
      staging('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') || `${projectId}.firebasestorage.app`,
    NEXT_PUBLIC_SITE_URL: appUrl,
    NEXT_PUBLIC_SENTRY_RELEASE: dsn ? (options.commit ?? '') : '',
    NEXT_PUBLIC_FUNCTIONS_URL: functions
      ? `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`
      : '',
    NEXT_PUBLIC_BILLING_ENABLED: withFunctions('BILLING_ENABLED'),
    NEXT_PUBLIC_FORECAST_PROXY: withFunctions('FORECAST_PROXY_ENABLED'),
    NEXT_PUBLIC_ALERTS_ENABLED: withFunctions('ALERTS_ENABLED'),
    NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED: withFunctions('EVENTS_SUBSCRIPTIONS_ENABLED'),
    NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: on('GOOGLE_CALENDAR_EVENTS_ENABLED') ? '1' : '',
    NEXT_PUBLIC_MICROSOFT_CLIENT_ID: microsoftClientId,
    NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: on('OUTLOOK_CALENDAR_EVENTS_ENABLED') ? '1' : '',
  }

  for (const [key, raw] of Object.entries(buildEnv)) {
    if (/[\r\n]/.test(raw)) errors.push(`The staging value for ${key} contains a line break.`)
    if (key.startsWith('NEXT_PUBLIC_') && raw && pointsAtProduction(raw)) {
      errors.push(`The staging value for ${key} points at production (${raw}).`)
    }
  }
  const production = key => value(key) || String(options.production?.[key] ?? '').trim()
  for (const key of PROJECT_VALUE_KEYS) {
    if (buildEnv[key] && buildEnv[key] === production(key)) {
      errors.push(`STAGING_${key} is production's value; use the staging project's own.`)
    }
  }

  const functionsParams = {
    APP_URL: appUrl,
    STRIPE_PRICE_ID: staging('STRIPE_PRICE_ID'),
    STRIPE_YEARLY_PRICE_ID: staging('STRIPE_YEARLY_PRICE_ID'),
    BILLING_ENABLED: String(on('BILLING_ENABLED')),
    FORECAST_PROXY_ENABLED: String(on('FORECAST_PROXY_ENABLED')),
    COST_GUARD_DETACH_BILLING: String(staging('COST_GUARD_DETACH_BILLING') !== 'false'),
    BUDGET_ID: staging('BUDGET_ID'),
    BUDGET_SERVICE_ACCOUNT: staging('BUDGET_SERVICE_ACCOUNT'),
    ALERTS_ENABLED: String(on('ALERTS_ENABLED')),
    ALERTS_SERVICE_ACCOUNT: staging('ALERTS_SERVICE_ACCOUNT'),
    EVENTS_SUBSCRIPTIONS_ENABLED: String(on('EVENTS_SUBSCRIPTIONS_ENABLED')),
    GOOGLE_CALENDAR_EVENTS_ENABLED: String(on('GOOGLE_CALENDAR_EVENTS_ENABLED')),
    OUTLOOK_CALENDAR_EVENTS_ENABLED: String(on('OUTLOOK_CALENDAR_EVENTS_ENABLED')),
  }
  for (const [key, raw] of Object.entries(functionsParams)) {
    if (/[\r\n]/.test(raw)) errors.push(`The staging value for ${key} contains a line break.`)
  }
  if (functions) {
    if (
      functionsParams.BILLING_ENABLED === 'true' &&
      (!functionsParams.STRIPE_PRICE_ID || !functionsParams.STRIPE_YEARLY_PRICE_ID)
    ) {
      errors.push(
        'Set STAGING_STRIPE_PRICE_ID and STAGING_STRIPE_YEARLY_PRICE_ID (Stripe test mode) before switching staging billing on.',
      )
    }
    if (
      functionsParams.COST_GUARD_DETACH_BILLING === 'true' &&
      !functionsParams.BUDGET_SERVICE_ACCOUNT
    ) {
      warnings.push(
        "Staging's budget kill switch cannot detach billing until STAGING_BUDGET_SERVICE_ACCOUNT is set (infra/budget.sh for the staging project).",
      )
    }
    if (!functionsParams.BUDGET_ID) {
      warnings.push(
        "Set STAGING_BUDGET_ID so staging's kill switch acts only on the staging budget (infra/budget.sh prints it).",
      )
    }
  }

  // Credentials: the staging deploy identity, never production's.
  const provider = staging('GCP_WORKLOAD_IDENTITY_PROVIDER')
  const deployAccount = staging('GCP_DEPLOY_SERVICE_ACCOUNT')
  if (provider && !deployAccount) {
    errors.push(
      'STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER is set without STAGING_GCP_DEPLOY_SERVICE_ACCOUNT.',
    )
  }
  if (!provider && !options.hasKey) {
    errors.push(
      'No staging credentials: set STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER and STAGING_GCP_DEPLOY_SERVICE_ACCOUNT (docs/WIF_SETUP.md), or the STAGING_FIREBASE_SERVICE_ACCOUNT secret.',
    )
  }
  const productionAccounts = [
    'GCP_DEPLOY_SERVICE_ACCOUNT',
    'BUDGET_SERVICE_ACCOUNT',
    'ALERTS_SERVICE_ACCOUNT',
  ]
    .map(value)
    .filter(Boolean)
  for (const key of [
    'GCP_DEPLOY_SERVICE_ACCOUNT',
    'BUDGET_SERVICE_ACCOUNT',
    'ALERTS_SERVICE_ACCOUNT',
  ]) {
    const account = staging(key)
    if (!account) continue
    if (
      account.endsWith(`@${PRODUCTION.projectId}.iam.gserviceaccount.com`) ||
      productionAccounts.includes(account)
    ) {
      errors.push(`STAGING_${key} (${account}) is a production service account.`)
    }
  }

  return {
    configured: true,
    errors,
    warnings,
    target: { projectId, site, appUrl, channel, functions },
    buildEnv,
    functionsParams,
  }
}

/** `KEY=value` lines. */
export const dotenv = values =>
  Object.entries(values)
    .map(([key, raw]) => `${key}=${raw}`)
    .join('\n') + '\n'

/** Production's public values that may still be repository secrets, by NEXT_PUBLIC_* name. */
function productionFromEnv(env) {
  return Object.fromEntries(PROJECT_VALUE_KEYS.map(key => [key, env[`PRODUCTION_${key}`] ?? '']))
}

function output(name, raw) {
  if (!process.env.GITHUB_OUTPUT) return
  const delimiter = `EOF_${randomBytes(8).toString('hex')}`
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${raw}\n${delimiter}\n`)
}

function main(argv) {
  const arg = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const result = resolve(JSON.parse(process.env.VARS || '{}'), {
    production: productionFromEnv(process.env),
    hasKey: process.env.HAS_STAGING_KEY === 'true',
    commit: arg('--commit'),
    channel: arg('--channel'),
  })
  if (!result.configured) {
    console.log(`::notice::${result.reason} Nothing was deployed.`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Staging skipped\n\n${result.reason}\n`)
    }
    output('configured', 'false')
    return
  }
  for (const warning of result.warnings) console.log(`::warning::${warning}`)
  for (const error of result.errors) console.log(`::error::${error}`)
  if (result.errors.length > 0) process.exit(1)

  const functionsEnv = arg('--functions-env')
  if (functionsEnv) {
    writeFileSync(functionsEnv, dotenv(result.functionsParams))
    console.log(`Wrote the staging Functions params to ${functionsEnv}.`)
    return
  }
  const { target } = result
  output('configured', 'true')
  output('project', target.projectId)
  output('site', target.site)
  output('app-url', target.appUrl)
  output('channel', target.channel)
  output('functions', String(target.functions))
  output('build-env', dotenv(result.buildEnv).trimEnd())
  console.log(
    `Staging: project ${target.projectId}, site ${target.site} (${target.appUrl}), channel ${target.channel}, Functions ${target.functions ? 'on' : 'off'}.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))

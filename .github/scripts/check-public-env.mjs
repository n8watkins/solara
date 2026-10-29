#!/usr/bin/env node
// Checks the public NEXT_PUBLIC_* build configuration for a deployed build:
// production (deploy.yml) or staging (deploy-staging.yml, which sets
// NEXT_PUBLIC_DEPLOY_ENVIRONMENT=staging).
//
// A static export bakes NEXT_PUBLIC_* values in at build time, so a missing or
// wrong value ships silently. Run this before `npm run build` with the same
// environment, and again with `--built <dir>` after it to prove the values made
// it into the bundle.
//
// Usage:
//   node .github/scripts/check-public-env.mjs
//   node .github/scripts/check-public-env.mjs --built out
//
// Environment:
//   FIREBASE_PROJECT_ID     the project this build deploys to (required)
//   ENABLE_BLAZE_FUNCTIONS  'true' when Functions are deployed
//   NEXT_PUBLIC_BILLING_ENABLED  '1' when Pro checkout replaces the waitlist
//   NEXT_PUBLIC_FORECAST_PROXY   '1' when forecasts come through the forecast proxy
//   NEXT_PUBLIC_ALERTS_ENABLED   '1' when Settings offers Pro morning and UV alerts
//   NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED  '1' when the Events section offers linked calendars
//   NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED  '1' when it shows events from Google Calendar
//   NEXT_PUBLIC_MICROSOFT_CLIENT_ID  the Azure app's (public) Application ID, a GUID
//   NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED  '1' when it shows events from Outlook
//   NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY  required with Functions, which refuse requests without App Check
//   NEXT_PUBLIC_FIREBASE_VAPID_KEY  required with alerts, which need web push
//   NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN  refused: it would let anyone pass App Check
//   NEXT_PUBLIC_DEPLOY_ENVIRONMENT  'staging' for a staging build, empty for production;
//                           a staging build is refused when it points at production
//                           (production.json), or reuses a value from PRODUCTION_<key>
//   PRODUCTION_NEXT_PUBLIC_*  production's values, which a staging build must not reuse
//   NEXT_PUBLIC_*           the values compiled into the bundle
//
// The .env files `next build` reads count too (same resolution as the build), so
// a value committed to .env.production cannot slip past the check.
//
// With --built it also refuses source maps (the deploy workflow uploads them to
// Sentry and deletes them first) and, when NEXT_PUBLIC_SENTRY_DSN is empty, any
// Sentry SDK code in the export.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sentryIngestOrigin } from '../../lib/csp.mts'

export const REQUIRED = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]

export const URL_KEYS = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_FUNCTIONS_URL']

/** Production's project, sites and origins (also read by the Functions params check). */
export const PRODUCTION = JSON.parse(
  readFileSync(new URL('./production.json', import.meta.url), 'utf8'),
)

/**
 * Hosts that belong to production: each Hosting site's two domains (the project's own
 * site included, which is also its default auth domain) and its storage buckets.
 */
export const PRODUCTION_HOSTS = new Set([
  ...[...PRODUCTION.hostingSites, PRODUCTION.projectId].flatMap(name => [
    `${name}.web.app`,
    `${name}.firebaseapp.com`,
  ]),
  `${PRODUCTION.projectId}.firebasestorage.app`,
  `${PRODUCTION.projectId}.appspot.com`,
])

/**
 * Values that identify a Firebase project, its site or its keys. A staging build must
 * not share any of them with production (PRODUCTION_<key> in the environment). The
 * Sentry DSN and the Google and Microsoft client IDs may be shared on purpose.
 */
export const PROJECT_VALUE_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
  'NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_FUNCTIONS_URL',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
]

/** The host a value names: a URL's hostname, or the value itself (a bucket or domain). */
function hostOf(raw) {
  try {
    return new URL(raw).hostname
  } catch {
    return raw.toLowerCase()
  }
}

/**
 * Whether a public value points at production: its project id, one of its hosts, or
 * its Cloud Functions host in any region.
 * @param {string} raw
 */
export function pointsAtProduction(raw) {
  const host = hostOf(raw)
  return (
    raw === PRODUCTION.projectId ||
    PRODUCTION_HOSTS.has(host) ||
    host.endsWith(`-${PRODUCTION.projectId}.cloudfunctions.net`)
  )
}

/** Deploy environments a build may name in NEXT_PUBLIC_DEPLOY_ENVIRONMENT ('' is production). */
export const DEPLOY_ENVIRONMENTS = ['', 'staging']

/** An Entra ID Application (client) ID: a GUID. */
export const MICROSOFT_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Shapes of real secrets that must never be compiled into a public bundle.
const SECRET_PATTERNS = [
  { name: 'a Stripe secret or restricted key', pattern: /\b(sk|rk)_(live|test)_/ },
  { name: 'a Stripe webhook secret', pattern: /\bwhsec_/ },
  { name: 'a private key', pattern: /PRIVATE KEY/ },
  { name: 'a service-account JSON key', pattern: /"type"\s*:\s*"service_account"/ },
  { name: 'an OAuth client secret', pattern: /\bGOCSPX-/ },
  { name: 'a Sentry auth token', pattern: /\bsntry[su]_/ },
]

/**
 * Whether a value is a Sentry public DSN, `https://<public key>@<host>/<project id>`.
 * Legacy DSNs with a secret key (`https://<key>:<secret>@…`) are refused. Uses the
 * same parser as the Content-Security-Policy, which allows that DSN's host.
 * @param {string} value
 */
export function isSentryDsn(value) {
  return sentryIngestOrigin(value) !== null
}

/** A `//# sourceMappingURL=` or `/*# sourceMappingURL=` comment. */
export const SOURCE_MAP_COMMENT = /^\/[/*][#@] sourceMappingURL=.*$/m

/** Text only the Sentry SDK puts in a bundle: its global carrier object. */
export const SENTRY_SDK_MARKER = '__SENTRY__'

/**
 * Returns the problems with a production build environment. Pure, for tests.
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkEnv(env) {
  const errors = []
  const warnings = []
  const value = key => (env[key] ?? '').trim()

  const project = value('FIREBASE_PROJECT_ID')
  if (!project) errors.push('FIREBASE_PROJECT_ID (the deployment target) is not set.')

  for (const key of REQUIRED) {
    if (!value(key)) errors.push(`${key} is empty; the deployed app would run without Firebase.`)
  }

  const bundled = value('NEXT_PUBLIC_FIREBASE_PROJECT_ID')
  if (project && bundled && project !== bundled) {
    errors.push(
      `NEXT_PUBLIC_FIREBASE_PROJECT_ID is ${bundled}, but this build deploys to ${project}.`,
    )
  }

  for (const key of URL_KEYS) {
    const raw = value(key)
    if (!raw) continue
    let url
    try {
      url = new URL(raw)
    } catch {
      errors.push(`${key} is not a valid URL.`)
      continue
    }
    if (url.protocol !== 'https:') errors.push(`${key} must use https.`)
  }

  if (env.ENABLE_BLAZE_FUNCTIONS === 'true' && !value('NEXT_PUBLIC_FUNCTIONS_URL')) {
    errors.push('ENABLE_BLAZE_FUNCTIONS is true but NEXT_PUBLIC_FUNCTIONS_URL is empty.')
  }
  if (env.ENABLE_BLAZE_FUNCTIONS !== 'true' && value('NEXT_PUBLIC_FUNCTIONS_URL')) {
    errors.push('NEXT_PUBLIC_FUNCTIONS_URL is set but Functions are not deployed.')
  }
  // Every browser-called Function requires an App Check token
  // (functions/src/shared/app-check.ts), so without the site key checkout, export,
  // deletion, feeds and alerts would all answer "App verification required".
  if (env.ENABLE_BLAZE_FUNCTIONS === 'true' && !value('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY')) {
    errors.push(
      'ENABLE_BLAZE_FUNCTIONS is true but NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY is empty; every Function would refuse the app (OWNER_CHECKLIST step A7).',
    )
  }
  if (value('NEXT_PUBLIC_ALERTS_ENABLED') === '1' && !value('NEXT_PUBLIC_FIREBASE_VAPID_KEY')) {
    errors.push(
      'NEXT_PUBLIC_ALERTS_ENABLED is set but NEXT_PUBLIC_FIREBASE_VAPID_KEY is empty, so no browser could register for alerts.',
    )
  }
  if (value('NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN')) {
    errors.push(
      'NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN is set; a debug token in a deployed bundle lets anyone pass App Check. Use it only for local builds.',
    )
  }
  for (const key of [
    'NEXT_PUBLIC_BILLING_ENABLED',
    'NEXT_PUBLIC_FORECAST_PROXY',
    'NEXT_PUBLIC_ALERTS_ENABLED',
    'NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED',
  ]) {
    const flag = value(key)
    if (flag && flag !== '1') errors.push(`${key} must be '1' or empty.`)
    if (flag === '1' && env.ENABLE_BLAZE_FUNCTIONS !== 'true') {
      errors.push(`${key} is set but Functions are not deployed.`)
    }
  }

  const googleEvents = value('NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED')
  if (googleEvents && googleEvents !== '1') {
    errors.push(`NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED must be '1' or empty.`)
  }
  if (googleEvents === '1' && !value('NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID')) {
    errors.push(
      'NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED is set but NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is empty, so the events would stay hidden.',
    )
  }

  const microsoftClient = value('NEXT_PUBLIC_MICROSOFT_CLIENT_ID')
  if (microsoftClient && !MICROSOFT_CLIENT_ID.test(microsoftClient)) {
    errors.push(
      'NEXT_PUBLIC_MICROSOFT_CLIENT_ID is not an Application (client) ID (a GUID such as 00000000-0000-0000-0000-000000000000).',
    )
  }
  const outlookEvents = value('NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED')
  if (outlookEvents && outlookEvents !== '1') {
    errors.push(`NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED must be '1' or empty.`)
  }
  if (outlookEvents === '1' && !microsoftClient) {
    errors.push(
      'NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED is set but NEXT_PUBLIC_MICROSOFT_CLIENT_ID is empty, so the events would stay hidden.',
    )
  }

  // A Cloud Functions URL names its project; a build must call its own project's.
  const functionsUrl = value('NEXT_PUBLIC_FUNCTIONS_URL')
  if (project && functionsUrl) {
    const host = hostOf(functionsUrl)
    if (host.endsWith('.cloudfunctions.net') && !host.endsWith(`-${project}.cloudfunctions.net`)) {
      errors.push(`NEXT_PUBLIC_FUNCTIONS_URL is ${host}, not this build's project ${project}.`)
    }
  }

  const environment = value('NEXT_PUBLIC_DEPLOY_ENVIRONMENT')
  if (!DEPLOY_ENVIRONMENTS.includes(environment)) {
    errors.push(`NEXT_PUBLIC_DEPLOY_ENVIRONMENT must be 'staging' or empty (production).`)
  } else if (environment === 'staging') {
    errors.push(...checkStaging(env, project))
  } else if (project === PRODUCTION.projectId && environment) {
    errors.push(
      `NEXT_PUBLIC_DEPLOY_ENVIRONMENT is ${environment}, but this build deploys to production.`,
    )
  }

  const dsn = value('NEXT_PUBLIC_SENTRY_DSN')
  if (dsn && !isSentryDsn(dsn)) {
    errors.push(
      'NEXT_PUBLIC_SENTRY_DSN is not a Sentry public DSN (https://<public key>@<host>/<project id>, without a secret key).',
    )
  }

  if (!value('NEXT_PUBLIC_SITE_URL')) {
    warnings.push('NEXT_PUBLIC_SITE_URL is empty; metadata, robots.txt and sitemap use defaults.')
  }

  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('NEXT_PUBLIC_') || !raw) continue
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(raw))
        errors.push(`${key} looks like ${name}; public values ship to browsers.`)
    }
  }

  return { errors, warnings }
}

/**
 * The problems with a staging build: anything that would send staging's visitors, data
 * or keys to production. Pure, for tests.
 * @param {Record<string, string | undefined>} env
 * @param {string} project the FIREBASE_PROJECT_ID this build deploys to
 * @returns {string[]}
 */
export function checkStaging(env, project) {
  const errors = []
  const value = key => (env[key] ?? '').trim()
  if (project === PRODUCTION.projectId) {
    errors.push(`A staging build cannot deploy to production's project ${PRODUCTION.projectId}.`)
  }
  if (!value('NEXT_PUBLIC_SITE_URL')) {
    errors.push('NEXT_PUBLIC_SITE_URL is empty; a staging build must name its own site.')
  }
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('NEXT_PUBLIC_') || !raw?.trim()) continue
    if (pointsAtProduction(raw.trim())) {
      errors.push(`${key} points at production (${raw.trim()}) in a staging build.`)
    }
  }
  for (const key of PROJECT_VALUE_KEYS) {
    const production = value(`PRODUCTION_${key}`)
    if (production && value(key) === production) {
      errors.push(`${key} is production's value in a staging build; use the staging project's own.`)
    }
  }
  return errors
}

/**
 * Returns true when `needle` occurs in any text file of the export.
 * @param {string} dir
 * @param {string} needle
 */
export function exportContains(dir, needle) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(html|js|txt)$/.test(entry.name)) continue
    if (readFileSync(join(entry.parentPath, entry.name), 'utf8').includes(needle)) return true
  }
  return false
}

/**
 * Files in an export, as paths relative to `dir`.
 * @param {string} dir
 */
function exportFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
}

/**
 * Problems with a built export that the environment check cannot see: source maps
 * that would be published, and Sentry code in a build that has no DSN.
 * @param {string} dir
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function checkExport(dir, env) {
  const errors = []
  const files = exportFiles(dir)
  const maps = files.filter(file => file.endsWith('.map'))
  if (maps.length > 0) {
    errors.push(
      `${dir} contains ${maps.length} source map(s), e.g. ${maps[0]}; source maps go to Sentry only and must not be published.`,
    )
  }
  const mapComments = files.filter(
    file => /\.(js|css)$/.test(file) && SOURCE_MAP_COMMENT.test(readFileSync(file, 'utf8')),
  )
  if (mapComments.length > 0) {
    errors.push(
      `${mapComments.length} file(s) in ${dir} still reference a source map, e.g. ${mapComments[0]}.`,
    )
  }
  const dsn = (env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim()
  if (dsn && !exportContains(dir, dsn)) {
    errors.push(
      `NEXT_PUBLIC_SENTRY_DSN is not compiled into ${dir}; rebuild with the production env.`,
    )
  }
  if (!dsn && exportContains(dir, SENTRY_SDK_MARKER)) {
    errors.push(`${dir} contains Sentry SDK code although NEXT_PUBLIC_SENTRY_DSN is empty.`)
  }
  return errors
}

/**
 * Problems with a built staging export: production's project id or a production host
 * compiled into it.
 * @param {string} dir
 * @returns {string[]}
 */
export function checkStagingExport(dir) {
  return [PRODUCTION.projectId, ...PRODUCTION_HOSTS]
    .filter(needle => exportContains(dir, needle))
    .map(needle => `${dir} is a staging build but contains production's ${needle}.`)
}

async function main(argv) {
  const builtIndex = argv.indexOf('--built')
  const builtDir = builtIndex === -1 ? null : argv[builtIndex + 1]
  // Same env resolution as `next build` (process.env wins over the files). Imported
  // here, not at the top, so the pure checks load without node_modules (the workflow
  // script tests run before any install).
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error })
  const { errors, warnings } = checkEnv(process.env)

  if (builtDir && errors.length === 0) {
    for (const key of REQUIRED) {
      if (!exportContains(builtDir, String(process.env[key]).trim())) {
        errors.push(`${key} is not compiled into ${builtDir}; rebuild with the production env.`)
      }
    }
    errors.push(...checkExport(builtDir, process.env))
    if ((process.env.NEXT_PUBLIC_DEPLOY_ENVIRONMENT ?? '').trim() === 'staging') {
      errors.push(...checkStagingExport(builtDir))
    }
  }

  for (const warning of warnings) console.log(`::warning::${warning}`)
  for (const error of errors) console.log(`::error::${error}`)
  if (errors.length > 0) process.exit(1)
  console.log(
    builtDir
      ? `Public configuration is compiled into ${builtDir}.`
      : 'Public build configuration is complete.',
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2))

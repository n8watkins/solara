#!/usr/bin/env node
// Checks the public NEXT_PUBLIC_* build configuration for a production build.
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
//   NEXT_PUBLIC_*           the values compiled into the bundle
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
  const billing = value('NEXT_PUBLIC_BILLING_ENABLED')
  if (billing && billing !== '1') {
    errors.push("NEXT_PUBLIC_BILLING_ENABLED must be '1' or empty.")
  }
  if (billing === '1' && env.ENABLE_BLAZE_FUNCTIONS !== 'true') {
    errors.push('NEXT_PUBLIC_BILLING_ENABLED is set but Functions are not deployed.')
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

function main(argv) {
  const builtIndex = argv.indexOf('--built')
  const builtDir = builtIndex === -1 ? null : argv[builtIndex + 1]
  const { errors, warnings } = checkEnv(process.env)

  if (builtDir && errors.length === 0) {
    for (const key of REQUIRED) {
      if (!exportContains(builtDir, String(process.env[key]).trim())) {
        errors.push(`${key} is not compiled into ${builtDir}; rebuild with the production env.`)
      }
    }
    errors.push(...checkExport(builtDir, process.env))
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))

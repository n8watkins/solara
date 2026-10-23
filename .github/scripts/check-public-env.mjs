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
//   NEXT_PUBLIC_*           the values compiled into the bundle
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
]

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

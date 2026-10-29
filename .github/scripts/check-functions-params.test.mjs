// APP_URL is the only origin the Functions' CORS allows and where checkout returns, so
// each project must have its own: production's for production, never production's
// hosts elsewhere.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { checkAppUrl } = require('./check-functions-params.js')
const PRODUCTION = require('./production.json')

/** The APP_URL a committed functions/.env* file sets, or undefined. */
function committedAppUrl(file) {
  const text = readFileSync(new URL(`../../functions/${file}`, import.meta.url), 'utf8')
  return /^APP_URL=(.*)$/m.exec(text)?.[1]
}

test('production must use its own origin', () => {
  assert.equal(checkAppUrl('uv-activity-planner', 'https://solara-uv.web.app'), null)
  assert.equal(checkAppUrl('uv-activity-planner', 'https://solara-uv.web.app/'), null)
  assert.match(
    checkAppUrl('uv-activity-planner', 'https://solara-staging.web.app'),
    /not https:\/\/solara-uv\.web\.app/,
  )
})

test('another project may not use any production host', () => {
  assert.equal(checkAppUrl('solara-staging', 'https://solara-staging.web.app'), null)
  for (const host of [
    'solara-uv.web.app',
    'solara-uv.firebaseapp.com',
    'uv-activity-planner.web.app',
    'uv-activity-planner.firebaseapp.com',
  ]) {
    assert.match(checkAppUrl('solara-staging', `https://${host}`), /production's/)
  }
})

test('APP_URL must be a bare https origin', () => {
  assert.match(checkAppUrl('solara-staging', ''), /empty/)
  assert.match(checkAppUrl('solara-staging', 'solara-staging.web.app'), /not a URL/)
  assert.match(checkAppUrl('solara-staging', 'http://solara-staging.web.app'), /https/)
  assert.match(checkAppUrl('solara-staging', 'https://solara-staging.web.app/app/'), /origin/)
})

test('the committed params give each project its own APP_URL and functions/.env none', () => {
  assert.equal(committedAppUrl('.env'), undefined)
  assert.equal(committedAppUrl(`.env.${PRODUCTION.projectId}`), PRODUCTION.appUrl)
  assert.equal(checkAppUrl('solara-staging', committedAppUrl('.env.solara-staging')), null)
})

test('the Functions declare APP_URL with no default', () => {
  const source = readFileSync(
    new URL('../../functions/src/shared/browser-api.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /defineString\('APP_URL'\)/)
})

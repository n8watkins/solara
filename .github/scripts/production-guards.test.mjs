// Production credentials stay on main: a manual run (workflow_dispatch) may pick any
// branch, so every job in deploy.yml that receives a secret or can mint
// an OIDC token must check the ref itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const MAIN_ONLY = "github.ref == 'refs/heads/main'"

/** The jobs of a workflow as { name: block text }, split on the two-space job keys. */
function jobs(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length)
  const result = {}
  let name = null
  for (const line of body.split('\n')) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (key) name = key[1]
    else if (/^\S/.test(line)) break
    if (name) result[name] = `${result[name] ?? ''}${line}\n`
  }
  return result
}

/** A job's own `if:` condition (with its folded continuation lines), or ''. */
function jobCondition(block) {
  const match = /^ {4}if:(.*\n(?: {6,}.*\n)*)/m.exec(block)
  return match ? match[1] : ''
}

/** Jobs that can reach credentials (a secret or an OIDC token) without the main check. */
function unguardedJobs(workflow) {
  return Object.entries(jobs(workflow))
    .filter(([, block]) => /secrets\.|id-token: write/.test(block))
    .filter(([, block]) => !jobCondition(block).includes(MAIN_ONLY))
    .map(([name]) => name)
}

test('finds a credentialed job without the main check', () => {
  const workflow = [
    'on: workflow_dispatch',
    'jobs:',
    '  safe:',
    `    if: ${MAIN_ONLY}`,
    '    permissions:',
    '      id-token: write',
    '  open:',
    '    steps:',
    "      - if: github.ref == 'refs/heads/main'",
    '        run: echo a step condition does not guard the job',
    '      - run: deploy',
    '        env:',
    '          KEY: ${{ secrets.KEY }}',
    '  harmless:',
    '    steps:',
    '      - run: echo hi',
    '',
  ].join('\n')
  assert.deepEqual(unguardedJobs(workflow), ['open'])
})

for (const file of ['deploy.yml']) {
  test(`${file} uses production credentials only on main`, () => {
    const workflow = readFileSync(new URL(`../workflows/${file}`, import.meta.url), 'utf8')
    assert.ok(Object.keys(jobs(workflow)).length > 0)
    assert.deepEqual(unguardedJobs(workflow), [])
  })
}

// The staging deploy: its workflow also comes only from main, each credentialed job is
// in the staging environment and waits for a configured staging target, it reads only
// STAGING_* settings (production's public values only to refuse them), and every
// Firebase command names the staging project and only the app's Hosting target.
const staging = readFileSync(new URL('../workflows/deploy-staging.yml', import.meta.url), 'utf8')
const production = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')

const LIVE_FROM_MAIN = "(github.ref == 'refs/heads/main' || inputs.channel != 'live')"

test('deploy-staging.yml deploys live only from main, credentials only in the staging environment', () => {
  for (const [name, block] of Object.entries(jobs(staging))) {
    const condition = jobCondition(block)
    assert.ok(condition.includes(LIVE_FROM_MAIN.replace(/^\(|\)$/g, '')), name)
  }
  assert.doesNotMatch(staging, /inputs\.ref|ref: \$\{\{/)
  for (const [name, block] of Object.entries(jobs(staging))) {
    if (!/secrets\.|id-token: write/.test(block)) continue
    assert.match(block, /^ {4}environment:(?: staging| *\n {6}name: staging)$/m, name)
  }
})

test('deploy-staging.yml deploys only once staging is configured', () => {
  for (const [name, block] of Object.entries(jobs(staging))) {
    if (name === 'config') continue
    assert.match(jobCondition(block), /needs\.config\.outputs\.configured == 'true'/, name)
  }
})

test('deploy-staging.yml reads only staging settings and credentials', () => {
  const variables = [...staging.matchAll(/\bvars\.([A-Z0-9_]+)/g)].map(match => match[1])
  assert.deepEqual(
    variables.filter(name => !name.startsWith('STAGING_')),
    [],
  )
  for (const [, env, name] of staging.matchAll(
    /^ +([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/gm,
  )) {
    if (name.startsWith('STAGING_')) continue
    // Production's public build values, passed only to be refused.
    assert.ok(name.startsWith('NEXT_PUBLIC_') && env === `PRODUCTION_${name}`, `${env}: ${name}`)
  }
  const secrets = [...staging.matchAll(/\bsecrets\.([A-Z0-9_]+)/g)].map(match => match[1])
  assert.deepEqual(
    secrets.filter(name => !name.startsWith('STAGING_') && !name.startsWith('NEXT_PUBLIC_')),
    [],
  )
})

test('every Firebase command in deploy-staging.yml targets the staging project', () => {
  // Shell continuation lines joined, so each command is one line.
  const commands = staging.replace(/\\\n\s*/g, ' ').match(/"\$FIREBASE" [^\n]*/g) ?? []
  assert.ok(commands.length >= 6)
  for (const command of commands) {
    assert.match(command, /--project "\$STAGING_PROJECT"/, command)
    if (/deploy --only hosting|channel:deploy/.test(command)) {
      assert.match(command, /--only (hosting:)?app /, command)
    }
  }
  assert.doesNotMatch(staging, /--project "?\$FIREBASE_PROJECT_ID/)
})

test('deploy.yml never reads a staging setting', () => {
  assert.doesNotMatch(production, /STAGING_|deploy-staging|environment: staging/)
})

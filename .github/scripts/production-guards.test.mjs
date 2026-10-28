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

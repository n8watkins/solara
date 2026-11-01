import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { REQUIRED_QUALITY_JOBS, TREE_ARTIFACT, findProof, qualityPassed } from './tested-tree.mjs'

const REPO = 'owner/solara'
const SHA = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const PARENT = 'c'.repeat(40)
const HEAD = 'd'.repeat(40)
const OTHER_TREE = 'e'.repeat(40)

const passingJobs = () => [
  ...REQUIRED_QUALITY_JOBS.map(name => ({ name, conclusion: 'success' })),
  { name: 'quality / UI harness shard 1 of 4', conclusion: 'skipped' },
  { name: 'quality / Dependency review', conclusion: 'skipped' },
  { name: 'Hosting', conclusion: 'failure' },
]

/** A fake GitHub API: a happy path that each test bends in one place. */
function fakeApi(overrides = {}) {
  const state = {
    pulls: [
      {
        number: 42,
        merged_at: '2026-11-01T00:00:00Z',
        merge_commit_sha: SHA,
        base: { ref: 'main' },
        head: { sha: HEAD },
      },
    ],
    ciRuns: [{ id: 7, head_sha: HEAD, event: 'pull_request', conclusion: 'success' }],
    artifacts: { 7: [`${TREE_ARTIFACT}${TREE}`] },
    parentRuns: [{ id: 9, head_sha: PARENT }],
    jobs: { 9: passingJobs() },
    ...overrides,
  }
  const calls = []
  const api = async path => {
    calls.push(path)
    let match
    if (path === `/repos/${REPO}/commits/${SHA}/pulls`) return state.pulls
    if ((match = path.match(/\/actions\/workflows\/ci\.yml\/runs\?(.*)$/))) {
      const query = new URLSearchParams(match[1])
      assert.equal(query.get('head_sha'), HEAD)
      assert.equal(query.get('event'), 'pull_request')
      return { workflow_runs: state.ciRuns }
    }
    if ((match = path.match(/\/actions\/runs\/(\d+)\/artifacts\?name=([^&]+)/))) {
      return { artifacts: (state.artifacts[match[1]] ?? []).map(name => ({ name })) }
    }
    if ((match = path.match(/\/actions\/workflows\/deploy\.yml\/runs\?head_sha=([0-9a-f]+)/))) {
      assert.equal(match[1], PARENT)
      return { workflow_runs: state.parentRuns }
    }
    if ((match = path.match(/\/actions\/runs\/(\d+)\/jobs\?/))) {
      return { jobs: state.jobs[match[1]] ?? [] }
    }
    throw new Error(`unexpected ${path}`)
  }
  return { api, calls }
}

const commit = { repo: REPO, sha: SHA, tree: TREE, parent: PARENT }

test('a squash merge of a tested tree on a passing main skips the suites', async () => {
  const { api } = fakeApi()
  const result = await findProof(api, commit)
  assert.equal(
    result.reason,
    `pull request #42 CI run 7 passed tree ${TREE}, on top of ${PARENT}, whose quality checks passed in Deploy run 9`,
  )
})

test('a push that is not a pull request merge runs everything', async () => {
  for (const pulls of [
    [],
    // Merged, but this commit is not its merge commit (a commit pushed on top).
    [
      {
        number: 1,
        merged_at: 'x',
        merge_commit_sha: 'f'.repeat(40),
        base: { ref: 'main' },
        head: { sha: HEAD },
      },
    ],
    // Open, not merged.
    [
      {
        number: 1,
        merged_at: null,
        merge_commit_sha: SHA,
        base: { ref: 'main' },
        head: { sha: HEAD },
      },
    ],
    // Merged into another branch.
    [
      {
        number: 1,
        merged_at: 'x',
        merge_commit_sha: SHA,
        base: { ref: 'next' },
        head: { sha: HEAD },
      },
    ],
  ]) {
    const { api } = fakeApi({ pulls })
    assert.match((await findProof(api, commit)).missing, /not the merge commit/)
  }
})

test('a CI run of another tree (main moved on, or an old run re-run) runs everything', async () => {
  const { api } = fakeApi({ artifacts: { 7: [`${TREE_ARTIFACT}${OTHER_TREE}`] } })
  assert.match(
    (await findProof(api, commit)).missing,
    new RegExp(`no passing CI run of pull request #42 \\(head ${HEAD}\\) tested tree ${TREE}`),
  )
})

test('a failed or missing CI run, or one before trees were recorded, runs everything', async () => {
  for (const overrides of [
    { ciRuns: [] },
    { ciRuns: [{ id: 7, head_sha: HEAD, event: 'pull_request', conclusion: 'failure' }] },
    { ciRuns: [{ id: 7, head_sha: 'f'.repeat(40), event: 'pull_request', conclusion: 'success' }] },
    { ciRuns: [{ id: 7, head_sha: HEAD, event: 'workflow_dispatch', conclusion: 'success' }] },
    { artifacts: {} },
  ]) {
    const { api } = fakeApi(overrides)
    assert.match((await findProof(api, commit)).missing, /no passing CI run/)
  }
})

test('any passing run of the head that tested the tree is enough', async () => {
  const { api } = fakeApi({
    ciRuns: [
      { id: 6, head_sha: HEAD, event: 'pull_request', conclusion: 'success' },
      { id: 7, head_sha: HEAD, event: 'pull_request', conclusion: 'success' },
    ],
    artifacts: { 6: [`${TREE_ARTIFACT}${OTHER_TREE}`], 7: [`${TREE_ARTIFACT}${TREE}`] },
  })
  assert.match((await findProof(api, commit)).reason, /CI run 7 passed/)
})

test('a parent without a passing quality run runs everything', async () => {
  const failing = passingJobs().map(job =>
    job.name === 'quality / Signed-in browser tests on emulators'
      ? { ...job, conclusion: 'failure' }
      : job,
  )
  for (const overrides of [
    { parentRuns: [] },
    { jobs: { 9: failing } },
    // Cancelled before the quality checks ran.
    { jobs: { 9: [{ name: 'quality / Detect changed areas', conclusion: 'cancelled' }] } },
    { parentRuns: [{ id: 9, head_sha: 'f'.repeat(40) }] },
  ]) {
    const { api } = fakeApi(overrides)
    assert.match((await findProof(api, commit)).missing, /has no passing quality run/)
  }
})

test('a missing or malformed commit id runs everything without calling GitHub', async () => {
  const { api, calls } = fakeApi()
  for (const bad of [{ tree: '' }, { parent: undefined }, { sha: 'main' }]) {
    assert.match((await findProof(api, { ...commit, ...bad })).missing, /^no (sha|tree|parent)/)
  }
  assert.deepEqual(calls, [])
})

test('qualityPassed needs every required job and no failed quality job', () => {
  assert.equal(qualityPassed(passingJobs()), true)
  assert.equal(qualityPassed(passingJobs().slice(1)), false)
  assert.equal(
    qualityPassed([
      ...passingJobs(),
      { name: 'quality / UI harness shard 2 of 4', conclusion: 'failure' },
    ]),
    false,
  )
})

test('the required jobs are the quality workflow jobs, and deploy.yml wires the proof in', () => {
  const quality = readFileSync(new URL('../workflows/quality.yml', import.meta.url), 'utf8')
  for (const name of REQUIRED_QUALITY_JOBS) {
    assert.match(quality, new RegExp(`\\n    name: ${name.slice('quality / '.length)}\\n`), name)
  }
  // The pull request records the tree it tested under the name this script looks for.
  assert.match(quality, /name: tested-tree-\$\{\{ steps\.tree\.outputs\.tree \}\}/)
  const deploy = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')
  // The only way to skip the suites on main is this script's proof.
  assert.match(deploy, /tested: \$\{\{ needs\.tested\.outputs\.reason \}\}/)
  assert.equal(deploy.match(/tested:/g).length, 2, 'one `tested` job and one `tested` input')
  assert.match(deploy, /run: node \.github\/scripts\/tested-tree\.mjs/)
})

#!/usr/bin/env node
// Proves, for a push to main, that the pushed commit's exact tree already passed CI,
// so the deploy does not run the same suites on the same files again (docs/CI.md,
// "Deploys"). deploy.yml runs it and hands what it prints to quality.yml.
//
// The suites are skipped only when all of these hold:
// 1. The commit is a merged pull request's merge commit (GitHub lists the pull
//    request for the commit, merged into main, with this commit as its merge commit).
// 2. A CI run for that pull request's final head commit (event pull_request)
//    concluded success and recorded the tree it tested, as the `tested-tree-<tree>`
//    artifact the `changes` job uploads, and that tree is the commit's own tree.
//    A pull request's CI tests GitHub's merge of the pull request into its base, so
//    this holds when the squash merge produced the very files CI tested, and fails
//    when main moved on in between (a re-run of an old CI run keeps its old tree).
// 3. The commit's first parent (main before the merge) passed every quality check in
//    a Deploy run of its own. A pull request runs only the suites its files can
//    affect, so the parent vouches for the suites the pull request skipped.
// Anything else, including any GitHub API error, prints an empty reason, and every
// suite runs: when in doubt, run.
//
// Usage (in CI, with the parent commit fetched and GITHUB_TOKEN able to read
// actions and pull requests):
//   node .github/scripts/tested-tree.mjs
// Writes `reason=<proof>` (empty when not proven) to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The name prefix of the artifact the `changes` job uploads on a pull request. */
export const TREE_ARTIFACT = 'tested-tree-'

/** quality.yml's jobs that must have passed on the parent, as Deploy names them. */
export const REQUIRED_QUALITY_JOBS = [
  'Detect changed areas',
  'Lint, types and unit tests',
  'Browser tests on the static export',
  'Browser tests with Sentry and App Check switched on',
  'Signed-in browser tests on emulators',
  'Signed-in UI harness',
  'Functions and Firestore rules',
  'Workflow and secret scanning',
].map(name => `quality / ${name}`)

const SHA = /^[0-9a-f]{40}$/

/**
 * Looks for the proof that `tree` (the tree of `sha`, whose first parent is
 * `parent`) passed CI.
 * @param {(path: string) => Promise<any>} api GET of a GitHub REST path, parsed JSON
 * @param {{ repo: string, sha: string, tree: string, parent: string }} commit
 * @returns {Promise<{ reason: string } | { missing: string }>}
 */
export async function findProof(api, { repo, sha, tree, parent }) {
  for (const [name, value] of Object.entries({ sha, tree, parent })) {
    if (!SHA.test(value ?? '')) return { missing: `no ${name} to compare` }
  }

  // 1. The pull request this commit merged.
  const pulls = await api(`/repos/${repo}/commits/${sha}/pulls`)
  const pull = pulls.find(
    p => p.merged_at && p.merge_commit_sha === sha && p.base?.ref === 'main' && p.head?.sha,
  )
  if (!pull) return { missing: `${sha} is not the merge commit of a pull request into main` }
  const head = pull.head.sha

  // 2. A passing CI run of that head that tested this very tree.
  const { workflow_runs: ciRuns = [] } = await api(
    `/repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=100`,
  )
  let tested
  for (const run of ciRuns) {
    if (run.head_sha !== head || run.event !== 'pull_request' || run.conclusion !== 'success') {
      continue
    }
    const { artifacts = [] } = await api(
      `/repos/${repo}/actions/runs/${run.id}/artifacts?name=${TREE_ARTIFACT}${tree}&per_page=100`,
    )
    if (artifacts.some(a => a.name === `${TREE_ARTIFACT}${tree}`)) {
      tested = run
      break
    }
  }
  if (!tested) {
    return {
      missing: `no passing CI run of pull request #${pull.number} (head ${head}) tested tree ${tree}`,
    }
  }

  // 3. The parent passed every quality check in a Deploy run.
  const { workflow_runs: parentRuns = [] } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?head_sha=${parent}&per_page=100`,
  )
  let vouched
  for (const run of parentRuns) {
    if (run.head_sha !== parent) continue
    const { jobs = [] } = await api(
      `/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
    )
    if (qualityPassed(jobs)) {
      vouched = run
      break
    }
  }
  if (!vouched) return { missing: `main before the merge (${parent}) has no passing quality run` }

  return {
    reason:
      `pull request #${Number(pull.number)} CI run ${Number(tested.id)} passed tree ${tree}, ` +
      `on top of ${parent}, whose quality checks passed in Deploy run ${Number(vouched.id)}`,
  }
}

/** Every required quality job passed, and no other quality job failed. */
export function qualityPassed(jobs) {
  const quality = jobs.filter(job => job.name?.startsWith('quality / '))
  const passed = new Set(quality.filter(job => job.conclusion === 'success').map(job => job.name))
  return (
    REQUIRED_QUALITY_JOBS.every(name => passed.has(name)) &&
    quality.every(job => job.conclusion === 'success' || job.conclusion === 'skipped')
  )
}

/** A GET against the GitHub REST API with the workflow's token. */
function github(token, base = process.env.GITHUB_API_URL || 'https://api.github.com') {
  return async path => {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`)
    return response.json()
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

async function main() {
  let reason = ''
  try {
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = process.env
    if (!token || !repo || !sha)
      throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY or GITHUB_SHA is not set')
    if (git('rev-parse', 'HEAD') !== sha) throw new Error(`the checkout is not ${sha}`)
    const result = await findProof(github(token), {
      repo,
      sha,
      tree: git('rev-parse', 'HEAD^{tree}'),
      parent: git('rev-parse', 'HEAD^1'),
    })
    if ('reason' in result) {
      reason = result.reason
      console.log(`Every suite is skipped: ${reason}.`)
    } else {
      console.log(`Every suite runs: ${result.missing}.`)
    }
  } catch (error) {
    console.log(
      `::warning::Could not check where this tree was tested, so every suite runs: ${error}`,
    )
  }
  if (process.env.GITHUB_OUTPUT) {
    // The reason is built from numbers and hex ids only, but never let a newline through.
    appendFileSync(process.env.GITHUB_OUTPUT, `reason=${reason.replace(/[\r\n]/g, ' ')}\n`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()

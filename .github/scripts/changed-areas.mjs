#!/usr/bin/env node
// Decides which quality suites a pull request needs, from the files it changes.
//
// The `main` ruleset requires every quality job to report on every pull request,
// so no job is ever skipped at the job level. Instead the `changes` job in
// quality.yml runs this script, and each suite job reads its area here and either
// runs or exits green with "No relevant changes" in its step summary.
//
// Each changed path is matched against RULES in order and the first match wins.
// A path no rule knows runs every suite, and so does any event without a pull
// request base (pushes to main, manual runs): when in doubt, run.
// docs/CONTRIBUTING-AGENTS.md and the README's quality checks describe this map;
// keep them in step with RULES.
//
// Usage (in CI, with the full history checked out):
//   node .github/scripts/changed-areas.mjs --base <sha> --head <sha>
//   node .github/scripts/changed-areas.mjs            # no base: every area runs
//
// Writes `<key>=true|false` and `<key>_reason=...` for each area (the key is the
// area name with `-` as `_`, e.g. signed_in), and `docs_only`, to $GITHUB_OUTPUT,
// and a table to $GITHUB_STEP_SUMMARY, when those are set.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Suite areas. */
export const AREAS = ['unit', 'functions', 'web', 'signed-in', 'harness', 'integrations']

/** The step output key for an area. */
export const outputKey = area => area.replaceAll('-', '_')

/** What each area runs, for the reasons a skipped job prints. */
export const AREA_LABELS = {
  unit: 'typecheck and unit tests',
  functions: 'Functions and Firestore rules tests',
  web: 'browser tests on the static export',
  'signed-in': 'signed-in browser tests on emulators',
  harness: 'signed-in UI harness',
  integrations: 'browser tests with Sentry and App Check switched on',
}

const ALL = AREAS
const NONE = []
const WEB_UI = ['unit', 'web', 'signed-in', 'harness']

const any =
  (...patterns) =>
  path =>
    patterns.some(pattern => (typeof pattern === 'string' ? path === pattern : pattern.test(path)))

/**
 * Ordered rules: the first rule whose `match` accepts a path decides its areas.
 * `why` is shown in the step summary.
 */
export const RULES = [
  {
    why: 'build, dependency or CI configuration (runs everything)',
    areas: ALL,
    match: any(
      /^\.github\//,
      /^(functions\/)?package(-lock)?\.json$/,
      /(^|\/)tsconfig[^/]*\.json$/,
      /^(next|postcss|eslint|prettier|vitest|playwright(\.[a-z]+)?)\.config\.[cm]?[jt]s$/,
      /^\.prettier(rc[^/]*|ignore)$/,
      /^\.(nvmrc|npmrc|firebaserc)$/,
      /^\.env(\..+)?$/,
      'firebase.json',
      // Shared by the web app and the Functions.
      /^packages\//,
      // Compiles packages/core into functions/core.
      'scripts/build-core.mjs',
    ),
  },
  {
    why: 'documentation or repository metadata',
    areas: NONE,
    match: any(
      /\.md$/i,
      /^docs\//,
      /^LICENSE/,
      'CODEOWNERS',
      '.gitignore',
      // Read only by the secret scan, which runs on every pull request.
      '.gitleaksignore',
      '.local-ops.yaml',
    ),
  },
  {
    why: 'signed-in browser tests',
    areas: ['unit', 'signed-in'],
    match: any(/^tests\/e2e\/signed-in\//),
  },
  {
    why: 'Sentry and App Check browser tests',
    areas: ['unit', 'integrations'],
    match: any(/^tests\/e2e\/integrations\//),
  },
  {
    why: 'static export server for browser tests',
    areas: ['unit', 'web', 'integrations'],
    match: any('tests/e2e/serve-export.mjs'),
  },
  {
    why: 'static export browser tests',
    areas: ['unit', 'web'],
    match: any(/^tests\/e2e\//),
  },
  {
    // The browser suites import the harness clock and fixtures.
    why: 'harness clock or fixtures shared with the browser tests',
    areas: ['unit', 'harness', 'web', 'signed-in'],
    match: any('tests/harness/clock.ts', 'tests/harness/fixtures.ts'),
  },
  {
    why: 'UI harness',
    areas: ['unit', 'harness'],
    match: any(/^tests\/harness\//),
  },
  {
    why: 'unit tests',
    areas: ['unit'],
    match: any(/^tests\/[^/]+\.test\.[cm]?[jt]sx?$/, /^lib\/.*\.test\.[cm]?[jt]sx?$/),
  },
  {
    why: 'test server shared by the emulator and harness suites',
    areas: ['unit', 'web', 'signed-in', 'harness'],
    match: any('tests/static-server.mts'),
  },
  {
    why: 'Cloud Functions',
    areas: ['unit', 'functions', 'signed-in'],
    match: any(/^functions\//),
  },
  {
    why: 'Firestore rules',
    areas: ['unit', 'functions', 'signed-in'],
    match: any('firestore.rules'),
  },
  {
    why: 'Firestore indexes',
    areas: ['functions'],
    match: any('firestore.indexes.json'),
  },
  {
    // Firebase initialisation, App Check, error reporting, the CSP and the pages the
    // integration suite visits (every route under app/).
    why: 'web app code on the Sentry or App Check path',
    areas: [...WEB_UI, 'integrations'],
    match: any(
      /^app\/.*(?<!\.css)$/,
      /^lib\/(firebase|csp|error-reporting|sentry|session|use-account|functions-api)[^/]*$/,
      /^components\/(App|ErrorBoundary|SignInScreen|GoogleSignInButton)\.tsx$/,
      'instrumentation-client.ts',
    ),
  },
  {
    why: 'web app code',
    areas: WEB_UI,
    match: any(/^(app|components|lib|hooks)\//),
  },
  {
    why: 'static assets',
    areas: ['unit', 'web', 'harness'],
    match: any(/^public\//),
  },
  {
    // generate-sw, static-pages, csp and the build checks run around production
    // builds; the harness builds with `next build` directly.
    why: 'build scripts',
    areas: ['unit', 'web', 'signed-in', 'integrations'],
    match: any(/^scripts\//),
  },
  {
    // tests/e2e/hosting-redirect.spec.ts serves it through the Hosting emulator.
    why: 'Hosting redirect site',
    areas: ['web'],
    match: any(/^hosting-redirect\//),
  },
]

/** The rule for one path, or a catch-all that runs everything. */
export function ruleFor(path) {
  return (
    RULES.find(rule => rule.match(path)) ?? {
      why: 'not covered by the area map (runs everything)',
      areas: ALL,
    }
  )
}

/**
 * Maps changed paths to areas.
 * @param {string[] | null} paths the changed paths, or null when the diff is unknown
 * @returns {{ areas: Record<string, boolean>, reasons: Record<string, string>,
 *   docsOnly: boolean, files: { path: string, why: string, areas: string[] }[] }}
 */
export function classify(paths) {
  const unique = paths ? [...new Set(paths.map(p => p.trim()).filter(Boolean))].sort() : null
  if (!unique || unique.length === 0) {
    const reason = unique
      ? 'the diff is empty, so every suite runs'
      : 'no pull request base to compare against, so every suite runs'
    return {
      areas: Object.fromEntries(AREAS.map(area => [area, true])),
      reasons: Object.fromEntries(AREAS.map(area => [area, reason])),
      docsOnly: false,
      files: [],
    }
  }

  const files = unique.map(path => {
    const rule = ruleFor(path)
    return { path, why: rule.why, areas: rule.areas }
  })
  const areas = {}
  const reasons = {}
  for (const area of AREAS) {
    const hits = files.filter(file => file.areas.includes(area))
    areas[area] = hits.length > 0
    reasons[area] = areas[area]
      ? `${describe(hits.map(file => file.path))} changed`
      : files.length === 1
        ? `the one changed file (${describe(unique)}) does not affect the ${AREA_LABELS[area]}`
        : `none of the ${files.length} changed files (${describe(unique)}) affect the ${AREA_LABELS[area]}`
  }
  const docsOnly = files.every(file => file.areas.length === 0)
  return { areas, reasons, docsOnly, files }
}

function describe(paths, limit = 3) {
  // Paths come from the pull request: keep control characters (a newline could
  // forge another output line) out of the reasons.
  const shown = paths
    .slice(0, limit)
    .map(path => JSON.stringify(path).slice(1, -1))
    .join(', ')
  return paths.length > limit ? `${shown} and ${paths.length - limit} more` : shown
}

/** Changed paths between the merge base of base and head, and head, or null. */
export function changedPaths(base, head, cwd = process.cwd()) {
  if (!base || !head) return null
  try {
    // --no-renames lists a rename as a deletion and an addition, so both the old
    // and the new path count.
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    return out.split('\0').filter(Boolean)
  } catch (error) {
    console.log(`::warning::Could not diff ${base}...${head}, so every suite runs: ${error}`)
    return null
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (key !== '--base' && key !== '--head') throw new Error(`Unknown argument: ${key}`)
    args[key.slice(2)] = argv[i + 1]
  }
  return args
}

function main(argv) {
  const { base, head } = parseArgs(argv)
  const result = classify(changedPaths(base, head))

  const lines = []
  for (const area of AREAS) {
    const key = outputKey(area)
    lines.push(`${key}=${result.areas[area]}`, `${key}_reason=${result.reasons[area]}`)
  }
  lines.push(`docs_only=${result.docsOnly}`)
  for (const line of lines) console.log(line)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '### Change-aware checks',
      '',
      '| Suite | Runs | Why |',
      '| --- | --- | --- |',
      ...AREAS.map(
        area =>
          `| ${AREA_LABELS[area]} | ${result.areas[area] ? 'yes' : 'no'} | ${result.reasons[area]} |`,
      ),
      '',
      'Lint, docs checks, workflow and secret scanning and dependency review always run.',
    ]
    if (result.files.length > 0) {
      summary.push(
        '',
        '<details><summary>Changed files</summary>',
        '',
        '| File | Rule | Areas |',
        '| --- | --- | --- |',
        ...result.files.map(
          file => `| \`${file.path}\` | ${file.why} | ${file.areas.join(', ') || 'none'} |`,
        ),
        '',
        '</details>',
      )
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))

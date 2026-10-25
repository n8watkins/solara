import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { AREAS, changedPaths, classify } from './changed-areas.mjs'

/** The areas that run, as a sorted list. */
function running(paths) {
  const { areas } = classify(paths)
  return AREAS.filter(area => areas[area]).sort()
}

const EVERYTHING = [...AREAS].sort()

test('a docs-only change runs no suite', () => {
  const result = classify(['docs/status.md', 'README.md', 'SECURITY.md', 'functions/README.md'])
  assert.deepEqual(running(['docs/status.md', 'README.md']), [])
  assert.equal(result.docsOnly, true)
  assert.match(
    result.reasons.web,
    /^none of the 4 changed files \(README\.md, SECURITY\.md, docs\/status\.md and 1 more\) affect the browser tests on the static export$/,
  )
})

test('repository metadata runs no suite', () => {
  assert.deepEqual(running(['.gitleaksignore', 'CODEOWNERS', '.gitignore', 'LICENSE']), [])
})

test('a CSS-only change runs the UI suites, not Functions or integrations', () => {
  assert.deepEqual(running(['components/Header.module.css']), [
    'harness',
    'signed-in',
    'unit',
    'web',
  ])
  assert.deepEqual(running(['app/globals.css']), ['harness', 'signed-in', 'unit', 'web'])
})

test('a Functions-only change runs Functions, unit and signed-in suites', () => {
  assert.deepEqual(running(['functions/src/billing/webhook.ts']), [
    'functions',
    'signed-in',
    'unit',
  ])
  assert.deepEqual(running(['functions/test/billing.test.js']), ['functions', 'signed-in', 'unit'])
})

test('a rules-only change runs the rules tests and the signed-in suite', () => {
  assert.deepEqual(running(['firestore.rules']), ['functions', 'signed-in', 'unit'])
  assert.deepEqual(running(['firestore.indexes.json']), ['functions'])
})

test('workflow, lockfile and shared configuration changes run everything', () => {
  for (const path of [
    '.github/workflows/quality.yml',
    '.github/scripts/changed-areas.mjs',
    '.github/README.md',
    'package.json',
    'package-lock.json',
    'functions/package-lock.json',
    'functions/package.json',
    'tsconfig.json',
    'functions/tsconfig.build.json',
    'next.config.ts',
    'vitest.config.mts',
    'playwright.config.ts',
    'playwright.harness.config.ts',
    'eslint.config.mjs',
    'postcss.config.mjs',
    '.prettierrc.json',
    '.prettierignore',
    '.nvmrc',
    '.env',
    '.env.local.example',
    'firebase.json',
    '.firebaserc',
    'packages/core/src/prefs.ts',
    'scripts/build-core.mjs',
  ]) {
    assert.deepEqual(running([path]), EVERYTHING, path)
  }
})

test('one force-all file among docs still runs everything', () => {
  const result = classify(['docs/status.md', 'package-lock.json'])
  assert.deepEqual(running(['docs/status.md', 'package-lock.json']), EVERYTHING)
  assert.equal(result.docsOnly, false)
  assert.equal(result.reasons.functions, 'package-lock.json changed')
})

test('web app code runs the UI suites and, on the Sentry or App Check path, integrations', () => {
  assert.deepEqual(running(['components/Dashboard.tsx']), ['harness', 'signed-in', 'unit', 'web'])
  assert.deepEqual(running(['hooks/useElementWidth.ts']), ['harness', 'signed-in', 'unit', 'web'])
  for (const path of [
    'app/layout.tsx',
    'app/global-error.tsx',
    'app/privacy/page.tsx',
    'lib/firebase.ts',
    'lib/csp.mts',
    'lib/error-reporting.ts',
    'lib/sentry-scrub.ts',
    'components/App.tsx',
    'instrumentation-client.ts',
  ]) {
    assert.deepEqual(running([path]), ['harness', 'integrations', 'signed-in', 'unit', 'web'], path)
  }
})

test('test files run only the suites that load them', () => {
  assert.deepEqual(running(['lib/csp.test.ts']), ['unit'])
  assert.deepEqual(running(['tests/static-server.test.ts']), ['unit'])
  assert.deepEqual(running(['tests/e2e/landing.spec.ts']), ['unit', 'web'])
  assert.deepEqual(running(['tests/e2e/signed-in/calendar.e2e.ts']), ['signed-in', 'unit'])
  assert.deepEqual(running(['tests/e2e/integrations/sentry.e2e.ts']), ['integrations', 'unit'])
  assert.deepEqual(running(['tests/e2e/serve-export.mjs']), ['integrations', 'unit', 'web'])
  assert.deepEqual(running(['tests/harness/units.spec.ts']), ['harness', 'unit'])
  // The browser suites import the harness clock and fixtures.
  assert.deepEqual(running(['tests/harness/clock.ts']), ['harness', 'signed-in', 'unit', 'web'])
  assert.deepEqual(running(['tests/static-server.mts']), ['harness', 'signed-in', 'unit', 'web'])
})

test('assets, build scripts and the redirect site run the suites that use them', () => {
  assert.deepEqual(running(['public/landing/dashboard-light.png']), ['harness', 'unit', 'web'])
  assert.deepEqual(running(['scripts/csp.mjs']), ['integrations', 'signed-in', 'unit', 'web'])
  assert.deepEqual(running(['hosting-redirect/index.html']), ['web'])
})

test('mixed changes run the union of their areas', () => {
  assert.deepEqual(
    running(['docs/status.md', 'functions/src/index.ts', 'components/Dashboard.tsx']),
    ['functions', 'harness', 'signed-in', 'unit', 'web'],
  )
  const result = classify(['functions/src/index.ts', 'tests/harness/units.spec.ts'])
  assert.equal(result.reasons.functions, 'functions/src/index.ts changed')
  assert.equal(result.reasons.harness, 'tests/harness/units.spec.ts changed')
  assert.match(result.reasons.web, /^none of the 2 changed files/)
})

test('an unknown path, an empty diff or a missing base runs everything', () => {
  assert.deepEqual(running(['some-new-tool.config.json']), EVERYTHING)
  assert.deepEqual(running([]), EVERYTHING)
  const unknown = classify(null)
  assert.deepEqual(
    AREAS.filter(area => unknown.areas[area]),
    AREAS,
  )
  assert.match(unknown.reasons.unit, /no pull request base/)
})

test('a path with a newline cannot forge an output line', () => {
  const { reasons } = classify(['docs/a\nweb=false.md', 'components/x\nunit=false.tsx'])
  for (const reason of Object.values(reasons)) assert.doesNotMatch(reason, /[\r\n]/)
})

/** A throwaway repository with one commit on main and a branch for the change. */
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'changed-areas-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  return { dir, git }
}

test('renames count both paths and deletions count the deleted path', t => {
  const { dir, git } = repoWith({
    'functions/src/old-name.ts': 'export const x = 1\n'.repeat(20),
    'components/Gone.tsx': 'export {}\n',
    'docs/a.md': '# a\n',
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  git('checkout', '-q', '-b', 'change')
  // A Functions file moved into docs still changes the Functions.
  mkdirSync(join(dir, 'docs/notes'), { recursive: true })
  renameSync(join(dir, 'functions/src/old-name.ts'), join(dir, 'docs/notes/old-name.ts'))
  rmSync(join(dir, 'components/Gone.tsx'))
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
  // main moves on after the branch: its changes are not the pull request's.
  git('checkout', '-q', 'main')
  writeFileSync(join(dir, 'package.json'), '{}\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'main moves on')

  const paths = changedPaths(git('rev-parse', 'main'), git('rev-parse', 'change'), dir)
  assert.deepEqual(paths.sort(), [
    'components/Gone.tsx',
    'docs/notes/old-name.ts',
    'functions/src/old-name.ts',
  ])
  assert.deepEqual(running(paths), ['functions', 'harness', 'signed-in', 'unit', 'web'])
})

test('a base that cannot be diffed runs everything', t => {
  const { dir, git } = repoWith({ 'docs/a.md': '# a\n' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const head = git('rev-parse', 'HEAD')
  assert.equal(changedPaths('0'.repeat(40), head, dir), null)
  assert.equal(changedPaths('', head, dir), null)
})

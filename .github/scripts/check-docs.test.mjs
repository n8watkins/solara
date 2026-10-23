import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkDocs, findLinks, findPaths, headingIds, slugify } from './check-docs.mjs'

test('slugs headings the way GitHub does', () => {
  assert.equal(
    slugify('W3-A - Billing and account lifecycle'),
    'w3-a---billing-and-account-lifecycle',
  )
  assert.equal(
    slugify('Move public build values from `secrets` to variables'),
    'move-public-build-values-from-secrets-to-variables',
  )
  assert.equal(slugify('Google sign-in and [Calendar](x.md)'), 'google-sign-in-and-calendar')
  assert.deepEqual(
    [...headingIds('# A\n## A\n```\n# not a heading\n```\n### A')],
    ['a', 'a-1', 'a-2'],
  )
})

test('finds relative links outside code and skips external ones', () => {
  const links = findLinks(
    '[a](docs/x.md#y) [b](https://example.com) `[c](no.md)`\n```\n[d](fenced.md)\n```\n[e]: ./ref.md',
  )
  assert.deepEqual(links, [
    { target: 'docs/x.md#y', line: 1 },
    { target: './ref.md', line: 5 },
  ])
})

test('treats only repository-shaped backticked text as paths', () => {
  const roots = new Set(['lib', 'functions'])
  const found = findPaths(
    '`lib/a.ts:41` `zod/mini` `users/{uid}` `functions/.env.<project>` `Dashboard.tsx` `npm test` `docs/NEW.md` (new) `.nvmrc` `calendar.freebusy`',
    roots,
  ).map(p => p.path)
  assert.deepEqual(found, ['lib/a.ts', 'Dashboard.tsx', '.nvmrc'])
})

test('reports broken links, anchors and paths, and accepts ignored outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, '.gitignore'), 'out/\n')
    writeFileSync(join(root, 'lib', 'real.ts'), '')
    writeFileSync(join(root, 'docs', 'target.md'), '# Target\n## Real section\n')
    writeFileSync(
      join(root, 'docs', 'source.md'),
      [
        '[ok](target.md#real-section) `lib/real.ts` `out/` `real.ts`',
        '[gone](missing.md) [bad anchor](target.md#nope) `lib/gone.ts` `Gone.tsx`',
      ].join('\n'),
    )
    const { errors } = checkDocs(root)
    assert.deepEqual(errors, [
      'docs/source.md:2: link target does not exist: missing.md',
      'docs/source.md:2: no heading for anchor #nope in docs/target.md',
      'docs/source.md:2: path does not exist: lib/gone.ts',
      'docs/source.md:2: path does not exist: Gone.tsx',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

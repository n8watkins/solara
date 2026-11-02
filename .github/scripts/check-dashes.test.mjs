import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkDashes, findDashes, isGenerated } from './check-dashes.mjs'

const EM = '\u2014'
// The entities, built so that this file does not match itself.
const MDASH = '&' + 'mdash;'
const DEC = '&' + '#8212;'

test('finds the em dash and the entities that render it, not hyphens or en dashes', () => {
  assert.deepEqual(
    findDashes('a.md', `fine - here\n4\u20135 too\none ${EM} two\n<p>a ${MDASH} b</p>\n${DEC}`),
    [`a.md:3: one ${EM} two`, `a.md:4: <p>a ${MDASH} b</p>`, `a.md:5: ${DEC}`],
  )
  // A test that asserts a screen shows none writes the escape, which is allowed.
  assert.deepEqual(findDashes('a.spec.ts', "not.toContainText('\\u2014')"), [])
})

test('skips generated files only', () => {
  for (const file of ['CHANGELOG.md', 'functions/CHANGELOG.md', 'package-lock.json', 'AGENTS.md']) {
    assert.equal(isGenerated(file), true, file)
  }
  for (const file of ['README.md', 'docs/AGENTS.md', 'lib/changelog.ts', 'messages/es.ts']) {
    assert.equal(isGenerated(file), false, file)
  }
})

test('checks tracked and new files, and skips ignored, generated and binary ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-dashes-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, '.gitignore'), 'out/\n')
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'out', 'page.html'), `built ${EM} output`)
    writeFileSync(join(root, 'CHANGELOG.md'), `- fix ${EM} generated`)
    writeFileSync(join(root, 'icon.png'), Buffer.from([0x89, 0, 0xe2, 0x80, 0x94]))
    writeFileSync(join(root, 'lib', 'ok.ts'), '// plain - hyphen\n')
    writeFileSync(join(root, 'lib', 'bad.ts'), `const a = 1\n// one ${EM} two\n`)
    const { errors, files } = checkDashes(root)
    assert.deepEqual(errors, [`lib/bad.ts:2: // one ${EM} two`])
    assert.equal(files, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

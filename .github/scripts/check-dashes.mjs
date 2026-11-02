#!/usr/bin/env node
// Fails when a file in the repository uses the em dash (U+2014), the owner's rule
// for code, docs, tests and UI copy alike: write a plain hyphen, or a comma, colon or
// parentheses where those read better. The HTML entities that render it count too.
//
// Every text file in the repository is checked (tracked or new, not ignored), except
// generated ones: CHANGELOG files, lockfiles and AGENTS.md (whose block `next dev`
// writes). Files with a NUL byte are binary and skipped.
//
// Tests that assert a screen shows no em dash write it as an escape (backslash, u2014).
//
// Usage: node .github/scripts/check-dashes.mjs [repo-root]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Written so that this file does not match itself.
const EM_DASH = /\u2014|&(?:mdash|#8212|#x2014);/i

/** Generated files that are not ours to edit. */
export function isGenerated(file) {
  const name = file.split('/').pop()
  return /^CHANGELOG\.md$/i.test(name) || name === 'package-lock.json' || file === 'AGENTS.md'
}

/** `file:line: text` for each line of `text` with an em dash. */
export function findDashes(file, text) {
  const found = []
  text.split('\n').forEach((line, index) => {
    if (EM_DASH.test(line)) found.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
  })
  return found
}

export function checkDashes(root) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(file => file && !isGenerated(file) && existsSync(join(root, file)))
  const errors = []
  let checked = 0
  for (const file of files) {
    const bytes = readFileSync(join(root, file))
    if (bytes.includes(0)) continue
    checked++
    errors.push(...findDashes(file, bytes.toString('utf8')))
  }
  return { errors, files: checked }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(
    process.argv[2] ??
      execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
  )
  const { errors, files } = checkDashes(root)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    console.error(
      `\n${errors.length} line(s) use the em dash (U+2014). Use a plain hyphen, or a comma, colon or parentheses.`,
    )
    process.exit(1)
  }
  console.log(`Dash check: no em dash in ${files} files.`)
}

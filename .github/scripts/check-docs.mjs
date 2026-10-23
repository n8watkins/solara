#!/usr/bin/env node
// Checks that the Markdown docs point at things that exist.
//
// For every Markdown file in the repository (tracked or new, not ignored):
// - each relative link `[text](path#anchor)` must resolve to a file or
//   directory, and an anchor into a Markdown file must match one of its
//   headings (GitHub's heading ids);
// - each backticked repository path, such as `lib/forecast.ts` or
//   `functions/src/billing/`, must exist or be a gitignored build output.
//   A path counts as a repository path when its first segment is a top-level
//   entry of the repository; a bare file name such as `Dashboard.tsx` must
//   match some tracked file. Paths with placeholders (`<id>`, `{uid}`, `*`)
//   and paths followed by "(new)" (planned files) are skipped.
//
// Archived docs (docs/archive/) describe the code as it was, so only their
// links are checked, not their backticked paths.
//
// Usage: node .github/scripts/check-docs.mjs [repo-root]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Generated files that are not ours to fix. */
const SKIP_FILES = new Set(['AGENTS.md'])
const ARCHIVE_PREFIX = 'docs/archive/'
const FILE_EXTENSIONS = new Set([
  'md',
  'json',
  'yml',
  'yaml',
  'ts',
  'tsx',
  'mts',
  'mjs',
  'js',
  'cjs',
  'css',
  'rules',
  'sh',
])

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input })
}

/** Replaces fenced code blocks with blank lines, keeping line numbers. */
export function stripFences(markdown) {
  let fence = null
  return markdown
    .split('\n')
    .map(line => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence === null && marker) {
        fence = marker
        return ''
      }
      if (fence !== null) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return ''
      }
      return line
    })
    .join('\n')
}

/** GitHub's heading id: lowercase, punctuation dropped, spaces to hyphens. */
export function slugify(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** Every heading id in a Markdown document, with GitHub's -1, -2 suffixes. */
export function headingIds(markdown) {
  const ids = new Set()
  const counts = new Map()
  for (const line of stripFences(markdown).split('\n')) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const base = slugify(match[1])
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    ids.add(seen === 0 ? base : `${base}-${seen}`)
  }
  return ids
}

/** Relative link targets in a Markdown document, with their line numbers. */
export function findLinks(markdown) {
  const links = []
  stripFences(markdown)
    .split('\n')
    .forEach((rawLine, index) => {
      const line = rawLine.replace(/`[^`]*`/g, '')
      for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        links.push({ target: match[1], line: index + 1 })
      }
      const definition = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/.exec(line)
      if (definition) links.push({ target: definition[1], line: index + 1 })
    })
  return links.filter(
    ({ target }) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('//'),
  )
}

/**
 * Backticked strings that look like repository paths, with their line
 * numbers. `rootEntries` is the set of top-level names in the repository.
 */
export function findPaths(markdown, rootEntries) {
  const paths = []
  stripFences(markdown)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/`([^`\n]+)`/g)) {
        const after = line.slice(match.index + match[0].length)
        if (/^\s*\(new\)/.test(after)) continue
        let text = match[1].trim()
        if (/[\s<>{}*$|=?'"()[\],;]|:\/\/|^[-@#~]/.test(text)) continue
        text = text.replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '')
        if (text.includes('/')) {
          if (!rootEntries.has(text.split('/')[0])) continue
        } else {
          const extension = /\.([A-Za-z0-9]+)$/.exec(text)?.[1]
          const isDotfile = /^\.[\w.-]+$/.test(text)
          if (!isDotfile && !(extension && FILE_EXTENSIONS.has(extension))) continue
        }
        paths.push({ path: text, line: index + 1 })
      }
    })
  return paths
}

export function checkDocs(root) {
  const listed = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
  const tracked = new Set(listed)
  const basenames = new Set(listed.map(file => file.split('/').pop()))
  const rootEntries = new Set(listed.map(file => file.split('/')[0]))
  const markdownFiles = listed.filter(
    file => file.endsWith('.md') && !SKIP_FILES.has(file) && existsSync(join(root, file)),
  )

  const headingCache = new Map()
  const headingsOf = file => {
    if (!headingCache.has(file)) headingCache.set(file, headingIds(readFileSync(file, 'utf8')))
    return headingCache.get(file)
  }
  const ignoredCache = new Map()
  const isIgnored = path => {
    if (!ignoredCache.has(path)) {
      let ignored = true
      try {
        git(root, ['check-ignore', '-q', '--no-index', path])
      } catch {
        ignored = false
      }
      ignoredCache.set(path, ignored)
    }
    return ignoredCache.get(path)
  }

  const errors = []
  for (const file of markdownFiles) {
    const absolute = join(root, file)
    const markdown = readFileSync(absolute, 'utf8')

    for (const { target, line } of findLinks(markdown)) {
      const [rawPath = '', anchor] = target.split('#')
      let path
      try {
        path = decodeURIComponent(rawPath)
      } catch {
        errors.push(`${file}:${line}: malformed link ${target}`)
        continue
      }
      const resolved =
        path === ''
          ? absolute
          : resolve(path.startsWith('/') ? root : dirname(absolute), path.replace(/^\//, ''))
      const inRepo = relative(root, resolved)
      if (inRepo.startsWith('..') || !existsSync(resolved)) {
        errors.push(`${file}:${line}: link target does not exist: ${target}`)
        continue
      }
      if (
        anchor &&
        resolved.endsWith('.md') &&
        statSync(resolved).isFile() &&
        !headingsOf(resolved).has(anchor)
      ) {
        errors.push(
          `${file}:${line}: no heading for anchor #${anchor} in ${normalize(inRepo).split(sep).join('/')}`,
        )
      }
    }

    if (file.startsWith(ARCHIVE_PREFIX)) continue
    for (const { path, line } of findPaths(markdown, rootEntries)) {
      const exists = path.includes('/')
        ? existsSync(join(root, path)) || isIgnored(path)
        : tracked.has(path) ||
          basenames.has(path) ||
          existsSync(join(root, path)) ||
          isIgnored(path)
      if (!exists) errors.push(`${file}:${line}: path does not exist: ${path}`)
    }
  }
  return { errors, files: markdownFiles.length }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(
    process.argv[2] ?? git(process.cwd(), ['rev-parse', '--show-toplevel']).trim(),
  )
  const { errors, files } = checkDocs(root)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    console.error(`\n${errors.length} broken doc reference(s) in ${files} Markdown files.`)
    process.exit(1)
  }
  console.log(`Docs check: every link and repository path in ${files} Markdown files resolves.`)
}

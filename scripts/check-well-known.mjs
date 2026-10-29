#!/usr/bin/env node
// Proves the export ships every file in public/.well-known/ as it is, ready for Android
// App Links (docs/integrations/ANDROID.md): /.well-known/assetlinks.json must be served
// byte for byte, from `https://solara-uv.web.app/.well-known/`, as valid JSON (Hosting
// serves .json as application/json, which Android checks). The folder starts with a dot,
// so this guards the copy from public/ (Next.js) and every later build step against
// dropping or rewriting it; tests/well-known.test.ts checks the upload list and headers.
//
// Runs after `npm run build` (postbuild). Usage: node scripts/check-well-known.mjs
// [publicDir] [exportDir]   (default: public out)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

function filesUnder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** The problems with the export's /.well-known/ files; empty when it ships them all intact. */
export function wellKnownProblems(publicDir, exportDir) {
  const source = join(publicDir, '.well-known')
  const problems = []
  for (const file of filesUnder(source)) {
    const name = relative(source, file)
    const shipped = join(exportDir, '.well-known', name)
    if (!existsSync(shipped)) {
      problems.push(`.well-known/${name} is missing from ${exportDir}`)
      continue
    }
    const bytes = readFileSync(file)
    if (!bytes.equals(readFileSync(shipped))) {
      problems.push(`.well-known/${name} changed on its way into ${exportDir}`)
    }
    if (name.endsWith('.json')) {
      try {
        JSON.parse(bytes.toString('utf8'))
      } catch {
        problems.push(`.well-known/${name} is not valid JSON`)
      }
    } else if (!name.includes('.')) {
      // Hosting picks a type from the extension; a file without one (Apple's
      // apple-app-site-association) needs a Content-Type header in firebase.json.
      problems.push(`.well-known/${name} has no extension: give it a Content-Type in firebase.json`)
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [publicDir = 'public', exportDir = 'out'] = process.argv.slice(2)
  const problems = wellKnownProblems(publicDir, exportDir)
  if (problems.length) {
    for (const problem of problems) console.error(`check-well-known: ${problem}`)
    process.exit(1)
  }
  const count = filesUnder(join(publicDir, '.well-known')).length
  console.log(`check-well-known: ${exportDir}/.well-known ships ${count} file(s) intact.`)
}

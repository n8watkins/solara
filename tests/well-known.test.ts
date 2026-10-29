// Android App Links need https://solara-uv.web.app/.well-known/assetlinks.json served as
// application/json (docs/integrations/ANDROID.md). It is not added yet (no package name
// exists), so this proves the way there with a stand-in file: the export check keeps a
// .well-known file intact, the Hosting upload includes it although firebase.json ignores
// dot files, and no header rule changes the JSON type Hosting gives it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { wellKnownProblems } from '../scripts/check-well-known.mjs'

const require = createRequire(import.meta.url)
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
  hosting: Array<{
    site: string
    public: string
    ignore: string[]
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }>
}
const site = firebase.hosting.find(entry => entry.public === 'out')!
const ASSET_LINKS = '[{"relation":["delegate_permission/common.handle_all_urls"]}]\n'

const dirs: string[] = []
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'solara-well-known-'))
  dirs.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the export check (scripts/check-well-known.mjs)', () => {
  it('passes when every .well-known file ships intact, and with none', () => {
    const root = tree({
      'public/.well-known/assetlinks.json': ASSET_LINKS,
      'out/.well-known/assetlinks.json': ASSET_LINKS,
    })
    expect(wellKnownProblems(join(root, 'public'), join(root, 'out'))).toEqual([])
    const empty = tree({ 'public/icon.png': '' })
    expect(wellKnownProblems(join(empty, 'public'), join(empty, 'out'))).toEqual([])
  })

  it('fails a missing, changed, invalid or untyped file', () => {
    const root = tree({
      'public/.well-known/assetlinks.json': ASSET_LINKS,
      'public/.well-known/broken.json': '{',
      'public/.well-known/apple-app-site-association': '{}',
      'out/.well-known/broken.json': '{',
      'out/.well-known/apple-app-site-association': '{}',
    })
    expect(wellKnownProblems(join(root, 'public'), join(root, 'out'))).toEqual([
      expect.stringContaining('apple-app-site-association has no extension'),
      expect.stringContaining('assetlinks.json is missing'),
      '.well-known/broken.json is not valid JSON',
    ])
    writeFileSync(join(root, 'out/.well-known/assetlinks.json'), '[]')
    expect(wellKnownProblems(join(root, 'public'), join(root, 'out'))).toContain(
      `.well-known/assetlinks.json changed on its way into ${join(root, 'out')}`,
    )
  })
})

describe('Firebase Hosting', () => {
  it('uploads .well-known files although it ignores dot files', () => {
    // firebase-tools' own upload list (lib/listFiles.js), with firebase.json's ignore.
    const { listFiles } = require('../functions/node_modules/firebase-tools/lib/listFiles.js') as {
      listFiles: (cwd: string, ignore: string[]) => string[]
    }
    const root = tree({
      'index.html': '',
      '.well-known/assetlinks.json': ASSET_LINKS,
      '.DS_Store': '',
      'app/.hidden': '',
    })
    const uploaded = listFiles(root, site.ignore)
    expect(uploaded).toContain('.well-known/assetlinks.json')
    expect(uploaded).toContain('index.html')
    // The ignore still drops stray dot files.
    expect(uploaded).not.toContain('.DS_Store')
    expect(uploaded).not.toContain('app/.hidden')
  })

  it('sets no header that would change the type of a .well-known file', () => {
    for (const rule of site.headers ?? []) {
      for (const header of rule.headers) {
        if (header.key.toLowerCase() !== 'content-type') continue
        // A Content-Type rule must not reach /.well-known/assetlinks.json.
        expect(rule.source).not.toMatch(/^\*\*$|well-known|\*\*\/\*\.json|\*\.json/)
      }
    }
  })
})

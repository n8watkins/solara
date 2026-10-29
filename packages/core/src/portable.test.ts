// @solara/core is shared with Cloud Functions and, later, a React Native app (ROADMAP
// item 13, docs/integrations/ANDROID.md), so its source stays free of the browser, of
// Node and of the web app: Valibot is its only dependency. This checks the source text.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dir = new URL('./', import.meta.url)
const sources = readdirSync(dir)
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map(name => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }))

/** The source with comments and string contents removed, so only code is checked. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"/g, "''")
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['document', /\bdocument\s*\./],
  ['the global window', /\b(?:globalThis\.window|typeof window)\b/],
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['navigator', /\bnavigator\s*\./],
  ['indexedDB', /\bindexedDB\b/],
  ['Web Crypto (missing on Hermes)', /\bcrypto\s*\.\s*subtle\b/],
  ['TextEncoder (keep encodings in core)', /\bTextEncoder\b/],
  ['Buffer (Node only)', /\bBuffer\s*\./],
  ['process (Node only)', /\bprocess\s*\./],
]

describe('core stays portable', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(30)
  })

  it.each(sources)('$name uses no browser or Node globals', ({ text }) => {
    const body = code(text)
    for (const [what, pattern] of FORBIDDEN) expect(body, what).not.toMatch(pattern)
  })

  it.each(sources)('$name imports only core modules and Valibot', ({ text }) => {
    const imports = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+'([^']+)'/gm)].map(
      match => match[1],
    )
    for (const spec of imports) expect(spec).toMatch(/^(?:\.\/[a-z0-9-]+|valibot)$/)
  })
})

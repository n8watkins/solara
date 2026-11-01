// The message catalogues (docs/i18n/README.md): every language has every message, each
// translation prints every value its English message prints, the opening screen's
// translations arrive with the first chunk, and the native-review sheet is current.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALES, registeredNamespaces, type Messages } from '@solara/core/i18n'
import * as staticText from './static'
import initial from './es/initial'
import rest from './es/rest'
import { reviewSheet } from './review-sheet'

// Every English namespace registers when its module loads.
const english = import.meta.glob(['./*.ts', '../packages/core/src/messages/*.ts', '!./*.test.ts'], {
  eager: true,
})
const spanishModules = import.meta.glob<{ needsReview?: string[] }>(
  ['./es/*.ts', '../packages/core/src/messages/es/*.ts'],
  { eager: true },
)
const spanish: Record<string, Messages> = { ...initial, ...rest }
const sources = registeredNamespaces()

/** Calls a message with numbered values in every parameter (numbers, then string lists). */
function render(message: Messages[string], arity: number, offset: number): string {
  if (typeof message === 'string') return message
  return call(
    message,
    Array.from({ length: arity }, (_, i) => 7001 + offset + i),
  )
}

/** Calls a message with numbers, else as text, else as lists of one ("a, b and c"). */
function call(message: (...args: never[]) => string, values: number[]): string {
  for (const args of [values, values.map(String), values.map(n => [String(n)])]) {
    try {
      return message(...(args as never[]))
    } catch {
      // Not this kind of parameter: try the next.
    }
  }
  throw new Error('The message accepts no kind of value')
}

describe('message catalogues', () => {
  it('has the English namespaces loaded', () => {
    expect(Object.keys(english).length).toBeGreaterThan(5)
    expect(sources.size).toBeGreaterThan(5)
  })

  it('translates every namespace into Spanish, once', () => {
    expect(Object.keys(initial).filter(ns => ns in rest)).toEqual([])
    expect(Object.keys(spanish).sort()).toEqual([...sources.keys()].sort())
  })

  for (const [namespace, source] of sources) {
    describe(namespace, () => {
      const translation = spanish[namespace] ?? {}
      it('has the same messages in Spanish', () => {
        expect(Object.keys(translation).sort()).toEqual(Object.keys(source).sort())
      })
      it.each(Object.keys(source))('%s prints the same values in Spanish', key => {
        const en = source[key]!
        const es = translation[key]!
        expect(typeof es).toBe(typeof en)
        const arity = typeof en === 'function' ? en.length : 0
        if (typeof es === 'function') expect(es.length).toBe(arity)
        // Two sets of values, so a plural or a condition shows each of its forms.
        for (const offset of [0, 100]) {
          const enText = render(en, arity, offset)
          const esText = render(es, arity, offset)
          expect(esText.trim()).not.toBe('')
          for (const value of enText.match(/7\d{3}/g) ?? []) expect(esText).toContain(value)
        }
        // And with ones, the singular forms.
        if (typeof en === 'function' && typeof es === 'function') {
          const ones = Array.from({ length: arity }, () => 1)
          expect(call(es, ones).trim()).not.toBe('')
        }
      })
    })
  }

  it('never uses the em dash', () => {
    for (const [namespace, source] of sources) {
      for (const [key, message] of Object.entries({ ...source, ...spanish[namespace] })) {
        const text = render(message, typeof message === 'function' ? message.length : 0, 0)
        expect(text, `${namespace}.${key}`).not.toContain('\u2014')
      }
    }
  })

  it('marks only existing messages for native review', () => {
    for (const [file, spanishModule] of Object.entries(spanishModules)) {
      const namespace = Object.entries(spanish).find(
        ([, t]) => t === (spanishModule as never)['default'],
      )
      if (!spanishModule.needsReview) continue
      expect(namespace, file).toBeDefined()
      for (const key of spanishModule.needsReview)
        expect(namespace![1], `${file}: ${key}`).toHaveProperty(key)
    }
  })

  it('writes every static text in every language', () => {
    for (const [name, text] of Object.entries(staticText)) {
      for (const locale of LOCALES) expect(text[locale]?.trim(), `${name}.${locale}`).toBeTruthy()
    }
  })
})

// The app shows once the opening screen's translations have arrived (lib/i18n.ts), so
// every namespace a module of the first load reads must be in that chunk.
describe('the opening screen chunk', () => {
  const root = resolve(__dirname, '..')

  function resolveImport(from: string, spec: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = join(root, spec.slice(2))
    else if (spec.startsWith('@solara/core/'))
      base = join(root, 'packages/core/src', spec.slice(13))
    else if (spec === '@solara/core') base = join(root, 'packages/core/src/index')
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
    else return null
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
      if (existsSync(base + ext) && /\.(tsx?|mts)$/.test(base + ext)) return base + ext
    }
    return null
  }

  /** Every module the entries import statically (dynamic imports load on demand). */
  function firstLoad(entries: string[]): Set<string> {
    const seen = new Set<string>()
    const stack = entries.map(entry => join(root, entry))
    while (stack.length) {
      const file = stack.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      const imports = text.matchAll(
        /^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm,
      )
      for (const [, typeOnly, spec, bare] of imports) {
        if (typeOnly) continue
        const next = resolveImport(file, (spec ?? bare)!)
        if (next) stack.push(next)
      }
    }
    return seen
  }

  it('holds every namespace the first load reads', () => {
    const modules = firstLoad(['app/app/page.tsx', 'app/layout.tsx'])
    const namespaces = new Set<string>()
    for (const file of modules) {
      const match = /defineMessages\('([^']+)'/.exec(readFileSync(file, 'utf8'))
      if (match && !file.includes('/es/')) namespaces.add(match[1]!)
    }
    expect(namespaces.size).toBeGreaterThan(3)
    expect([...namespaces].filter(ns => !(ns in initial)).sort()).toEqual([])
  })
})

describe('the native review sheet', () => {
  const path = resolve(__dirname, '../docs/i18n/es-review.md')
  afterEach(() => vi.unstubAllEnvs())

  it('is up to date (UPDATE_I18N_REVIEW=1 npx vitest run messages rewrites it)', () => {
    const sheet = reviewSheet(sources, spanish, spanishModules)
    if (process.env.UPDATE_I18N_REVIEW === '1') writeFileSync(path, sheet)
    expect(readFileSync(path, 'utf8')).toBe(sheet)
  })
})

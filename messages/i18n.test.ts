// The message catalogues (docs/i18n/README.md): every language has every message, each
// translation prints every value its English message prints, the opening screen's
// translations arrive with the first chunk, every part that loads on demand fetches the
// translations it shows, and the native-review sheet is current.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALES, registeredNamespaces, type Messages } from '@solara/core/i18n'
import { SERVER_TRANSLATIONS } from '@solara/core/server-language'
import * as staticText from './static'
import initial from './es/initial'
import lazyLoaders from './es/lazy'
import pages from './es/pages'
import { reviewSheet } from './review-sheet'

// Every English namespace registers when its module loads.
const english = import.meta.glob(['./*.ts', '../packages/core/src/messages/*.ts', '!./*.test.ts'], {
  eager: true,
})
const spanishModules = import.meta.glob<{ needsReview?: string[] }>(
  ['./es/*.ts', '../packages/core/src/messages/es/*.ts'],
  { eager: true },
)
/** Text only the Functions write (pushes, the calendar feed); the app never shows it. */
const SERVER_ONLY = ['server']
const server = Object.fromEntries(
  Object.entries(SERVER_TRANSLATIONS.es).filter(([namespace]) => SERVER_ONLY.includes(namespace)),
)
/** Every namespace the opening screen does not read, each a chunk of its own (lib/i18n.ts). */
const lazy: Record<string, Messages> = Object.fromEntries(
  await Promise.all(
    Object.entries(lazyLoaders).map(
      async ([namespace, load]) => [namespace, (await load()).default as Messages] as const,
    ),
  ),
)
const spanish: Record<string, Messages> = {
  ...initial,
  ...lazy,
  ...server,
  ...pages,
}
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
    expect(Object.keys(initial).filter(ns => ns in lazy)).toEqual([])
    expect(SERVER_ONLY.filter(ns => ns in initial || ns in lazy)).toEqual([])
    // The static pages' own words are built into their HTML, never the app's chunks.
    expect(Object.keys(pages).filter(ns => ns in initial || ns in lazy)).toEqual([])
    expect(Object.keys(spanish).sort()).toEqual([...sources.keys()].sort())
  })

  it('gives the Functions every shared namespace in Spanish, the same as the app', () => {
    const shared = Object.keys(english)
      .filter(file => file.includes('packages/core/'))
      .map(
        file =>
          /defineMessages\('([^']+)'/.exec(readFileSync(resolve(__dirname, file), 'utf8'))![1]!,
      )
    expect(Object.keys(SERVER_TRANSLATIONS.es).sort()).toEqual(shared.sort())
    expect(Object.keys(SERVER_TRANSLATIONS.en)).toEqual([])
    for (const [namespace, translation] of Object.entries(SERVER_TRANSLATIONS.es))
      expect(translation, namespace).toBe(spanish[namespace])
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

// How the app's modules import each other, for the two checks below.
const root = resolve(__dirname, '..')

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(root, spec.slice(2))
  else if (spec.startsWith('@solara/core/')) base = join(root, 'packages/core/src', spec.slice(13))
  else if (spec === '@solara/core') base = join(root, 'packages/core/src/index')
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    if (existsSync(base + ext) && /\.(tsx?|mts)$/.test(base + ext)) return base + ext
  }
  return null
}

/** Every module the entries import statically (dynamic imports load on demand). */
function staticImports(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...entries]
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

/** The message namespaces the modules define (the English catalogues they import). */
function namespacesOf(modules: Set<string>): Set<string> {
  const namespaces = new Set<string>()
  for (const file of modules) {
    const match = /defineMessages\(\s*'([^']+)'/.exec(readFileSync(file, 'utf8'))
    if (match && !file.includes('/es/')) namespaces.add(match[1]!)
  }
  return namespaces
}

/** What a module and its static imports read beyond the opening screen's namespaces. */
function lazyNamespacesOf(entry: string): string[] {
  return [...namespacesOf(staticImports([entry]))]
    .filter(ns => !(ns in initial) && !SERVER_ONLY.includes(ns))
    .sort()
}

// The app shows once the opening screen's translations have arrived (lib/i18n.ts), so
// every namespace a module of the first load reads must be in that chunk.
describe('the opening screen chunk', () => {
  it('holds every namespace the first load reads', () => {
    const namespaces = namespacesOf(
      staticImports(['app/app/page.tsx', 'app/layout.tsx'].map(entry => join(root, entry))),
    )
    expect(namespaces.size).toBeGreaterThan(3)
    // The activity plan's own text loads with it (REVIEW10 QA M1).
    expect(namespaces.has('activities')).toBe(false)
    // The barrel (@solara/core) brings the push builders' messages, which the app never shows.
    expect(
      [...namespaces].filter(ns => !(ns in initial) && !SERVER_ONLY.includes(ns)).sort(),
    ).toEqual([])
  })
})

// Every other namespace loads with the part that shows it (lib/i18n.ts withMessages), so a
// part must name exactly the namespaces its code reads: one it forgets shows in English,
// one it names for nothing is downloaded for nothing.
describe('the parts that load on demand', () => {
  /** The app's source files (tests and the UI harness aside). */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'harness' ? [] : sourceFiles(path)
      return /\.tsx?$/.test(name) && !/\.(test|harness)\.tsx?$/.test(name) ? [path] : []
    })
  }
  const files = ['app', 'components', 'hooks', 'lib'].flatMap(dir => sourceFiles(join(root, dir)))

  /** Each `import('...')` of an app module, with the namespaces its call names, if any. */
  const boundaries = files.flatMap(file => {
    const text = readFileSync(file, 'utf8')
    return [...text.matchAll(/import\(\s*'([^']+)'\s*\)/g)].flatMap(match => {
      const target = resolveImport(file, match[1]!)
      if (!target || target.includes('/messages/')) return []
      const before = text.slice(Math.max(0, match.index - 400), match.index)
      const named = /withMessages\(\s*\[([^\]]*)\]\s*,\s*\(\)\s*=>\s*$/.exec(before)
      return [
        {
          at: `${relative(root, file)} -> ${match[1]}`,
          target,
          named: named ? [...named[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!).sort() : null,
        },
      ]
    })
  })

  it('finds the parts', () => {
    expect(boundaries.length).toBeGreaterThan(30)
  })

  it('names, in withMessages, exactly the namespaces each part reads', () => {
    const wrong = boundaries.flatMap(({ at, target, named }) => {
      const reads = lazyNamespacesOf(target)
      if (reads.length === 0 && named === null) return []
      return JSON.stringify(named) === JSON.stringify(reads)
        ? []
        : [`${at}: withMessages(${JSON.stringify(reads)}, ...), not ${JSON.stringify(named)}`]
    })
    expect(wrong).toEqual([])
  })

  it('gives each page outside the app the namespaces it reads (MessagesGate)', () => {
    const pages = files.filter(file => readFileSync(file, 'utf8').includes('<MessagesGate'))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      const gate = /<MessagesGate[^>]*\smessages=\{\[([^\]]*)\]\}/.exec(readFileSync(page, 'utf8'))
      const named = gate ? [...gate[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!).sort() : null
      expect(named, relative(root, page)).toEqual(lazyNamespacesOf(page))
    }
  })

  it('has a loader for every namespace the opening screen does not read', () => {
    const all = Object.keys(spanish).filter(
      ns => !(ns in initial) && !(ns in pages) && !SERVER_ONLY.includes(ns),
    )
    expect(Object.keys(lazy).sort()).toEqual(all.sort())
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

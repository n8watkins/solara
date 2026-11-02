import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

// Libraries that load on demand and must never be part of a guest's first load
// (ROADMAP item 52), each recognised in a built script by text only its own code
// carries. The budget tests (budget/first-load.budget.ts) check that every one of
// them is still in the build somewhere, so a library update that changes its text
// fails there instead of making the check pass by matching nothing.
export const ON_DEMAND_MODULES: readonly { name: string; text: RegExp }[] = [
  // Every Valibot schema carries its Standard Schema vendor name.
  { name: 'Valibot', text: /vendor:"valibot"/ },
  // The SDK's core registers its own name and version.
  { name: 'the Firebase SDK', text: /"@firebase\/app"/ },
  { name: 'Firebase Auth', text: /identitytoolkit\.googleapis\.com/ },
  { name: 'Firestore', text: /firestore\.googleapis\.com/ },
  // Google Analytics' loader (lib/analytics-runtime.ts), after consent only.
  { name: 'Google Analytics', text: /googletagmanager\.com/ },
]

/** The on-demand modules whose text is in `script`. */
export function onDemandModulesIn(script: string): string[] {
  return ON_DEMAND_MODULES.filter(({ text }) => text.test(script)).map(({ name }) => name)
}

/** Every script of the static export in `siteDir`, as text. */
export function builtScripts(siteDir: string): string[] {
  const dir = join(siteDir, '_next/static/chunks')
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.js'))
    .map(file => readFileSync(join(dir, file), 'utf8'))
}

/**
 * Records the same-origin scripts `page` downloads from now on. `scripts()` gives their
 * URLs (without the origin) and text, once every response that has arrived has a body.
 */
export function recordScripts(page: Page, origin: string) {
  const loaded: Promise<{ url: string; body: Buffer }>[] = []
  page.on('response', response => {
    if (response.request().resourceType() !== 'script') return
    if (!response.url().startsWith(origin)) return
    loaded.push(response.body().then(body => ({ url: response.url().slice(origin.length), body })))
  })
  return { scripts: () => Promise.all(loaded) }
}

// Shared screenshot and axe capture for the harness specs that add screens
// (public-pages.spec.ts, shell-overlays.spec.ts). Output matches ui-harness.spec.ts:
// test-results/ui-harness/screenshots/<screen>--<project>.png and axe/<...>.json,
// which axe-summary.ts merges into the report.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { HARNESS_NOW_MS, startClock } from './clock'
import { freezeScreen } from './freeze'

const OUTPUT_DIR = join('test-results', 'ui-harness')

export interface Capture {
  colorScheme: 'light' | 'dark'
  /** Off-origin requests that were blocked. */
  blocked: string[]
  pageErrors: string[]
  /** When the fake clock started (epoch ms). */
  startedAt: number
}

/**
 * Prepares a page for a deterministic capture: records page errors, blocks every
 * off-origin request except those `answer` fulfills (it returns true when it
 * handled the route), starts the frozen clock and pins the project's theme.
 */
export async function preparePage(
  page: Page,
  testInfo: TestInfo,
  answer?: (route: Route, url: URL) => Promise<void> | void | false,
  { at = HARNESS_NOW_MS }: { at?: number } = {},
): Promise<Capture> {
  const capture: Capture = {
    colorScheme: testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light',
    blocked: [],
    pageErrors: [],
    startedAt: at,
  }
  page.on('pageerror', err => capture.pageErrors.push(err.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.hostname === '127.0.0.1') return route.continue()
    if (answer && (await answer(route, url)) !== false) return
    capture.blocked.push(url.href)
    return route.abort('blockedbyclient')
  })
  await startClock(page, at)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, capture.colorScheme)
  return capture
}

/** Freezes the page, writes its screenshot and axe report, and fails on page errors. */
export async function captureScreen(
  page: Page,
  testInfo: TestInfo,
  capture: Capture,
  screen: { name: string; fullPage: boolean },
) {
  await expect(page.locator('html')).toHaveClass(
    capture.colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/,
  )
  await freezeScreen(page, capture.startedAt)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForLoadState('networkidle')

  const shotDir = join(OUTPUT_DIR, 'screenshots')
  mkdirSync(shotDir, { recursive: true })
  const shotPath = join(shotDir, `${screen.name}--${testInfo.project.name}.png`)
  await page.screenshot({
    path: shotPath,
    fullPage: screen.fullPage,
    animations: 'disabled',
    caret: 'hide',
  })
  await testInfo.attach('screenshot', { path: shotPath, contentType: 'image/png' })

  // axe-core schedules work with timers; let the (still frozen-date) clock run.
  await page.clock.resume()
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  const axeDir = join(OUTPUT_DIR, 'axe')
  mkdirSync(axeDir, { recursive: true })
  const report = {
    screen: screen.name,
    project: testInfo.project.name,
    url: page.url(),
    blockedRequests: capture.blocked,
    pageErrors: capture.pageErrors,
    violations: axe.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })),
    })),
  }
  const axePath = join(axeDir, `${screen.name}--${testInfo.project.name}.json`)
  writeFileSync(axePath, JSON.stringify(report, null, 2) + '\n')
  await testInfo.attach('axe', { path: axePath, contentType: 'application/json' })

  expect(capture.pageErrors, 'uncaught page errors').toEqual([])
}

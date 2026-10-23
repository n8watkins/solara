import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MAX_SETTLE_MS, pauseClock, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Screenshots and axe results for the signed-in UI, rendered from fixtures at a
// frozen instant. This suite records; it does not compare against baselines and
// does not fail on accessibility violations. Later lanes use the output for
// before/after evidence.
const OUTPUT_DIR = join('test-results', 'ui-harness')

const SCREENS = [
  {
    name: 'dashboard',
    ready: (page: Page) => page.getByRole('button', { name: /Today/ }).first(),
    fullPage: true,
  },
  {
    name: 'calendar',
    ready: (page: Page) => page.getByText('Mon', { exact: false }).first(),
    fullPage: true,
  },
  {
    name: 'settings',
    ready: (page: Page) => page.getByText('Skin type', { exact: false }).first(),
    fullPage: false,
  },
  {
    name: 'pricing',
    ready: (page: Page) => page.getByText('Solara Pro', { exact: true }),
    fullPage: false,
  },
] as const

// Only Google Fonts may load (the app imports Inter from there today). Anything
// else off-origin would make screenshots depend on the network, so it is blocked
// and reported.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'])

async function prepare(page: Page, colorScheme: 'light' | 'dark') {
  const blocked: string[] = []
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || ALLOWED_HOSTS.has(url.hostname)) return route.continue()
    blocked.push(url.href)
    return route.abort('blockedbyclient')
  })
  await startClock(page)
  // The app does not follow the system theme yet (REPORT UX-8); it reads its own key.
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  return blocked
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  // Two animation frames' worth of layout after fonts swap in.
  await page.waitForLoadState('networkidle')
}

for (const screen of SCREENS) {
  test(`${screen.name}`, async ({ page }, testInfo) => {
    const colorScheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))
    const blocked = await prepare(page, colorScheme)

    await page.goto(`/harness/?screen=${screen.name}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', screen.name)
    await expect(screen.ready(page)).toBeVisible()
    await expect(page.locator('html')).toHaveClass(
      colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/,
    )
    const elapsed = await pauseClock(page)
    expect(elapsed, 'fake clock ran too long before pausing; timers may have fired').toBeLessThan(
      MAX_SETTLE_MS,
    )
    await settle(page)

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
      blockedRequests: blocked,
      pageErrors,
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

    // Report-only for accessibility; hard failures are reserved for a broken harness.
    expect(pageErrors, 'uncaught page errors').toEqual([])
  })
}

test('production leak check detects a harness build', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'build-level check, run once')
  // The harness export must trip scripts/check-no-ui-harness.mjs; otherwise the
  // postbuild check that guards `out/` would be proving nothing.
  let status = 0
  try {
    execFileSync(process.execPath, ['scripts/check-no-ui-harness.mjs', join(OUTPUT_DIR, 'site')], {
      stdio: 'pipe',
    })
  } catch (error) {
    status = (error as { status?: number }).status ?? -1
  }
  expect(status).toBe(1)
})

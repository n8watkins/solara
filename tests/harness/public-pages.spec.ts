import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { HARNESS_DATE, MAX_SETTLE_MS, pauseClock, startClock } from './clock'

// Screenshots and axe results for the screens a visitor sees before signing in:
// welcome, each onboarding step, the legal pages, share links, the account page
// signed out and the 404 page. Same output layout as ui-harness.spec.ts (it lands
// in test-results/ui-harness/ and in the axe summary), so before/after evidence for
// the shell covers every page, not only the signed-in ones.
const OUTPUT_DIR = join('test-results', 'ui-harness')

// The onboarding steps call Open-Meteo for place search and the current UV; these
// answers stand in for it so the screenshots never depend on the network.
const GEOCODE = /^https:\/\/geocoding-api\.open-meteo\.com\//
const FORECAST = /^https:\/\/api\.open-meteo\.com\//
const PLACE = {
  results: [
    {
      name: 'Pasadena',
      admin1: 'California',
      country: 'United States',
      latitude: 34.1478,
      longitude: -118.1445,
    },
  ],
}

function json(route: Route, body: unknown) {
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
}

function shiftDate(days: number): string {
  const d = new Date(`${HARNESS_DATE}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const SHARE = `/share/?a=Run&icon=%F0%9F%8F%83&city=Pasadena&region=California&from=7.5&to=8.5&uv=2.1`

async function startOnboarding(page: Page) {
  await page.getByRole('button', { name: /Get started/ }).click()
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
}

async function searchCity(page: Page) {
  await startOnboarding(page)
  await page.getByLabel('City or location').fill('Pasadena')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText('UV index right now in')).toBeVisible()
}

async function chooseSkin(page: Page) {
  await searchCity(page)
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Your skin type' })).toBeVisible()
}

interface Screen {
  name: string
  path: string
  fullPage: boolean
  /** Brings the page to the state to capture and returns an element that proves it. */
  reach: (page: Page) => Promise<Locator> | Locator
}

const SCREENS: Screen[] = [
  {
    name: 'welcome',
    path: '/',
    fullPage: true,
    reach: page => page.getByRole('heading', { name: 'Know when to go outside' }),
  },
  {
    name: 'onboarding-location',
    path: '/',
    fullPage: false,
    reach: async page => {
      await startOnboarding(page)
      return page.getByRole('button', { name: /Use my location/ })
    },
  },
  {
    name: 'onboarding-location-error',
    path: '/',
    fullPage: false,
    reach: async page => {
      await startOnboarding(page)
      await page.getByLabel('City or location').fill('Nowhere')
      await page.getByRole('button', { name: 'Go' }).click()
      return page.getByText('City not found. Try a different spelling.')
    },
  },
  {
    name: 'onboarding-uv',
    path: '/',
    fullPage: false,
    reach: async page => {
      await searchCity(page)
      return page.getByText('6.4', { exact: true })
    },
  },
  {
    name: 'onboarding-skin',
    path: '/',
    fullPage: false,
    reach: async page => {
      await chooseSkin(page)
      return page.getByRole('button', { name: /Fair/, pressed: true })
    },
  },
  {
    name: 'onboarding-signin',
    path: '/',
    fullPage: false,
    reach: async page => {
      await chooseSkin(page)
      await page.getByRole('button', { name: /Continue/ }).click()
      return page.getByRole('heading', { name: 'Sign in to finish' })
    },
  },
  {
    name: 'privacy',
    path: '/privacy/',
    fullPage: true,
    reach: page => page.getByRole('heading', { level: 1, name: 'Privacy Policy' }),
  },
  {
    name: 'terms',
    path: '/terms/',
    fullPage: true,
    reach: page => page.getByRole('heading', { level: 1, name: 'Terms of Use' }),
  },
  {
    name: 'share',
    path: `${SHARE}&date=${shiftDate(1)}`,
    fullPage: true,
    reach: page => page.getByRole('heading', { level: 1, name: 'Run' }),
  },
  {
    name: 'share-past',
    path: `${SHARE}&date=${shiftDate(-3)}`,
    fullPage: true,
    reach: page => page.getByRole('status'),
  },
  {
    name: 'share-invalid',
    path: '/share/?a=Run',
    fullPage: true,
    reach: page => page.getByRole('heading', { level: 1, name: "This shared link can't be shown" }),
  },
  {
    name: 'account-signed-out',
    path: '/account/',
    fullPage: true,
    reach: page => page.getByRole('heading', { name: 'Sign in required' }),
  },
  {
    name: 'not-found',
    path: '/no-such-page/',
    fullPage: true,
    reach: page => page.getByRole('heading', { level: 1, name: 'Page not found' }),
  },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const colorScheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))

    const blocked: string[] = []
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (GEOCODE.test(url.href)) {
        return json(route, url.searchParams.get('name') === 'Pasadena' ? PLACE : { results: [] })
      }
      if (FORECAST.test(url.href)) return json(route, { current: { uv_index: 6.4 } })
      if (url.protocol === 'data:' || url.hostname === '127.0.0.1') return route.continue()
      blocked.push(url.href)
      return route.abort('blockedbyclient')
    })
    await startClock(page)
    await page.addInitScript(theme => {
      try {
        window.localStorage.setItem('solara_theme', theme)
      } catch {}
    }, colorScheme)

    await page.goto(screen.path)
    await expect(await screen.reach(page)).toBeVisible()
    await expect(page.locator('html')).toHaveClass(
      colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/,
    )
    const elapsed = await pauseClock(page)
    expect(elapsed, 'fake clock ran too long before pausing').toBeLessThan(MAX_SETTLE_MS)
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

    expect(pageErrors, 'uncaught page errors').toEqual([])
  })
}

import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_DATE } from './clock'

// Screenshots and axe results for the screens a visitor sees before signing in:
// the landing page, the sign-in screen, each onboarding step, the legal pages, share links, the account page
// signed out and the 404 page. Same output layout as ui-harness.spec.ts (it lands
// in test-results/ui-harness/ and in the axe summary), so before/after evidence for
// the shell covers every page, not only the signed-in ones.

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
    name: 'landing',
    path: '/',
    fullPage: true,
    reach: async page => {
      // The landing page ships no framework JavaScript (scripts/static-pages.mjs).
      await expect(page.locator('script[src]')).toHaveCount(0)
      await expect(page.locator('img[src^="/landing/"]')).toHaveJSProperty('complete', true)
      return page.getByRole('heading', { name: 'Know when to go outside' })
    },
  },
  {
    name: 'signin',
    path: '/app/?signin',
    fullPage: false,
    reach: page => page.getByRole('heading', { name: 'Sign in to Solara' }),
  },
  {
    name: 'onboarding-location',
    path: '/app/',
    fullPage: false,
    reach: async page => {
      await startOnboarding(page)
      return page.getByRole('button', { name: /Use my location/ })
    },
  },
  {
    name: 'onboarding-location-error',
    path: '/app/',
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
    path: '/app/',
    fullPage: false,
    reach: async page => {
      await searchCity(page)
      return page.getByText('6.4', { exact: true })
    },
  },
  {
    name: 'onboarding-skin',
    path: '/app/',
    fullPage: false,
    reach: async page => {
      await chooseSkin(page)
      return page.getByRole('button', { name: /Fair/, pressed: true })
    },
  },
  {
    name: 'onboarding-finish',
    path: '/app/',
    fullPage: false,
    reach: async page => {
      await chooseSkin(page)
      await page.getByRole('button', { name: /Continue/ }).click()
      return page.getByRole('heading', { name: "You're all set" })
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
    const capture = await preparePage(page, testInfo, (route, url) => {
      if (GEOCODE.test(url.href)) {
        return json(route, url.searchParams.get('name') === 'Pasadena' ? PLACE : { results: [] })
      }
      if (FORECAST.test(url.href)) return json(route, { current: { uv_index: 6.4 } })
      return false
    })
    await page.goto(screen.path)
    await expect(await screen.reach(page)).toBeVisible()
    await captureScreen(page, testInfo, capture, screen)
  })
}

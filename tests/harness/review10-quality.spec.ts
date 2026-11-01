import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'
import { buildRawForecast, HARNESS_MARKER } from './fixtures'

// The screens REVIEW10 QA changed, in English and Spanish, at 320 and 390 px (mobile
// projects) and 1280 px (desktop), light and dark: the burn-time warning on the hero, the
// recommended slot and the briefing (M3), the vitamin D card's dose (owner, 2026-11-01),
// setup's burn times (L7), the Spanish wording and prices (L4), and the 404 page's title
// (L3). Each is checked for sideways scrolling; REVIEW10_SHOTS=<folder> saves a copy.

const SHOTS = process.env.REVIEW10_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

const LANGUAGES = [
  {
    code: 'en',
    warning: 'Longer than your burn time',
    dose: /≈1,000 IU · arms \+ legs/,
    price: '$2.99',
    notFoundTitle: 'Page not found | Solara',
    skinHeading: 'Your skin type',
  },
  {
    code: 'es',
    warning: 'Dura más que tu tiempo hasta quemarte',
    dose: /≈1[,.]?000 UI · brazos \+ piernas/,
    price: 'US$2.99',
    notFoundTitle: 'Página no encontrada | Solara',
    skinHeading: 'Tu tipo de piel',
  },
] as const

async function inLanguage(page: Page, t: TestInfo, code: 'en' | 'es') {
  await preparePage(page, t, (route, url) => {
    if (url.hostname === 'api.open-meteo.com') return route.fulfill({ json: buildRawForecast() })
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return route.fulfill({
        json: {
          results: [
            {
              name: 'Los Angeles',
              admin1: 'California',
              country: code === 'es' ? 'Estados Unidos' : 'United States',
              latitude: 34.05,
              longitude: -118.24,
              timezone: 'America/Los_Angeles',
              population: 3_898_747,
              feature_code: 'PPLA2',
            },
          ],
        },
      })
    }
    return false
  })
  await page.addInitScript(language => {
    try {
      window.localStorage.setItem('solara_language', language)
    } catch {}
  }, code)
}

/** At each width: no sideways scrolling, and a screenshot when REVIEW10_SHOTS is set. */
async function atEachWidth(page: Page, t: TestInfo, name: string, fullPage: boolean) {
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        fullPage,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
  }
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test('the dashboard warns where an activity outlasts the burn time, and states the vitamin D dose', async ({
      page,
    }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto('/harness/?screen=dashboard')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', lang.code)
      // The harness plan's Running (45 min at UV 4) for fair skin, who burns in about 38.
      const running = page.locator('[data-testid="activity-card"][data-activity="run"]')
      await expect(running.getByTestId('burn-time-warning')).toContainText(lang.warning)
      await expect(
        page.getByTestId('daily-briefing').locator('[data-line="outlasts"]'),
      ).toBeVisible()
      await expect(page.getByTestId('vitd-metric').getByTestId('metric-detail')).toHaveText(
        lang.dose,
      )
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      await atEachWidth(page, testInfo, `dashboard-${lang.code}`, true)
    })

    test('the plans show the price in US dollars', async ({ page }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto('/harness/?screen=pricing&tier=free')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      await expect(page.getByRole('dialog').getByText(lang.price, { exact: true })).toBeVisible()
      await atEachWidth(page, testInfo, `pricing-${lang.code}`, false)
    })

    test("setup lists each skin type's burn time in the duration style", async ({
      page,
    }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto('/app/')
      // This build has a (placeholder) Firebase project, so setup first offers sign-in.
      const field = page.getByRole('combobox')
      const notNow = page.getByRole('button', { name: /^(Not now|Ahora no)$/ })
      await expect(notNow.or(field).first()).toBeVisible()
      if (await notNow.isVisible()) await notNow.click()
      await field.fill('Los Angeles')
      await page.getByRole('option').first().click()
      await page.getByRole('button', { name: /Continue|Continuar/ }).click()
      await expect(page.getByRole('heading', { name: lang.skinHeading })).toBeVisible()
      // "~2 h 2 min", never "~122 min" (REVIEW10 QA L7).
      await expect(page.getByText(/~\d+\s?min|~\d+\s?h/).first()).toBeVisible()
      await expect(page.getByText(/~\d{3,}\s?min/)).toHaveCount(0)
      await atEachWidth(page, testInfo, `setup-skin-${lang.code}`, true)
    })

    test('the 404 page has its title in the language', async ({ page }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto('/no-such-page/')
      await expect(page).toHaveTitle(lang.notFoundTitle)
      await atEachWidth(page, testInfo, `not-found-${lang.code}`, false)
    })
  })
}

import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'
import { HARNESS_NOW_MS } from './clock'
import { buildRawForecast } from './fixtures'

// The screens REVIEW10 VERIFY10's fixes changed (ROADMAP item 51), in English and
// Spanish, at 320 and 390 px (mobile projects) and 1280 px (desktop), light and dark: the
// notice after a reload to a new version (N2), the guest plan's wording on the landing
// page and at the end of setup (N4), the hourly strip with the keyboard (N6) and a city's
// months (N9). Each is checked for sideways scrolling; REVIEW10_SHOTS=<folder> saves a copy.

const SHOTS = process.env.REVIEW10_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

const LANGUAGES = [
  {
    code: 'en',
    prefix: '',
    updated: 'Solara was updated while this page was open, so it reloaded.',
    guestNote: 'No sign-in. Your plan is saved in this browser; sign in to keep it safe.',
    allSet: 'Your plan is saved in this browser',
    strip: 'UV forecast by hour',
    someDays: 'Some days',
  },
  {
    code: 'es',
    prefix: '/es',
    updated: 'Solara se actualizó mientras esta página estaba abierta, así que se recargó.',
    guestNote:
      'Sin iniciar sesión. Tu plan se guarda en este navegador; inicia sesión para no perderlo.',
    allSet: 'Tu plan se guarda en este navegador',
    strip: 'Pronóstico UV por hora',
    someDays: 'Algunos días',
  },
] as const

const GUEST_PLAN = {
  prefs: {
    location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
}

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
      window.localStorage.setItem('solara.analytics-consent.v1', 'declined')
    } catch {}
  }, code)
}

/** At each width: no sideways scrolling, and a screenshot of `target` when REVIEW10_SHOTS is set. */
async function atEachWidth(page: Page, t: TestInfo, name: string, target?: Locator) {
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    if (SHOTS) {
      const options = { animations: 'disabled', caret: 'hide' } as const
      const path = `${SHOTS}/${name}-${width}-${scheme(t)}.png`
      if (target) {
        await target.scrollIntoViewIfNeeded()
        await target.screenshot({ path, ...options })
      } else {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path, ...options })
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
  }
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test('after a reload to a new version, the app says why (N2)', async ({ page }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.addInitScript(
        ([plan, at]) => {
          window.localStorage.setItem('solara_guest', JSON.stringify(plan))
          window.sessionStorage.setItem(
            'solara.update-reload',
            JSON.stringify({ at, reason: 'open' }),
          )
        },
        [GUEST_PLAN, HARNESS_NOW_MS] as const,
      )
      await page.goto('/app/')
      await expect(page.getByRole('toolbar', { name: lang.strip })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: lang.updated })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await atEachWidth(page, testInfo, `update-notice-${lang.code}`)
    })

    test('the hourly strip is reached and moved with the keyboard (N6)', async ({
      page,
    }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.addInitScript(
        plan => window.localStorage.setItem('solara_guest', JSON.stringify(plan)),
        GUEST_PLAN,
      )
      await page.goto('/app/')
      const strip = page.getByRole('toolbar', { name: lang.strip })
      await expect(strip).toBeVisible()
      await expect(strip.locator('button:not([tabindex="-1"])')).toHaveCount(1)
      await strip.locator('button[tabindex="0"]').focus()
      await page.keyboard.press('ArrowRight')
      await expect(strip.locator('button[aria-pressed="true"]')).toBeFocused()
      await page.evaluate(() => document.fonts.ready)
      await atEachWidth(
        page,
        testInfo,
        `strip-keyboard-${lang.code}`,
        strip.locator('..').locator('..'),
      )
    })

    test("the landing page's guest plan promises nothing the browser may undo (N4)", async ({
      page,
    }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto(`${lang.prefix}/`)
      const note = page.getByText(lang.guestNote)
      await expect(note).toBeVisible()
      const plans = page.locator('section').filter({ has: note }).last()
      await atEachWidth(page, testInfo, `landing-plans-${lang.code}`, plans)
    })

    test('the end of setup says where the plan is saved (N4)', async ({ page }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto('/app/')
      const field = page.getByRole('combobox')
      const notNow = page.getByRole('button', { name: /^(Not now|Ahora no)$/ })
      await expect(notNow.or(field).first()).toBeVisible()
      if (await notNow.isVisible()) await notNow.click()
      await field.fill('Los Angeles')
      await page.getByRole('option').first().click()
      await page.getByRole('button', { name: /Continue|Continuar/ }).click()
      await page.getByRole('button', { name: /Continue|Continuar/ }).click()
      await expect(page.getByText(lang.allSet)).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await atEachWidth(page, testInfo, `setup-all-set-${lang.code}`)
    })

    test("a city's Low month never lists moderate hours (N9)", async ({ page }, testInfo) => {
      await inLanguage(page, testInfo, lang.code)
      await page.goto(`${lang.prefix}/uv/sydney/`)
      const table = page.getByRole('table')
      await expect(table.getByText(lang.someDays)).toBeVisible()
      await atEachWidth(page, testInfo, `city-months-${lang.code}`, table)
    })
  })
}

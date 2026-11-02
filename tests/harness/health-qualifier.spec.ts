import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'
import { buildRawForecast, HARNESS_MARKER } from './fixtures'
import app from '@/messages/app'
import esApp from '@/messages/es/app'

// The "not medical advice" qualifier (owner 2026-11-01, docs/LEGAL_REVIEW.md) everywhere
// health estimates appear, in English and Spanish, at 320 and 390 px (mobile projects) and
// 1280 px (desktop), light and dark: setup's skin type step, the dashboard footer, the
// sunscreen guide, the vitamin D log, Settings' skin type help, the landing page and city
// page footers and the terms' "Not medical advice" section. Each shows the same sentence
// on who should ask a health professional, without sideways scrolling, with a clean axe
// run. QUALIFIER_SHOTS=<folder> saves a copy of each.

const SHOTS = process.env.QUALIFIER_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

const LANGUAGES = [
  {
    code: 'en',
    prefix: '',
    qualifier: app.healthQualifier,
    footer: 'Estimates for planning and tracking, not medical advice.',
    notNow: 'Not now',
    place: 'City or location',
    go: 'Go',
    next: /Continue/,
    skinHeading: 'Your skin type',
    timer: /Sunscreen timer/,
    howMuch: 'How much sunscreen?',
    vitaminD: /Vitamin.D log/,
    settings: 'Settings',
    howSkin: 'How skin type affects Solara',
    termsHeading: 'Not medical advice',
  },
  {
    code: 'es',
    prefix: '/es',
    qualifier: esApp.healthQualifier,
    footer: 'Estimaciones para planificar y llevar un registro, no consejo médico.',
    notNow: 'Ahora no',
    place: 'Ciudad o ubicación',
    go: 'Ir',
    next: /Continuar/,
    skinHeading: 'Tu tipo de piel',
    timer: /Temporizador de protector solar/,
    howMuch: '¿Cuánto protector solar?',
    vitaminD: /Registro de vitamina.D/,
    settings: 'Configuración',
    howSkin: 'Cómo influye el tipo de piel en Solara',
    termsHeading: 'No es consejo médico',
  },
] as const

type Language = (typeof LANGUAGES)[number]

const PLACE = {
  name: 'Los Angeles',
  admin1: 'California',
  country: 'United States',
  latitude: 34.05,
  longitude: -118.24,
  timezone: 'America/Los_Angeles',
  population: 3_898_747,
  feature_code: 'PPLA2',
}

/** A returning guest's plan, in the language. */
const guestPlan = (language: Language['code']) => ({
  prefs: {
    location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
    language,
  },
  since: '2026-06-15',
})

async function inLanguage(page: Page, t: TestInfo, code: Language['code']) {
  await preparePage(page, t, (route, url) => {
    if (url.hostname === 'api.open-meteo.com') return route.fulfill({ json: buildRawForecast() })
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return route.fulfill({ json: { results: [PLACE] } })
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

/**
 * At each width: the target shows, nothing scrolls sideways, and a copy is saved: of the
 * target, or from its top to the bottom of `until`.
 */
async function atEachWidth(
  page: Page,
  t: TestInfo,
  name: string,
  target: Locator,
  until?: Locator,
) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    await target.scrollIntoViewIfNeeded()
    await expect(target).toBeVisible()
    if (SHOTS) {
      const options = {
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      } as const
      if (until) {
        const top = (await target.boundingBox())!
        const bottom = (await until.boundingBox())!
        const scrollY = await page.evaluate(() => window.scrollY)
        await page.screenshot({
          ...options,
          fullPage: true,
          clip: {
            x: 0,
            y: top.y + scrollY - 12,
            width,
            height: bottom.y + bottom.height - top.y + 24,
          },
        })
      } else {
        await target.screenshot(options)
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
  }
}

async function axeClean(page: Page, selector: string) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze()
  expect(axe.violations.map(v => v.id)).toEqual([])
}

/** The element whose text holds the qualifier, inside `scope`. */
const qualifierIn = (scope: Locator, lang: Language) =>
  scope.locator('p').filter({ hasText: lang.qualifier }).last()

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test("setup's skin type step", async ({ page }, t) => {
      await inLanguage(page, t, lang.code)
      await page.goto('/app/')
      const notNow = page.getByRole('button', { name: lang.notNow, exact: true })
      const field = page.getByRole('combobox', { name: lang.place })
      await expect(notNow.or(field).first()).toBeVisible()
      if (await notNow.isVisible()) await notNow.click()
      await field.fill('Los Angeles')
      await page.getByRole('option').first().click()
      await page.getByRole('button', { name: lang.next }).click()
      await expect(page.getByRole('heading', { name: lang.skinHeading })).toBeVisible()
      await expect(qualifierIn(page.locator('body'), lang)).toBeVisible()
      await atEachWidth(page, t, `setup-skin-${lang.code}`, page.locator('.card').first())
      await axeClean(page, '[data-testid="skin-not-medical"]')
    })

    test('the dashboard footer and the sunscreen guide', async ({ page }, t) => {
      await inLanguage(page, t, lang.code)
      await page.addInitScript(
        plan => window.localStorage.setItem('solara_guest', JSON.stringify(plan)),
        guestPlan(lang.code),
      )
      await page.goto('/app/')
      const footer = page.locator('p').filter({ hasText: lang.footer })
      await expect(footer).toBeVisible()
      await atEachWidth(page, t, `dashboard-footer-${lang.code}`, footer)

      const timer = page.getByRole('region', { name: lang.timer })
      await timer.getByText(lang.howMuch).click()
      await expect(qualifierIn(timer, lang)).toBeVisible()
      await atEachWidth(page, t, `sunscreen-guide-${lang.code}`, timer)
      await axeClean(page, 'main')
    })

    test('the vitamin D log', async ({ page }, t) => {
      await inLanguage(page, t, lang.code)
      await page.addInitScript(
        plan => window.localStorage.setItem('solara_guest', JSON.stringify(plan)),
        guestPlan(lang.code),
      )
      await page.goto('/app/')
      await page.getByRole('button', { name: lang.vitaminD }).click()
      const dialog = page.getByRole('dialog', { name: lang.vitaminD })
      const note = qualifierIn(dialog, lang)
      await expect(note).toBeVisible()
      await atEachWidth(page, t, `vitamin-d-log-${lang.code}`, note.locator('..'))
      await axeClean(page, '[role="dialog"]')
    })

    test("Settings' skin type help", async ({ page }, t) => {
      await inLanguage(page, t, lang.code)
      await page.goto('/harness/?screen=settings')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      const settings = page.getByRole('dialog', { name: lang.settings })
      await settings.getByRole('button', { name: lang.howSkin }).click()
      const help = settings.locator('p').filter({ hasText: lang.qualifier })
      await expect(help).toBeVisible()
      await atEachWidth(page, t, `settings-skin-help-${lang.code}`, help.locator('..'))
      await axeClean(page, '[role="dialog"]')
    })

    for (const screen of [
      { name: 'landing', path: '/' },
      { name: 'city', path: '/uv/los-angeles/' },
    ]) {
      test(`the ${screen.name} page's disclaimer`, async ({ page }, t) => {
        await inLanguage(page, t, lang.code)
        await page.goto(`${lang.prefix}${screen.path}`)
        const disclaimer = page.locator('p').filter({ hasText: lang.qualifier })
        await expect(disclaimer).toHaveCount(1)
        await atEachWidth(page, t, `${screen.name}-disclaimer-${lang.code}`, disclaimer)
        await axeClean(page, 'main')
      })
    }

    test("the terms' not medical advice section", async ({ page }, t) => {
      await inLanguage(page, t, lang.code)
      await page.goto(`${lang.prefix}/terms/`)
      const heading = page.getByRole('heading', { name: lang.termsHeading })
      await expect(heading).toBeVisible()
      // The heading and its three paragraphs, the second naming who should ask.
      const qualifier = lang.qualifier.replace(/\.$/, '')
      await expect(heading.locator('xpath=following-sibling::p[2]')).toContainText(qualifier)
      const last = heading.locator('xpath=following-sibling::p[3]')
      await atEachWidth(page, t, `terms-${lang.code}`, heading, last)
      await axeClean(page, 'main')
    })
  })
}

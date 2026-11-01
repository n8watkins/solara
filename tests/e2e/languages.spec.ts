import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// Languages (ROADMAP item 46) on the real export: a device set to Spanish opens the app in
// Spanish, a guest switches the language in Settings and keeps it, and the static pages
// stay as they are. The language comes from LANGUAGE_INIT_SCRIPT before first paint
// (lib/i18n.ts) and the app shows once the opening screen's translations have arrived.

const GUEST = JSON.stringify({
  prefs: {
    location: {
      lat: 34.05,
      lon: -118.24,
      city: 'Los Angeles',
      region: 'California',
      timezone: 'America/Los_Angeles',
    },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
})

async function prepare(page: Page, { guest = true } = {}) {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await startClock(page)
  await page.addInitScript(
    ({ guest, plan }) => {
      if (guest && !localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', plan)
      localStorage.setItem('solara.analytics-consent.v1', 'declined')
    },
    { guest, plan: GUEST },
  )
}

test.describe('a device set to Spanish', () => {
  test.use({ locale: 'es-MX' })

  test('finds places by their Spanish names and prefers the big city', async ({ page }) => {
    // Open-Meteo's place search answers like this (checked 2026-11-01): it matches names
    // in the requested language, so in English "Nueva York" only finds villages and
    // "Ciudad de México" nothing; its own order can also put a village first.
    const searches: URLSearchParams[] = []
    await page.route('https://geocoding-api.open-meteo.com/**', route => {
      const params = new URL(route.request().url()).searchParams
      searches.push(params)
      const spanish = params.get('language') === 'es'
      const name = params.get('name') ?? ''
      const village = {
        name: 'Nueva York',
        admin1: spanish ? 'Departamento de Amazonas' : 'Amazonas',
        country: spanish ? 'Perú' : 'Peru',
        latitude: -5.6,
        longitude: -78.33,
        timezone: 'America/Lima',
        population: 313,
        feature_code: 'PPL',
      }
      const results = name.startsWith('Nueva York')
        ? spanish
          ? [
              village,
              {
                name: 'Nueva York',
                admin1: 'Nueva York',
                country: 'Estados Unidos',
                latitude: 40.71,
                longitude: -74.01,
                timezone: 'America/New_York',
                population: 8804190,
                feature_code: 'PPL',
              },
            ]
          : [village]
        : name.startsWith('Ciudad de M') && spanish
          ? [
              {
                name: 'Ciudad de México',
                admin1: 'Ciudad de México',
                country: 'México',
                latitude: 19.43,
                longitude: -99.13,
                timezone: 'America/Mexico_City',
                population: 12294193,
                feature_code: 'PPLC',
              },
            ]
          : []
      return route.fulfill({ json: results.length ? { results } : {} })
    })
    await prepare(page, { guest: false })
    await page.goto('/app/')
    const field = page.getByRole('combobox', { name: 'Ciudad o lugar' })

    await field.fill('Ciudad de México')
    await expect(
      page.getByRole('option', { name: 'Ciudad de México Ciudad de México, México' }),
    ).toBeVisible()

    await field.fill('Nueva York')
    const options = page.getByRole('listbox').getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.first()).toHaveAccessibleName('Nueva York Nueva York, Estados Unidos')
    // "Ir" takes the best match: the forecast is asked for New York City, not the village.
    const forecast = page.waitForRequest(
      request =>
        request.url().startsWith('https://api.open-meteo.com/') &&
        new URL(request.url()).searchParams.get('latitude') === '40.71',
    )
    await page.getByRole('button', { name: 'Ir', exact: true }).click()
    await forecast
    await expect(page.getByText('Índice UV ahora mismo en')).toBeVisible()
    expect(searches.every(params => params.get('language') === 'es')).toBe(true)
  })

  test('opens setup in Spanish', async ({ page }) => {
    await prepare(page, { guest: false })
    await page.goto('/app/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('heading', { name: '¿Dónde estás?' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Usar mi ubicación/ })).toBeVisible()
    await expect(page).toHaveTitle('Solara: planifica según el UV')
  })

  test("shows a guest's dashboard in Spanish, with Spanish dates and times", async ({ page }) => {
    await prepare(page)
    await page.goto('/app/')
    await expect(page.getByRole('group', { name: 'Pronóstico UV por hora' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Hoy de un vistazo/i })).toBeVisible()
    await expect(page.getByTestId('burn-metric')).toContainText('piel clara, sin FPS')
    await expect(page.getByTestId('daily-briefing')).toContainText('p.m.')
    // The footer, written in the static HTML, shows the page's language from the start.
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Privacidad' }),
    ).toBeVisible()
  })

  test('keeps the landing page in English', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test("loads Spanish within the guest's first-load budget", async ({ page, baseURL }) => {
    await prepare(page)
    const scripts: Promise<number>[] = []
    page.on('response', response => {
      if (response.request().resourceType() !== 'script') return
      if (!response.url().startsWith(baseURL!)) return
      scripts.push(response.body().then(body => gzipSync(body, { level: 9 }).length))
    })
    await page.goto('/app/')
    await expect(page.getByRole('group', { name: 'Pronóstico UV por hora' })).toBeVisible()
    const kb = (await Promise.all(scripts)).reduce((sum, n) => sum + n, 0) / 1024
    // English's budget (guest.spec.ts) plus the opening screen's Spanish (about 7 KB) and
    // the rest of it, which follows at once (about 19 KB).
    expect(kb, `Spanish first load: ${kb.toFixed(1)} KB gzip`).toBeLessThan(218)
  })
})

test('an English device searches in English and still prefers the big city', async ({ page }) => {
  const searches: URLSearchParams[] = []
  await page.route('https://geocoding-api.open-meteo.com/**', route => {
    const params = new URL(route.request().url()).searchParams
    searches.push(params)
    const place = (admin1: string, latitude: number, population: number) => ({
      name: 'Paris',
      admin1,
      country: admin1 === 'Île-de-France' ? 'France' : 'United States',
      latitude,
      longitude: 2.35,
      population,
      feature_code: 'PPL',
    })
    // A small Paris first, as the service may order them.
    return route.fulfill({
      json: { results: [place('Arkansas', 35.29, 3443), place('Île-de-France', 48.85, 2138551)] },
    })
  })
  await prepare(page, { guest: false })
  await page.goto('/app/')
  const field = page.getByRole('combobox', { name: 'City or location' })
  await field.fill('Paris')
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toHaveAccessibleName('Paris Île-de-France, France')
  expect(searches.every(params => params.get('language') === 'en')).toBe(true)
})

test('a guest switches to Spanish in Settings and back to the device language', async ({
  page,
}) => {
  await prepare(page)
  await page.goto('/app/')
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Display' }).click()
  await settings.getByLabel('Language').selectOption('es')
  await settings.getByRole('button', { name: 'Save settings' }).click()

  // The page reloads in Spanish and stays in it.
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('group', { name: 'Pronóstico UV por hora' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Pronóstico UV por hora' })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Configuración' }).click()
  const ajustes = page.getByRole('dialog', { name: 'Configuración' })
  await ajustes.getByRole('tab', { name: 'Pantalla' }).click()
  await ajustes.getByLabel('Idioma').selectOption('auto')
  await ajustes.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
})

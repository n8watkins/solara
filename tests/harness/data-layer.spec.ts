import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { HARNESS_NOW } from './clock'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// The forecast data layer end to end (CQ-7, CQ-6, PERF-3): the harness's `data=live`
// mode loads the forecast through lib/use-forecast.ts like the app does, and these
// specs play Open-Meteo with page.route.
const FORECAST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/
const NOW_MS = new Date(HARNESS_NOW).getTime()
const MINUTE = 60_000

type Responder = (route: Route) => Promise<void> | void

const respondOk: Responder = route =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(buildRawForecast()) })

/** Answers forecast requests with `respond` and records each request's latitude. */
async function playOpenMeteo(page: Page, respond: Responder = respondOk) {
  const requests: string[] = []
  await page.route('**/*', route => {
    const url = route.request().url()
    if (FORECAST.test(url)) {
      requests.push(new URL(url).searchParams.get('latitude') ?? '')
      return respond(route)
    }
    return new URL(url).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient')
  })
  return requests
}

async function openLive(page: Page, at = NOW_MS) {
  await page.clock.install({ time: at })
  await page.goto('/harness/?screen=dashboard&data=live')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
}

async function newPage(context: BrowserContext) {
  return context.newPage()
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
})

test('loads once, then shows the cached forecast at once and refreshes it when stale', async ({
  context,
  page,
}) => {
  const first = await playOpenMeteo(page)
  await openLive(page)
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  expect(first).toEqual(['34.05'])

  // A reload within the stale time paints from the persisted cache with no request.
  const fresh = await newPage(context)
  const freshRequests = await playOpenMeteo(fresh)
  await openLive(fresh, NOW_MS + 5 * MINUTE)
  await expect(fresh.getByTestId('hero-slot')).toBeVisible()
  expect(freshRequests).toEqual([])

  // 45 minutes later it is stale: still shown at once, while a refresh is in flight
  // (the provider never answers here).
  const stale = await newPage(context)
  const staleRequests = await playOpenMeteo(stale, () => {})
  await openLive(stale, NOW_MS + 45 * MINUTE)
  await expect(stale.getByTestId('hero-slot')).toBeVisible()
  await expect.poll(() => staleRequests).toEqual(['34.05'])
})

test('switching location aborts the request for the old one', async ({ page }) => {
  let held: Route | null = null
  const requests = await playOpenMeteo(page, route => {
    // San Diego never answers until it is no longer wanted.
    if (new URL(route.request().url()).searchParams.get('latitude') === '32.72') held = route
    else return respondOk(route)
  })
  const aborted: string[] = []
  page.on('requestfailed', request => {
    if (FORECAST.test(request.url()))
      aborted.push(new URL(request.url()).searchParams.get('latitude') ?? '')
  })
  await openLive(page)
  await expect(page.getByTestId('hero-slot')).toBeVisible()

  await page
    .getByRole('button', { name: /Los Angeles/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'San Diego, California' }).click()
  await expect.poll(() => requests).toEqual(['34.05', '32.72'])
  await expect(page.getByTestId('hero-slot')).toBeHidden()

  // Back to Los Angeles: its cached forecast shows at once and San Diego's request is dropped.
  // The location panel stays open after a shortcut, so Los Angeles is listed there now.
  await page.getByRole('button', { name: 'Los Angeles, California' }).click()
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  await expect.poll(() => aborted).toEqual(['32.72'])
  expect(held).not.toBeNull()
})

test('rolls over at the location midnight and fetches the new day', async ({ page }) => {
  const requests = await playOpenMeteo(page)
  // 23:58 in Los Angeles on the first forecast day: the sun has set, so today is over;
  // the briefing turns to tomorrow and the hero steps aside.
  await openLive(page, NOW_MS + (13 * 60 + 28) * MINUTE)
  await expect(page.getByTestId('daily-briefing')).toContainText('Tomorrow at a glance')
  await expect(page.getByTestId('hero-slot').or(page.getByTestId('hero-empty'))).toHaveCount(0)
  expect(requests).toHaveLength(1)

  await page.clock.fastForward('03:00')
  // Now it is the next day there: its first slot leads, and that day's forecast is fetched.
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  await expect(page.getByTestId('hero-slot')).toHaveAttribute('data-start', '6')
  await expect.poll(() => requests).toHaveLength(2)
})

test('ignores a malformed or outdated cache', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'solara_forecast',
      JSON.stringify({
        version: 2,
        entries: [{ key: '34.05,-118.24', data: { timezone: 'Mars/Base' } }],
      }),
    )
    localStorage.setItem(
      'solara_weather',
      JSON.stringify({ data: {}, lat: 34.05, lon: -118.24, ts: 0 }),
    )
  })
  const requests = await playOpenMeteo(page)
  await openLive(page)
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  expect(requests).toEqual(['34.05'])
  expect(await page.evaluate(() => localStorage.getItem('solara_weather'))).toBeNull()
})

test('a failed refresh keeps the last forecast on screen', async ({ context, page }) => {
  await playOpenMeteo(page)
  await openLive(page)
  await expect(page.getByTestId('hero-slot')).toBeVisible()

  const later = await newPage(context)
  await playOpenMeteo(later, route => route.fulfill({ status: 503, body: 'down' }))
  await openLive(later, NOW_MS + 45 * MINUTE)
  await expect(later.getByTestId('hero-slot')).toBeVisible()
  await expect(later.getByTestId('weather-error')).toHaveText(
    "The forecast service isn't answering, so this is the last forecast Solara got. It will try again in a minute.",
    { timeout: 15_000 },
  )
  await expect(later.getByTestId('hero-slot')).toBeVisible()
})

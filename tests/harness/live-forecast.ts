// Shared by the harness specs that play Open-Meteo themselves: the live-data
// dashboard (data=live) at any clock time, with an edited forecast.
import { expect, type Page, type TestInfo } from '@playwright/test'
import { preparePage, type Capture } from './capture'
import { HARNESS_DATE, HARNESS_NOW } from './clock'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

const FORECAST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/
const MINUTE = 60_000
export const NOW_MS = new Date(HARNESS_NOW).getTime()
/** 5:30 in Los Angeles on the first forecast day, before the first UV. */
export const DAWN_MS = NOW_MS - 5 * 60 * MINUTE
/** 21:30 in Los Angeles on the first forecast day: the sun is down, every window has passed. */
export const NIGHT_MS = NOW_MS + 11 * 60 * MINUTE

export type Raw = ReturnType<typeof buildRawForecast>

/** Answers the forecast with `edit(raw)` and opens the live-data dashboard at `at`. */
export async function openDashboard(
  page: Page,
  { at = NOW_MS, tier = 'paid', edit }: { at?: number; tier?: string; edit?: (raw: Raw) => Raw },
) {
  const raw = edit ? edit(buildRawForecast()) : buildRawForecast()
  await page.route('**/*', route => {
    const url = route.request().url()
    if (FORECAST.test(url))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(raw) })
    return new URL(url).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient')
  })
  await page.clock.install({ time: at })
  await page.goto(`/harness/?screen=dashboard&data=live&tier=${tier}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
}

/** Sets the live reading, and the first forecast day's UV at `hour` (local), to `uv`. */
export function withUVAt(hour: number, uv: number) {
  return (raw: Raw): Raw => {
    const at = `${HARNESS_DATE}T${String(hour).padStart(2, '0')}:00`
    const index = raw.hourly.time.indexOf(at)
    const values = [...raw.hourly.uv_index]
    values[index] = uv
    return {
      ...raw,
      current: { ...raw.current, uv_index: uv },
      hourly: { ...raw.hourly, uv_index: values },
    }
  }
}

/** The live reading after sunset. */
export const atNight = (raw: Raw): Raw => ({ ...raw, current: { ...raw.current, uv_index: 0 } })

/** Opens the live-data dashboard like openDashboard, ready for captureScreen. */
export async function prepareLiveDashboard(
  page: Page,
  testInfo: TestInfo,
  {
    at = NOW_MS,
    tier = 'paid',
    edit,
    query = '',
  }: { at?: number; tier?: string; edit?: (raw: Raw) => Raw; query?: string },
): Promise<Capture> {
  const raw = JSON.stringify(edit ? edit(buildRawForecast()) : buildRawForecast())
  const capture = await preparePage(
    page,
    testInfo,
    (route, url) =>
      url.hostname === 'api.open-meteo.com'
        ? route.fulfill({ contentType: 'application/json', body: raw })
        : false,
    { at },
  )
  await page.goto(`/harness/?screen=dashboard&data=live&tier=${tier}${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  return capture
}

/** The live reading equals the forecast for `hour` on the first day (no in-between value). */
export function currentFromHour(hour: number) {
  return (raw: Raw): Raw => {
    const index = raw.hourly.time.indexOf(`${HARNESS_DATE}T${String(hour).padStart(2, '0')}:00`)
    return { ...raw, current: { ...raw.current, uv_index: raw.hourly.uv_index[index]! } }
  }
}

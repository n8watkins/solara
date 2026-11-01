import { expect, test } from '@playwright/test'
import { preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// REVIEW10 VERIFY10 N1, end to end: the dashboard's real data layer (data=live) reading a
// forecast fetched before a daylight saving change. Open-Meteo labels every hour with the
// one UTC offset in force when it is fetched, so in Los Angeles on Friday 6 March 2026
// (PST, -8) the Monday after the clocks go forward (Sunday 8 March) is labelled in PST
// too. The sun peaks at about 20:00 UTC: noon PST, 1pm PDT. The strip must put Monday's
// peak at 1pm on the clock, not at the "12:00" label.

const FETCHED_AT = Date.parse('2026-03-06T10:30:00-08:00')
const HOUR = 3_600_000

function forecastFetchedFriday() {
  const start = Date.parse('2026-03-06T08:00:00Z') // Friday's midnight, PST.
  const time: string[] = []
  const uv: number[] = []
  const temperature: number[] = []
  const codes: number[] = []
  for (let i = 0; i < 10 * 24; i++) {
    const instant = start + i * HOUR
    time.push(new Date(instant - 8 * HOUR).toISOString().slice(0, 16))
    const fromNoon = Math.abs(new Date(instant).getUTCHours() - 20)
    // A whole number at the peak, a step lower each hour away from it.
    uv.push(Math.max(0, 6 - Math.min(fromNoon, 24 - fromNoon)))
    temperature.push(16)
    codes.push(0)
  }
  return {
    timezone: 'America/Los_Angeles',
    utc_offset_seconds: -8 * 3600,
    latitude: 34.05,
    longitude: -118.24,
    current: { time: '2026-03-06T10:00', uv_index: 4, temperature_2m: 15, weathercode: 0 },
    hourly: { time, uv_index: uv, temperature_2m: temperature, weathercode: codes },
  }
}

test('the days after a daylight saving change show their hours on the new clock', async ({
  page,
}, testInfo) => {
  const body = JSON.stringify(forecastFetchedFriday())
  const capture = await preparePage(
    page,
    testInfo,
    (route, url) =>
      url.hostname === 'api.open-meteo.com'
        ? route.fulfill({ contentType: 'application/json', body })
        : false,
    { at: FETCHED_AT },
  )
  await page.goto('/harness/?screen=dashboard&data=live&tier=paid')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const strip = page.getByRole('toolbar', { name: 'UV forecast by hour' })

  // Friday, before the change: the peak is at noon.
  await expect(strip.getByRole('button', { name: /^UV 6\.0 ?, High, at 12pm$/ })).toBeVisible()

  // Monday, after it: the same sun, an hour later on the clock.
  await page.getByRole('button', { name: 'More days', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Mar 9/ }).click()
  await expect(strip.getByRole('button', { name: /^UV 6\.0 ?, High, at 1pm$/ })).toBeVisible()
  await expect(strip.getByRole('button', { name: /at 12pm/ })).toHaveAccessibleName(
    /^UV 5\.0 ?, Moderate, at 12pm$/,
  )
  expect(capture.pageErrors).toEqual([])
})

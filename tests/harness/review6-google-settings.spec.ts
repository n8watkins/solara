import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'
import { GOOGLE_MANY_EVENTS } from './google-calendar-fixtures'

// The sixth review's UI items for Google Calendar and Settings (REVIEW6 L1, L5, L7): the
// Free Alerts tab's way to Pro, one heads-up rule with Google Calendar alone switched on,
// the Google panel's actions on a phone, the Sun profile tab label, opening a Settings tab
// by URL, and the panel's count with more events than the section loads.

function answerOpenMeteo(route: Route, url: URL): Promise<void> | false {
  if (url.origin === 'https://api.open-meteo.com') {
    return route.fulfill({ json: buildRawForecast() })
  }
  return false
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' })
const isMobile = (testInfo: TestInfo) => testInfo.project.name.startsWith('mobile')

/** The Google panel alone, at the project's width and, on desktop, at 1280 px too. */
async function panelShot(page: Page, testInfo: TestInfo, name: string) {
  const dir = join('test-results', 'ui-harness', 'screenshots')
  mkdirSync(dir, { recursive: true })
  const shoot = (suffix: string) =>
    page.getByTestId('google-calendar-events').screenshot({
      path: join(dir, `${name}${suffix}--${testInfo.project.name}.png`),
      animations: 'disabled',
    })
  await shoot('')
  if (!isMobile(testInfo)) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await shoot('-1280')
    await page.setViewportSize({ width: 1440, height: 900 })
  }
}

test('the Free Alerts tab opens by URL and offers Pro like every other offer', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=settings&tier=free&tab=alerts&alerts=on&gcal=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const dialog = settings(page)
  await expect(dialog.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByText(/before your outdoor events\. Included with Pro\./)).toBeVisible()
  const offer = dialog.getByRole('button', { name: 'See Pro plans' })
  await expect(offer).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'settings-alerts-free', fullPage: false })
  await offer.click()
  await expect(page.getByRole('dialog', { name: /Pro/ }).last()).toBeVisible()
})

test('heads-ups follow Google Calendar alone, with the one rule (REVIEW6 L1)', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=settings&tab=alerts&alerts=on&gcal=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const dialog = settings(page)
  await expect(dialog.getByRole('combobox', { name: 'Event heads-up' })).toHaveValue('on')
  await expect(
    dialog.getByText(
      'About 3 hours before an outdoor event (one with an activity set) with UV 6 or higher, from a calendar file or Google Calendar, at most one every 3 hours.',
    ),
  ).toBeVisible()

  // The tab bar: on a phone the first tab reads "Sun" and keeps its name, with room
  // around its label like the others.
  const sun = dialog.getByRole('tab', { name: 'Sun profile' })
  await expect(sun).toBeVisible()
  if (isMobile(testInfo)) {
    expect(await sun.evaluate(element => (element as HTMLElement).innerText.trim())).toBe('Sun')
    for (const name of ['Sun profile', 'Alerts', 'Display', 'Activities', 'Location', 'Account']) {
      const tab = dialog.getByRole('tab', { name })
      const room = await tab.evaluate(element => {
        const label = [...element.querySelectorAll('span')].find(
          span => getComputedStyle(span).display !== 'none',
        )
        const range = document.createRange()
        range.selectNodeContents(label ?? element)
        const text = [...range.getClientRects()].find(r => r.width > 0)!
        const box = element.getBoundingClientRect()
        return Math.min(text.left - box.left, box.right - text.right)
      })
      expect(room, `${name} label side room`).toBeGreaterThanOrEqual(name === 'Activities' ? 3 : 8)
    }
  } else {
    expect(await sun.evaluate(element => (element as HTMLElement).innerText.trim())).toBe(
      'Sun profile',
    )
  }
  await captureScreen(page, testInfo, capture, { name: 'settings-alerts-google', fullPage: false })
})

test('the Google panel keeps its actions together on a phone (REVIEW6 L7)', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&gcal=on&google=connected')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const google = page.getByTestId('google-calendar-events')
  const refresh = google.getByRole('button', { name: 'Refresh' })
  const choose = google.getByRole('button', { name: 'Choose calendars' })
  const disconnect = google.getByRole('button', { name: 'Disconnect' })
  await expect(disconnect).toHaveCount(1)
  await google.scrollIntoViewIfNeeded()
  const [r, c, d] = await Promise.all([refresh, choose, disconnect].map(b => b.boundingBox()))
  // Refresh and Choose calendars share a row, and Disconnect never sits alone below them.
  expect(Math.abs(r!.y - c!.y)).toBeLessThan(2)
  expect(d!.y).toBeLessThanOrEqual(r!.y + 1)
  if (isMobile(testInfo)) {
    // A quiet text button beside the calendar's name.
    expect(d!.y).toBeLessThan(r!.y - 20)
  }
  await captureScreen(page, testInfo, capture, { name: 'events-google-connected', fullPage: false })
  await panelShot(page, testInfo, 'events-section-google-connected')

  // The confirmation still reads in one place.
  await disconnect.click()
  await expect(google.getByText('Remove its events and Solara’s access?')).toBeVisible()
  await expect(google.getByRole('button', { name: 'Disconnect' })).toHaveCount(1)
  await panelShot(page, testInfo, 'events-section-google-confirm')
})

test('the panel counts every stored Google event, past the soonest 200 (REVIEW6 L5)', async ({
  page,
}, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&gcal=on&google=many')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(
    page
      .getByTestId('google-calendar-events')
      .getByText(`Updated 2 hours ago · ${GOOGLE_MANY_EVENTS} upcoming events`),
  ).toBeVisible()
  // The section itself still loads only the soonest 200.
  await expect(page.getByRole('button', { name: 'Show all 200 events' })).toBeVisible()
})

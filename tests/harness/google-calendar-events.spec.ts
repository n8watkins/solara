import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// Events already in Google Calendar (docs/integrations/EVENTS.md, phase 2b), switched on
// with ?gcal=on as the deploy's NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED (with the OAuth
// client ID) would. Google is faked at lib/google-events.ts's GoogleCalendarApi
// (google-calendar-fixtures.ts), which answers with Calendar API shaped events, so the
// real parsing, de-duplication and storing run in the page.

/** Answers Open-Meteo: the fixture forecast for any place, and San Diego for place search. */
function answerOpenMeteo(route: Route, url: URL): Promise<void> | false {
  if (url.origin === 'https://api.open-meteo.com') {
    return route.fulfill({ json: buildRawForecast() })
  }
  if (url.origin === 'https://geocoding-api.open-meteo.com') {
    const name = url.searchParams.get('name') ?? ''
    const results = /san diego/i.test(name)
      ? [
          {
            name: 'San Diego',
            admin1: 'California',
            country: 'United States',
            country_code: 'US',
            latitude: 32.72,
            longitude: -117.16,
            timezone: 'America/Los_Angeles',
          },
        ]
      : []
    return route.fulfill({ json: { results } })
  }
  return false
}

async function panelShot(page: Page, testInfo: TestInfo, name: string) {
  const dir = join('test-results', 'ui-harness', 'screenshots')
  mkdirSync(dir, { recursive: true })
  // The sticky header would cover the top of a tall section scrolled into view.
  await page.addStyleTag({ content: '.sticky { position: static !important; }' })
  const shoot = (suffix: string) =>
    page.getByTestId('events-section').screenshot({
      path: join(dir, `${name}${suffix}--${testInfo.project.name}.png`),
      animations: 'disabled',
    })
  await shoot('')
  if (!testInfo.project.name.startsWith('mobile')) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await shoot('-1280')
    await page.setViewportSize({ width: 1440, height: 900 })
  }
}

const cards = (page: Page) => page.getByTestId('event-card')
const panel = (page: Page) => page.getByTestId('google-calendar-events')
const status = (page: Page) => page.getByTestId('google-calendar-status')

test('hidden until switched on', async ({ page }, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&google=connected')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  // The stored events still show (another device may have read them); the panel does not.
  await expect(cards(page)).toHaveCount(2)
  await expect(panel(page)).toHaveCount(0)
})

test('turn it on, choose calendars, and see the UV at each event', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&gcal=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const google = panel(page)
  await expect(google.getByRole('heading', { name: 'Google Calendar' })).toBeVisible()
  await expect(google.getByText(/reads the next 30 days in this browser/)).toBeVisible()
  await google.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-google-offer', fullPage: false })
  await panelShot(page, testInfo, 'events-section-google-offer')

  // Turning it on asks for the read-only events scope only, with a click.
  await google.getByRole('button', { name: 'Show my Google Calendar events' }).click()
  await expect(status(page)).toHaveText('Showing 2 upcoming events from Google Calendar.')
  const log = await page.evaluate(
    () => (window as unknown as { __solaraGoogle: { tokenRequests: unknown[] } }).__solaraGoogle,
  )
  expect(log.tokenRequests[0]).toEqual({
    scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
    interactive: true,
  })

  // The meeting (a video call link), the all-day offsite and the declined game are left out.
  await expect(cards(page)).toHaveCount(2)
  const picnic = page.getByRole('listitem', { name: 'Family picnic' })
  await expect(picnic.getByText('San Diego, California')).toBeVisible()
  await expect(picnic.getByText('From Google Calendar')).toBeVisible()
  await expect(picnic.getByText(/^Peak UV \d+\.\d at/)).toBeVisible()
  // It would come back at the next refresh, so it has no remove button of its own.
  await expect(picnic.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
  const run = page.getByRole('listitem', { name: 'Morning run' })
  await expect(run.getByText('Using Los Angeles, California')).toBeVisible()
  await expect(run.getByRole('combobox', { name: 'Counts as' })).toHaveValue('run')
  await expect(page.getByRole('listitem', { name: 'Team standup' })).toHaveCount(0)
  await expect(
    google.getByTestId('google-calendar-link').getByText('Your main calendar'),
  ).toBeVisible()
  await expect(google.getByText('Updated just now · 2 upcoming events')).toBeVisible()

  // Choose calendars: the list asks for its own scope, and the main calendar is ticked.
  await google.getByRole('button', { name: 'Choose calendars' }).click()
  const choices = google.getByRole('group', { name: 'Calendars to show events from' })
  await expect(choices.getByRole('checkbox', { name: 'Your main calendar' })).toBeChecked()
  await expect(choices.getByRole('checkbox')).toHaveCount(3)
  await choices.getByRole('checkbox', { name: 'LA Trail Runners' }).check()
  await google.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-google-choose', fullPage: false })
  await panelShot(page, testInfo, 'events-section-google-choose')
  await choices.getByRole('button', { name: 'Save' }).click()
  await expect(status(page)).toHaveText('Showing 3 upcoming events from Google Calendar.')
  await expect(page.getByRole('listitem', { name: 'Saturday hike' })).toBeVisible()
  await expect(google.getByText('Your main calendar and LA Trail Runners')).toBeVisible()
  const scopes = await page.evaluate(() =>
    (
      window as unknown as { __solaraGoogle: { tokenRequests: { scope: string }[] } }
    ).__solaraGoogle.tokenRequests.map(r => r.scope),
  )
  expect(scopes).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly')
})

test('a connected account: refresh, then disconnect', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&gcal=on&google=connected&events=sample')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const google = panel(page)
  await expect(google.getByText('Updated 2 hours ago · 2 upcoming events')).toBeVisible()
  // Said once below the Google and Outlook panels (REVIEW7 L7.2), not inside this one.
  await expect(page.getByTestId('calendar-refresh-note')).toBeVisible()
  await expect(google.getByText(/Events update while Solara is open/)).toHaveCount(0)
  // No token in this session yet, so nothing refreshed by itself.
  expect(
    await page.evaluate(
      () => (window as unknown as { __solaraGoogle: { listed: string[] } }).__solaraGoogle.listed,
    ),
  ).toEqual([])
  await google.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-google-connected', fullPage: false })
  await panelShot(page, testInfo, 'events-section-google-connected')

  await google.getByRole('button', { name: 'Refresh' }).click()
  await expect(status(page)).toHaveText('Showing 2 upcoming events from Google Calendar.')
  await expect(google.getByText(/^Updated just now/)).toBeVisible()

  // "Remove imported events" leaves Google's (a refresh would bring them back).
  const section = page.getByRole('region', { name: 'Events' })
  await section.getByRole('button', { name: 'Remove imported events' }).click()
  await expect(section.getByText(/Events from Google Calendar stay/)).toBeVisible()
  await section.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByTestId('events-status')).toHaveText('Removed every imported event.')
  await expect(cards(page)).toHaveCount(2)
  await expect(section.getByRole('button', { name: 'Remove imported events' })).toHaveCount(0)

  await google.getByRole('button', { name: 'Disconnect' }).click()
  await expect(google.getByText("Remove its events and Solara's access?")).toBeVisible()
  await expect(google.getByText(/Scheduled activities will ask to connect again/)).toBeVisible()
  await google.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, {
    name: 'events-google-disconnect',
    fullPage: false,
  })
  await google.getByRole('button', { name: 'Disconnect' }).click()
  await expect(status(page)).toHaveText('Disconnected Google Calendar and removed its events.')
  // The Google events are gone, and the offer is back.
  await expect(cards(page)).toHaveCount(0)
  await expect(page.getByText('From Google Calendar')).toHaveCount(0)
  await expect(google.getByRole('button', { name: 'Show my Google Calendar events' })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { __solaraGoogle: { revoked: number } }).__solaraGoogle.revoked,
    ),
  ).toBe(1)
})

test('closing the consent popup is not an error', async ({ page }, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.addInitScript(() => {
    ;(window as unknown as { __solaraGooglePopup: string }).__solaraGooglePopup = 'closed'
  })
  await page.goto('/harness/?screen=dashboard&gcal=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await panel(page).getByRole('button', { name: 'Show my Google Calendar events' }).click()
  await expect(
    panel(page).getByRole('button', { name: 'Show my Google Calendar events' }),
  ).toBeEnabled()
  await expect(status(page)).toHaveCount(0)
  await expect(cards(page)).toHaveCount(0)
})

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// Events already in Outlook (docs/integrations/OUTLOOK.md, ROADMAP item 23), switched on
// with ?outlook=on as the deploy's NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED (with the
// Microsoft client ID) would. Microsoft is faked at lib/outlook-events.ts's
// OutlookCalendarApi (outlook-calendar-fixtures.ts), which answers with Graph shaped
// events, so the real parsing, de-duplication and storing run in the page.

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

/** The Events section alone, at the project's width and (on desktop) at 1280 px too. */
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
const panel = (page: Page) => page.getByTestId('outlook-calendar-events')
const status = (page: Page) => page.getByTestId('outlook-calendar-status')

interface Log {
  tokenRequests: { interactive: boolean }[]
  signIns: number
  listed: string[]
  forgotten: number
}
const log = (page: Page) =>
  page.evaluate(() => (window as unknown as { __solaraOutlook: Log }).__solaraOutlook)

test('hidden until switched on', async ({ page }, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&outlookcal=connected')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  // The stored events still show (another device may have read them); the panel does not.
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByText('From Outlook')).toHaveCount(2)
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Events' })).not.toContainText('or Outlook')
})

test('turn it on, choose calendars, and see the UV at each event', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&outlook=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByRole('region', { name: 'Events' })
  await expect(section.getByText(/from a calendar \(\.ics\) file or Outlook\./)).toBeVisible()
  const outlook = panel(page)
  await expect(outlook.getByRole('heading', { name: 'Outlook' })).toBeVisible()
  await expect(outlook.getByText(/Outlook\.com or Microsoft 365 calendar/)).toBeVisible()
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-outlook-offer', fullPage: false })
  await panelShot(page, testInfo, 'events-section-outlook-offer')

  // Turning it on opens Microsoft's sign-in with a click.
  await outlook.getByRole('button', { name: 'Show my Outlook events' }).click()
  await expect(status(page)).toHaveText('Showing 2 upcoming events from Outlook.')
  expect((await log(page)).tokenRequests[0]).toEqual({ interactive: true })
  expect((await log(page)).listed).toEqual(['default'])

  // The Teams meeting, the all-day offsite, the conference room and the declined game are
  // left out.
  await expect(cards(page)).toHaveCount(2)
  const picnic = page.getByRole('listitem', { name: 'Family picnic' })
  await expect(picnic.getByText('San Diego, California')).toBeVisible()
  await expect(picnic.getByText('From Outlook')).toBeVisible()
  await expect(picnic.getByText(/^Peak UV \d+\.\d at/)).toBeVisible()
  // It would come back at the next refresh, so it has no remove button of its own.
  await expect(picnic.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
  const run = page.getByRole('listitem', { name: 'Morning run' })
  await expect(run.getByText('Using Los Angeles, California')).toBeVisible()
  await expect(run.getByRole('combobox', { name: 'Counts as' })).toHaveValue('run')
  for (const name of ['Team standup', 'Design review', 'Beach volleyball', 'Company offsite']) {
    await expect(page.getByRole('listitem', { name })).toHaveCount(0)
  }
  await expect(outlook.getByText('Updated just now · 2 upcoming events')).toBeVisible()
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, {
    name: 'events-outlook-connected',
    fullPage: false,
  })

  // Choose calendars: the same permission lists them, and the default one is ticked.
  await outlook.getByRole('button', { name: 'Choose calendars' }).click()
  const choices = outlook.getByRole('group', { name: 'Calendars to show events from' })
  await expect(choices.getByRole('checkbox', { name: 'Your main calendar' })).toBeChecked()
  await expect(choices.getByRole('checkbox')).toHaveCount(3)
  await choices.getByRole('checkbox', { name: 'Running club' }).check()
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-outlook-choose', fullPage: false })
  await panelShot(page, testInfo, 'events-section-outlook-choose')
  await choices.getByRole('button', { name: 'Save' }).click()
  await expect(status(page)).toHaveText('Showing 3 upcoming events from Outlook.')
  // The club's hike was picked from Outlook's place search: named without a place search.
  const hike = page.getByRole('listitem', { name: 'Saturday hike' })
  await expect(hike.getByText('Torrey Pines State Natural Reserve')).toBeVisible()
  await expect(outlook.getByText('Your main calendar and Running club')).toBeVisible()
  // One sign-in covered reading events and listing calendars: no second consent.
  expect((await log(page)).signIns).toBe(1)
  await panelShot(page, testInfo, 'events-section-outlook-connected')
})

test('a connected account: refresh, then disconnect with Microsoft’s pages', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&outlook=on&outlookcal=connected&events=sample')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const outlook = panel(page)
  await expect(outlook.getByText('Updated 2 hours ago · 2 upcoming events')).toBeVisible()
  // No token in this session yet, so nothing refreshed by itself.
  expect((await log(page)).listed).toEqual([])

  await outlook.getByRole('button', { name: 'Refresh' }).click()
  await expect(status(page)).toHaveText('Showing 2 upcoming events from Outlook.')
  await expect(outlook.getByText(/^Updated just now/)).toBeVisible()

  // "Remove imported events" leaves Outlook's (a refresh would bring them back).
  const section = page.getByRole('region', { name: 'Events' })
  await section.getByRole('button', { name: 'Remove imported events' }).click()
  await expect(
    section.getByText('Events from Outlook stay; remove those with their calendar below.'),
  ).toBeVisible()
  await section.getByRole('button', { name: 'Keep' }).click()

  await outlook.getByRole('button', { name: 'Disconnect' }).click()
  await expect(outlook.getByText('Remove its events from Solara?')).toBeVisible()
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, {
    name: 'events-outlook-disconnect',
    fullPage: false,
  })
  await outlook.getByRole('button', { name: 'Disconnect' }).click()
  await expect(status(page)).toContainText('Disconnected Outlook and removed its events.')
  await expect(status(page).getByRole('link', { name: 'your Microsoft account' })).toHaveAttribute(
    'href',
    'https://account.live.com/consent/Manage',
  )
  await expect(status(page).getByRole('link', { name: 'My Apps' })).toHaveAttribute(
    'href',
    'https://myapplications.microsoft.com/',
  )
  // The Outlook events are gone, the token forgotten, and the offer is back.
  await expect(page.getByText('From Outlook')).toHaveCount(0)
  await expect(outlook.getByRole('button', { name: 'Show my Outlook events' })).toBeVisible()
  expect((await log(page)).forgotten).toBe(1)
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, {
    name: 'events-outlook-disconnected',
    fullPage: false,
  })
  await panelShot(page, testInfo, 'events-section-outlook-disconnected')
})

test('an organization that must approve Solara, a blocked popup and a closed one', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.addInitScript(() => {
    ;(window as unknown as { __solaraOutlookPopup: string }).__solaraOutlookPopup = 'admin'
  })
  await page.goto('/harness/?screen=dashboard&outlook=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const outlook = panel(page)
  const show = outlook.getByRole('button', { name: 'Show my Outlook events' })
  await show.click()
  await expect(status(page)).toHaveText(
    'Your organization needs to approve Solara before it can read your work calendar. Ask your IT team.',
  )
  await expect(status(page)).toHaveAttribute('role', 'alert')
  await outlook.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-outlook-admin', fullPage: false })

  await page.evaluate(() => {
    ;(window as unknown as { __solaraOutlookPopup: string }).__solaraOutlookPopup = 'blocked'
  })
  await show.click()
  await expect(status(page)).toHaveText(
    'Your browser blocked the Microsoft sign-in window. Allow pop-ups for Solara, then try again.',
  )

  // Closing the sign-in is not an error.
  await page.evaluate(() => {
    ;(window as unknown as { __solaraOutlookPopup: string }).__solaraOutlookPopup = 'closed'
  })
  await show.click()
  await expect(show).toBeEnabled()
  await expect(status(page)).toHaveCount(0)
  await expect(cards(page)).toHaveCount(0)
})

test('with linked calendars on, an organization’s refusal points to them', async ({
  page,
}, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.addInitScript(() => {
    ;(window as unknown as { __solaraOutlookPopup: string }).__solaraOutlookPopup = 'admin'
  })
  await page.goto('/harness/?screen=dashboard&outlook=on&subscriptions=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await panel(page).getByRole('button', { name: 'Show my Outlook events' }).click()
  await expect(status(page)).toHaveText(
    'Your organization needs to approve Solara before it can read your work calendar. Ask your IT team, or link the calendar under Linked calendars instead.',
  )
})

test('Google Calendar and Outlook together show a shared event once', async ({
  page,
}, testInfo) => {
  await preparePage(page, testInfo, answerOpenMeteo)
  // The same picnic is already stored from Google Calendar.
  await page.goto('/harness/?screen=dashboard&outlook=on&gcal=on&google=connected')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByRole('region', { name: 'Events' })
  await expect(
    section.getByText(/from a calendar \(\.ics\) file, Google Calendar or Outlook\./),
  ).toBeVisible()
  await panel(page).getByRole('button', { name: 'Show my Outlook events' }).click()
  await expect(status(page)).toHaveText(
    'No events in the next 30 days have an address or match one of your activities. 2 events already in Solara are shown once.',
  )
  await expect(page.getByRole('listitem', { name: 'Family picnic' })).toHaveCount(1)
  await expect(page.getByText('From Outlook')).toHaveCount(0)
})

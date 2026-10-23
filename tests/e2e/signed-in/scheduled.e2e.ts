import { HARNESS_TIMEZONE } from '../../harness/clock'
import type { FakeEvent, FakeGoogleCalendar } from './fake-google-calendar'
import { accountMenu, expect, HIKING, openDashboard, preparePage, RUNNING, test } from './fixtures'
import type { Account, Emulators, Page } from './fixtures'

// Scheduled activities end to end: the real app on the emulators (Auth, Firestore with
// the real rules), with Google Identity Services and the Calendar API answered by an
// in-test fake that records every call (fake-google-calendar.ts).

const EVENTS_PATH = '/calendar/v3/calendars/primary/events'

/** Every events read Solara makes asks Google for Solara's own events only. */
function expectOnlyOwnEventsRead(calendar: FakeGoogleCalendar) {
  const lists = calendar.calls.filter(c => c.method === 'GET' && c.path === EVENTS_PATH)
  for (const call of lists) expect(call.query.privateExtendedProperty).toBe('solara=1')
  const known = new Set(calendar.solaraEvents().map(e => e.id))
  for (const call of calendar.calls.filter(c => c.path.startsWith(`${EVENTS_PATH}/`))) {
    expect(known.has(decodeURIComponent(call.path.split('/').pop()!))).toBe(true)
  }
}

async function openCalendar(page: Page) {
  await page.getByRole('button', { name: '🗓️ Calendar', exact: true }).click()
  await expect(page.getByRole('main').getByRole('group', { name: 'Hours shown' })).toBeVisible()
  return page.getByRole('main')
}

/** Adds today's 6pm-8pm running window to Google Calendar from the calendar view. */
async function scheduleRunningToday(page: Page) {
  const main = await openCalendar(page)
  await main.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }).click()
  await page
    .getByRole('dialog', { name: 'Running' })
    .getByRole('button', { name: /Add to Google Calendar/ })
    .click()
  await expect(
    main.getByRole('button', { name: 'Scheduled: Running, Today, 6pm – 6:45pm' }),
  ).toBeVisible()
  return main
}

/** The stored record for a Solara event, as the app writes it. */
function recordFor(event: FakeEvent, activityId: string, icon: string) {
  return {
    eventId: event.id,
    calendarId: 'primary',
    activityId,
    title: event.summary,
    icon,
    start: new Date(event.start.dateTime).toISOString(),
    end: new Date(event.end.dateTime).toISOString(),
    timeZone: 'America/Los_Angeles',
    htmlLink: event.htmlLink,
    createdAt: '2026-06-14T17:00:00.000Z',
    updatedAt: '2026-06-14T17:00:00.000Z',
  }
}

function solaraEvent(
  calendar: FakeGoogleCalendar,
  activity: { id: string; icon: string; name: string },
  start: string,
  end: string,
) {
  return calendar.addEvent({
    summary: `${activity.icon} ${activity.name}: lower-UV window`,
    start: { dateTime: start, timeZone: 'America/Los_Angeles' },
    end: { dateTime: end, timeZone: 'America/Los_Angeles' },
    extendedProperties: { private: { solara: '1', solaraActivityId: activity.id } },
  })
}

async function paidRunner(emulators: Emulators, name: string): Promise<Account> {
  const account = await emulators.createAccount(name)
  await emulators.seedPrefs(account, { tier: 'paid', activities: [RUNNING, HIKING] })
  return account
}

test('add a window to Google Calendar, then open, move and remove it', async ({
  page,
  emulators,
  googleCalendar,
}) => {
  const account = await paidRunner(emulators, 'Ria Moss')
  await openDashboard(page, account)
  const main = await scheduleRunningToday(page)
  await expect(
    page.getByRole('status').filter({ hasText: 'Scheduled Running for 6pm' }),
  ).toBeVisible()

  // Google has one tagged event at the recommended time...
  const [event, ...others] = googleCalendar.solaraEvents()
  expect(others).toEqual([])
  expect(event).toMatchObject({
    summary: '🏃 Running: lower-UV window',
    start: { dateTime: '2026-06-15T18:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-15T18:45:00-07:00' },
    extendedProperties: {
      private: { solara: '1', solaraActivityId: 'run', solaraWindowDate: '2026-06-15' },
    },
  })
  // ...and Firestore has its record.
  await expect
    .poll(() => emulators.readScheduled(account))
    .toEqual({
      [event!.id]: expect.objectContaining({
        eventId: event!.id,
        activityId: 'run',
        start: '2026-06-16T01:00:00.000Z',
        end: '2026-06-16T01:45:00.000Z',
        htmlLink: event!.htmlLink,
      }),
    })
  await expect(
    main
      .getByRole('region', { name: 'Scheduled' })
      .getByRole('button', { name: 'Scheduled: Running Today · 6pm – 6:45pm' }),
  ).toBeVisible()

  // Details: open the event in Google Calendar.
  await main.getByRole('button', { name: 'Scheduled: Running, Today, 6pm – 6:45pm' }).click()
  const sheet = page.getByRole('dialog', { name: 'Running' })
  await expect(sheet.getByText('✓ Scheduled')).toBeVisible()
  const link = sheet.getByRole('link', { name: /Open in Google Calendar/ })
  await expect(link).toHaveAttribute('href', event!.htmlLink)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  // Change time, within the day's lower-UV window.
  await sheet.getByRole('button', { name: 'Change time' }).click()
  await sheet
    .getByRole('combobox', { name: /New start time/ })
    .selectOption({ label: '7pm – 7:45pm' })
  await sheet.getByRole('button', { name: 'Save time' }).click()
  await expect(sheet.getByText('Today · 7pm – 7:45pm')).toBeVisible()
  expect(googleCalendar.events.get(event!.id)).toMatchObject({
    start: { dateTime: '2026-06-15T19:00:00-07:00' },
    end: { dateTime: '2026-06-15T19:45:00-07:00' },
  })
  await expect
    .poll(async () => (await emulators.readScheduled(account))[event!.id]?.start)
    .toBe('2026-06-16T02:00:00.000Z')
  await expect(
    main.getByRole('button', { name: 'Scheduled: Running, Today, 7pm – 7:45pm' }),
  ).toBeVisible()

  // Remove asks first, then deletes the Google event and the record.
  await sheet.getByRole('button', { name: 'Remove from calendar' }).click()
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(main.getByRole('button', { name: /^Scheduled: Running/ })).toHaveCount(0)
  expect(googleCalendar.events.get(event!.id)?.status).toBe('cancelled')
  await expect.poll(() => emulators.readScheduled(account)).toEqual({})
  expectOnlyOwnEventsRead(googleCalendar)
})

test('the dashboard card books the recommended slot and shows it as Scheduled', async ({
  page,
  emulators,
  googleCalendar,
}) => {
  const account = await paidRunner(emulators, 'Ana Kerr')
  await openDashboard(page, account)
  const card = page.locator('[data-testid="activity-card"][data-activity="run"]')
  await card.getByRole('button', { name: /Add to Google Calendar/ }).click()
  const row = card.getByTestId('scheduled-card-row')
  await expect(row.getByText('6pm–6:45pm', { exact: true })).toBeVisible()
  const [event] = googleCalendar.solaraEvents()
  await expect(
    row.getByRole('link', { name: 'Open scheduled Running, 6pm–6:45pm, in Google Calendar' }),
  ).toHaveAttribute('href', event!.htmlLink)
  await expect(card.getByTestId('recommended-slot')).toHaveCount(0)
})

test('moves and deletions made in Google Calendar are reconciled', async ({
  page,
  emulators,
  googleCalendar,
}) => {
  const account = await paidRunner(emulators, 'Theo Park')
  const run = solaraEvent(googleCalendar, RUNNING, '2026-06-15T18:00:00', '2026-06-15T18:45:00')
  const hike = solaraEvent(googleCalendar, HIKING, '2026-06-16T16:00:00', '2026-06-16T18:00:00')
  // Not Solara's: never requested, never shown.
  googleCalendar.addEvent({
    summary: 'Dentist',
    start: { dateTime: '2026-06-15T15:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-15T16:00:00', timeZone: 'America/Los_Angeles' },
  })
  await emulators.seedScheduled(account, recordFor(run, 'run', '🏃'))
  await emulators.seedScheduled(account, recordFor(hike, 'hike', '🥾'))

  await openDashboard(page, account)
  const main = await openCalendar(page)
  const list = main.getByRole('region', { name: 'Scheduled' })
  // Without a Google token, saved items show at once with a reconnect hint.
  await expect(list.getByTestId('scheduled-row')).toHaveCount(2)
  await expect(list.getByRole('button', { name: 'Reconnect to sync' })).toBeVisible()
  expect(googleCalendar.calls).toEqual([])

  // Meanwhile, in Google Calendar: the run moves to 7pm and the hike is deleted.
  googleCalendar.moveEvent(run.id, '2026-06-15T19:00:00-07:00', '2026-06-15T19:45:00-07:00')
  googleCalendar.deleteEvent(hike.id)

  await list.getByRole('button', { name: 'Reconnect to sync' }).click()
  await expect(list.getByText('Updated from Google Calendar: 1 moved, 1 removed.')).toBeVisible()
  await expect(
    main.getByRole('button', { name: 'Scheduled: Running, Today, 7pm – 7:45pm' }),
  ).toBeVisible()
  await expect(main.getByRole('button', { name: /^Scheduled: Hiking/ })).toHaveCount(0)
  await expect
    .poll(() => emulators.readScheduled(account))
    .toEqual({ [run.id]: expect.objectContaining({ start: '2026-06-16T02:00:00.000Z' }) })
  await expect(page.getByText('Dentist')).toHaveCount(0)
  expectOnlyOwnEventsRead(googleCalendar)

  // A deleted event that Google no longer lists at all is found by id and dropped.
  googleCalendar.deleteEvent(run.id, { purge: true })
  await page.getByRole('button', { name: /Dashboard/ }).click()
  await openCalendar(page)
  await expect(main.getByRole('button', { name: /^Scheduled: Running/ })).toHaveCount(0)
  await expect.poll(() => emulators.readScheduled(account)).toEqual({})

  // An expired token falls back to the saved list and the reconnect hint.
  const again = solaraEvent(googleCalendar, RUNNING, '2026-06-16T18:00:00', '2026-06-16T18:45:00')
  await emulators.seedScheduled(account, recordFor(again, 'run', '🏃'))
  googleCalendar.expireTokens()
  await page.getByRole('button', { name: /Dashboard/ }).click()
  await openCalendar(page)
  await expect(list.getByTestId('scheduled-row')).toHaveCount(1)
  await expect(list.getByRole('button', { name: 'Reconnect to sync' })).toBeVisible()
})

test('another device sees scheduled items; another account sees none', async ({
  page,
  browser,
  baseURL,
  emulators,
  googleCalendar,
}) => {
  const account = await paidRunner(emulators, 'Mia Lund')
  await openDashboard(page, account)
  await scheduleRunningToday(page)
  await expect.poll(async () => Object.keys(await emulators.readScheduled(account))).toHaveLength(1)

  // A second device: a fresh browser with no Google token and no local data.
  const context = await browser.newContext({
    baseURL,
    locale: 'en-US',
    timezoneId: HARNESS_TIMEZONE,
  })
  try {
    const other = await context.newPage()
    const blocked: string[] = []
    await preparePage(other, baseURL!, blocked, googleCalendar)
    await openDashboard(other, account)
    const card = other.locator('[data-testid="activity-card"][data-activity="run"]')
    await expect(card.getByTestId('scheduled-card-row').getByText('6pm–6:45pm')).toBeVisible()
    const main = await openCalendar(other)
    await expect(
      main.getByRole('button', { name: 'Scheduled: Running, Today, 6pm – 6:45pm' }),
    ).toBeVisible()
    await expect(
      main.getByRole('region', { name: 'Scheduled' }).getByRole('button', {
        name: 'Reconnect to sync',
      }),
    ).toBeVisible()

    // Signing out and in as someone else shows none of it.
    await accountMenu(other, 'Sign out')
    const bob = await paidRunner(emulators, 'Bob Lund')
    await openDashboard(other, bob)
    await expect(other.getByTestId('scheduled-card-row')).toHaveCount(0)
    const bobMain = await openCalendar(other)
    await expect(bobMain.getByRole('button', { name: /^Running, Today, 6pm – 8pm/ })).toBeVisible()
    await expect(bobMain.getByRole('region', { name: 'Scheduled' })).toHaveCount(0)
    await expect(bobMain.getByRole('button', { name: /^Scheduled:/ })).toHaveCount(0)
    expect(blocked).toEqual([])
  } finally {
    await context.close()
  }
})

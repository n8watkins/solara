import { expect, openDashboard, RUNNING, test } from './fixtures'
import type { Page } from './fixtures'

// Imported events at scale and on re-import (REVIEW4 M3, M4 and L1), on the real app
// against the emulators with the real rules. The clock is Monday 2026-06-15, 10:30 in
// Los Angeles (17:30 UTC).

function eventsSection(page: Page) {
  return page.getByRole('region', { name: 'Events' })
}

/** A stored imported event, as the app writes it. */
function stored(index: number, title: string, start: string, end: string) {
  const key = index.toString(16).padStart(32, '0')
  return {
    key,
    source: 'file',
    seriesId: key,
    title,
    start,
    end,
    timeZone: 'America/Los_Angeles',
    where: '',
    lat: 34.05,
    lon: -118.24,
    placeLabel: 'Los Angeles, California',
    placeGuessed: false,
    activityId: '',
    url: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

test('with more than 200 future events the soonest still show, and "Remove imported events" removes every one', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Mara Lindqvist')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  // 250 events from July on (a race series), and one this afternoon.
  const later = Array.from({ length: 250 }, (_, i) => {
    const start = new Date(Date.UTC(2026, 6, 1, 16) + i * 86_400_000)
    return stored(
      i + 1,
      `Series race ${i + 1}`,
      start.toISOString(),
      new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    )
  })
  const today = stored(
    1000,
    'Afternoon swim',
    '2026-06-15T20:00:00.000Z',
    '2026-06-15T21:00:00.000Z',
  )
  await emulators.seedEvents(account, [...later, today])

  await openDashboard(page, account)
  const section = eventsSection(page)
  const cards = section.getByTestId('event-card')
  await expect(cards.first()).toBeVisible()
  await expect(cards.first()).toHaveAccessibleName('Afternoon swim')
  await expect(section.getByRole('listitem', { name: 'Series race 1', exact: true })).toBeVisible()

  await section.getByRole('button', { name: 'Remove imported events' }).click()
  await section.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByTestId('events-status')).toHaveText('Removed every imported event.', {
    timeout: 60_000,
  })
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(0)
  await expect(section.getByText(/No upcoming events yet/)).toBeVisible()
})

const UPDATED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Solara e2e//Events//EN',
  'BEGIN:VEVENT',
  'UID:10k-2026@race.example',
  'DTSTART;TZID=America/Los_Angeles:20260616T090000',
  'DTEND;TZID=America/Los_Angeles:20260616T103000',
  'SUMMARY:Tuesday 10K\\, Griffith Park',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:club-ride@club.example',
  'DTSTART;TZID=America/Los_Angeles:20260601T170000',
  'DURATION:PT1H30M',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  'EXDATE;TZID=America/Los_Angeles:20260617T170000',
  'SUMMARY:Club ride',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:picnic@friends.example',
  'DTSTART:20260616T190000Z',
  'DTEND:20260616T203000Z',
  'SUMMARY:Picnic',
  'LOCATION:Echo Park Lake\\, Los Angeles\\, CA',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('re-importing a calendar removes events cancelled or dropped at the source', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Iris Okafor')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  await page.getByTestId('events-file').setInputFiles('tests/e2e/signed-in/files/events.ics')
  await expect(page.getByTestId('events-status')).toContainText('Imported 6 events.')
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(6)

  // The organiser cancels the 10K and the club skips Wednesday's ride.
  await page.getByTestId('events-file').setInputFiles({
    name: 'events.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(UPDATED),
  })
  await expect(page.getByTestId('events-status')).toContainText('Imported 4 events.')
  await expect(page.getByTestId('events-status')).toContainText(
    'Removed 2 events cancelled or no longer in the calendar.',
  )
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(4)
  const titles = Object.values(await emulators.readEvents(account)).map(e => e.title)
  expect(titles).not.toContain('Tuesday 10K, Griffith Park')
  const rides = Object.values(await emulators.readEvents(account))
    .filter(e => e.title === 'Club ride')
    .map(e => e.start)
    .sort()
  expect(rides).toEqual([
    '2026-06-16T00:00:00.000Z',
    '2026-06-23T00:00:00.000Z',
    '2026-06-25T00:00:00.000Z',
  ])
  await expect(
    eventsSection(page).getByRole('listitem', { name: 'Tuesday 10K, Griffith Park' }),
  ).toHaveCount(0)
})

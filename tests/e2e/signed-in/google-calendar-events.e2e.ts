import { expect, openDashboard, RUNNING, test } from './fixtures'
import type { Page } from './fixtures'

// Events already in Google Calendar end to end (docs/integrations/EVENTS.md, phase 2b): the
// real app on the emulators (Auth, Firestore with the real rules and the 1,000-event key
// list), with Google Identity Services and the Calendar API answered by the in-test fake
// (fake-google-calendar.ts). The clock is Monday 2026-06-15, 10:30 in Los Angeles.

function googlePanel(page: Page) {
  return page.getByTestId('google-calendar-events')
}

test('show events from Google Calendar, choose calendars, refresh and disconnect', async ({
  page,
  emulators,
  googleCalendar,
}) => {
  // A picnic with a place, a run without one, a video call, a declined game, and a club
  // calendar's hike that is shown only once that calendar is chosen.
  googleCalendar.addEvent({
    id: 'picnic',
    iCalUID: 'picnic@google.com',
    summary: 'Family picnic',
    location: 'Echo Park, Los Angeles, CA',
    description: 'Bring the blue blanket',
    attendees: [{ email: 'aunt@example.com', responseStatus: 'accepted' }],
    start: { dateTime: '2026-06-16T12:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-16T14:00:00', timeZone: 'America/Los_Angeles' },
  })
  googleCalendar.addEvent({
    id: 'run',
    summary: 'Morning run',
    start: { dateTime: '2026-06-17T07:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-17T08:00:00', timeZone: 'America/Los_Angeles' },
  })
  googleCalendar.addEvent({
    id: 'standup',
    summary: 'Standup',
    location: 'https://meet.google.com/abc-defg-hij',
    start: { dateTime: '2026-06-16T09:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-16T09:15:00', timeZone: 'America/Los_Angeles' },
  })
  googleCalendar.addEvent({
    id: 'volleyball',
    summary: 'Beach volleyball',
    location: 'Venice Beach, Los Angeles, CA',
    attendees: [{ self: true, responseStatus: 'declined' }],
    start: { dateTime: '2026-06-18T15:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-18T17:00:00', timeZone: 'America/Los_Angeles' },
  })
  // Work and personal locations that are not towns (REVIEW6 M2): a doctor's visit is not
  // kept, and a run with its coach is kept for the activity, but neither text is ever sent
  // to the place search.
  googleCalendar.addEvent({
    id: 'checkup',
    summary: 'Checkup',
    location: 'Dr Patel',
    start: { dateTime: '2026-06-16T15:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-16T16:00:00', timeZone: 'America/Los_Angeles' },
  })
  googleCalendar.addEvent({
    id: 'track',
    summary: 'Track run',
    location: 'Coach Lee, Room 2',
    start: { dateTime: '2026-06-18T07:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-18T08:00:00', timeZone: 'America/Los_Angeles' },
  })
  googleCalendar.calendarList.push({ id: 'club@group.calendar.google.com', summary: 'Hiking club' })
  googleCalendar.addEvent({
    id: 'hike',
    calendarId: 'club@group.calendar.google.com',
    summary: 'Griffith hike',
    location: 'Griffith Park, Los Angeles, CA',
    start: { dateTime: '2026-06-20T08:00:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-06-20T11:00:00', timeZone: 'America/Los_Angeles' },
  })

  const account = await emulators.createAccount('Gia Park')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  const section = page.getByRole('region', { name: 'Events' })
  const google = googlePanel(page)
  const placeSearches: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin === 'https://geocoding-api.open-meteo.com') {
      placeSearches.push(url.searchParams.get('name') ?? '')
    }
  })

  await google.getByRole('button', { name: 'Show my Google Calendar events' }).click()
  await expect(page.getByTestId('google-calendar-status')).toHaveText(
    'Showing 3 upcoming events from Google Calendar.',
  )
  expect(placeSearches.length).toBeGreaterThan(0)
  expect(placeSearches.every(name => /^Los Angeles(, CA)?$/.test(name))).toBe(true)

  // Stored with the real rules: only title, time and place, no link, description or guests.
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(3)
  const stored = Object.values(await emulators.readEvents(account))
  const picnic = stored.find(e => e.title === 'Family picnic')
  expect(picnic).toEqual({
    key: expect.stringMatching(/^[0-9a-f]{32}$/),
    source: 'google',
    seriesId: expect.stringMatching(/^[0-9a-f]{32}$/),
    title: 'Family picnic',
    start: '2026-06-16T19:00:00.000Z',
    end: '2026-06-16T21:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    where: 'Echo Park, Los Angeles, CA',
    lat: expect.any(Number),
    lon: expect.any(Number),
    placeLabel: 'Los Angeles, California',
    placeGuessed: false,
    activityId: '',
    url: '',
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    expireAt: '2026-07-16T21:00:00Z',
  })
  expect(JSON.stringify(stored)).not.toMatch(/blue blanket|aunt@example|meet\.google|Patel/)
  expect(stored.find(e => e.title === 'Track run')).toMatchObject({
    where: 'Coach Lee, Room 2',
    placeGuessed: true,
    activityId: 'run',
  })
  const run = section.getByRole('listitem', { name: 'Morning run' })
  await expect(run.getByText('From Google Calendar')).toBeVisible()
  await expect(run.getByRole('combobox', { name: 'Counts as' })).toHaveValue('run')

  // Every Calendar read used the read-only token, on the main calendar only.
  const reads = googleCalendar.calls.filter(c => c.path.endsWith('/events'))
  expect(reads.map(c => c.path)).toEqual(['/calendar/v3/calendars/primary/events'])
  expect(reads[0]!.query.fields).not.toContain('description')

  // Choose the club calendar too; the choice is kept in Firestore for every device.
  await google.getByRole('button', { name: 'Choose calendars' }).click()
  await google.getByRole('checkbox', { name: 'Hiking club' }).check()
  await google.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('google-calendar-status')).toHaveText(
    'Showing 4 upcoming events from Google Calendar.',
  )
  await expect(google.getByText('Your main calendar and Hiking club')).toBeVisible()

  // Moved and deleted in Google: a refresh follows, and a reload keeps the connection.
  googleCalendar.moveEvent('run', '2026-06-17T08:00:00-07:00', '2026-06-17T09:00:00-07:00')
  googleCalendar.deleteEvent('picnic', { purge: true })
  await page.reload()
  await expect(google.getByText('Your main calendar and Hiking club')).toBeVisible()
  await google.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByTestId('google-calendar-status')).toHaveText(
    'Showing 3 upcoming events from Google Calendar.',
  )
  await expect
    .poll(async () =>
      Object.values(await emulators.readEvents(account))
        .map(e => `${e.title} ${e.start}`)
        .sort(),
    )
    .toEqual([
      'Griffith hike 2026-06-20T15:00:00.000Z',
      'Morning run 2026-06-17T15:00:00.000Z',
      'Track run 2026-06-18T14:00:00.000Z',
    ])
  expect(placeSearches.some(name => /Patel|Coach|Room/.test(name))).toBe(false)

  // Disconnect: the events and the choice go, and Google's grant is revoked.
  await google.getByRole('button', { name: 'Disconnect' }).click()
  await google.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByTestId('google-calendar-status')).toHaveText(
    'Disconnected Google Calendar and removed its events.',
  )
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(0)
  expect(
    await page.evaluate(() => (window as { __solaraRevoked?: string[] }).__solaraRevoked),
  ).toHaveLength(1)
  await expect(google.getByRole('button', { name: 'Show my Google Calendar events' })).toBeVisible()
  await expect(section.getByText('From Google Calendar')).toHaveCount(0)
  // Nothing asked for more than reading events and the calendar list.
  expect(
    googleCalendar.calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`),
  ).toEqual([])
})

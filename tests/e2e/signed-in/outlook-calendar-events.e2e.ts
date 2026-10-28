import { expect, openDashboard, RUNNING, test } from './fixtures'
import type { Page } from './fixtures'

// Events already in Outlook end to end (docs/integrations/OUTLOOK.md, ROADMAP item 23): the
// real app on the emulators (Auth, Firestore with the real rules and the 1,000-event key
// list), the real sign-in code and redirect page in a real popup, with Microsoft's
// authorize page, token endpoint and Graph answered by the in-test fake
// (fake-microsoft.ts). The clock is Monday 2026-06-15, 10:30 in Los Angeles (17:30 UTC).

function outlookPanel(page: Page) {
  return page.getByTestId('outlook-calendar-events')
}

/** Content-Security-Policy violations, collected from the first script on. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __csp: string[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', event => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
}

test('show events from Outlook, choose calendars, refresh and disconnect', async ({
  page,
  emulators,
  microsoft,
}) => {
  // A picnic with an address, a run without one, a Teams meeting, a declined game, a
  // cancelled event, an office room, and a club calendar's hike at a place picked in
  // Outlook, shown only once that calendar is chosen.
  microsoft.addEvent({
    id: 'picnic',
    subject: 'Family picnic',
    start: '2026-06-16T19:00:00Z',
    end: '2026-06-16T21:00:00Z',
    location: { displayName: 'Echo Park, Los Angeles, CA' },
    body: 'Bring the blue blanket',
  })
  microsoft.addEvent({
    id: 'run',
    subject: 'Morning run',
    start: '2026-06-17T14:00:00Z',
    end: '2026-06-17T15:00:00Z',
  })
  microsoft.addEvent({
    id: 'standup',
    subject: 'Standup',
    start: '2026-06-16T16:00:00Z',
    end: '2026-06-16T16:15:00Z',
    isOnlineMeeting: true,
    location: { displayName: 'Microsoft Teams Meeting' },
    onlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/secret',
  })
  microsoft.addEvent({
    id: 'volleyball',
    subject: 'Beach volleyball',
    start: '2026-06-18T22:00:00Z',
    end: '2026-06-19T00:00:00Z',
    location: { displayName: 'Venice Beach, Los Angeles, CA' },
    response: 'declined',
  })
  microsoft.addEvent({
    id: 'gone',
    subject: 'Cancelled ride',
    start: '2026-06-18T15:00:00Z',
    end: '2026-06-18T16:00:00Z',
    location: { displayName: 'Santa Monica, CA' },
    isCancelled: true,
  })
  microsoft.addEvent({
    id: 'review',
    subject: 'Design review',
    start: '2026-06-17T17:00:00Z',
    end: '2026-06-17T18:00:00Z',
    location: {
      displayName: 'Conf Room Rainier, Los Angeles, CA',
      locationType: 'conferenceRoom',
      coordinates: { latitude: 34.05, longitude: -118.25 },
    },
  })
  microsoft.calendars.push({ id: 'AAMkAGI2club=', name: 'Hiking club' })
  // Someone else's calendar shared with the person is never offered.
  microsoft.calendars.push({ id: 'AAMkAGI2boss=', name: 'Ana', owner: 'ana@contoso.com' })
  microsoft.addEvent({
    id: 'hike',
    calendarId: 'AAMkAGI2club=',
    subject: 'Griffith hike',
    start: '2026-06-20T15:00:00Z',
    end: '2026-06-20T18:00:00Z',
    location: {
      displayName: 'Griffith Observatory',
      locationType: 'localBusiness',
      coordinates: { latitude: 34.1184, longitude: -118.3004 },
    },
  })

  const violations = await watchCsp(page)
  const account = await emulators.createAccount('Gia Park')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  const section = page.getByRole('region', { name: 'Events' })
  const outlook = outlookPanel(page)
  const placeSearches: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin === 'https://geocoding-api.open-meteo.com') {
      placeSearches.push(url.searchParams.get('name') ?? '')
    }
  })

  // The sign-in opens in a popup, goes through the (fake) Microsoft page, comes back to
  // Solara's redirect page, which hands over the code and closes itself.
  const popupPromise = page.waitForEvent('popup')
  await outlook.getByRole('button', { name: 'Show my Outlook events' }).click()
  const popup = await popupPromise
  await popup.waitForEvent('close')
  await expect(page.getByTestId('outlook-calendar-status')).toHaveText(
    'Showing 2 upcoming events from Outlook.',
  )
  expect(placeSearches.length).toBeGreaterThan(0)
  expect(placeSearches.every(name => /^Los Angeles(, CA)?$/.test(name))).toBe(true)

  // The authorize request asked for one permission, with PKCE, and nothing else.
  const authorize = microsoft.calls.find(c => c.url.pathname.endsWith('/authorize'))!.url
  expect(authorize.searchParams.get('scope')).toBe(
    'https://graph.microsoft.com/Calendars.ReadBasic',
  )
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorize.searchParams.get('redirect_uri')).toBe(
    `${new URL(page.url()).origin}/auth/microsoft/`,
  )
  // The redeemed code was the popup's, with its verifier (the fake refuses anything else).
  const redeems = microsoft.calls.filter(c => c.url.pathname.endsWith('/token'))
  expect(redeems).toHaveLength(1)

  // Stored with the real rules: only title, time and place; no body, link or guests.
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(2)
  const stored = Object.values(await emulators.readEvents(account))
  expect(stored.find(e => e.title === 'Family picnic')).toEqual({
    key: expect.stringMatching(/^[0-9a-f]{32}$/),
    source: 'outlook',
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
  expect(JSON.stringify(stored)).not.toMatch(/blue blanket|aunt@example|teams|Rainier/i)
  const run = section.getByRole('listitem', { name: 'Morning run' })
  await expect(run.getByText('From Outlook')).toBeVisible()
  await expect(run.getByRole('combobox', { name: 'Counts as' })).toHaveValue('run')

  // Every Graph read asked only for the fields Solara keeps, on the default calendar.
  const reads = microsoft.calls.filter(c => c.url.pathname.endsWith('/calendarView'))
  expect(reads.map(c => c.url.pathname)).toEqual(['/v1.0/me/calendar/calendarView'])
  expect(reads[0]!.url.searchParams.get('$select')).not.toMatch(/body|attendees|onlineMeeting\b/)

  // Choose the club calendar too; no second sign-in, and the choice is kept for every device.
  await outlook.getByRole('button', { name: 'Choose calendars' }).click()
  const choices = outlook.getByRole('group', { name: 'Calendars to show events from' })
  await expect(choices.getByRole('checkbox')).toHaveCount(2)
  await choices.getByRole('checkbox', { name: 'Hiking club' }).check()
  await outlook.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('outlook-calendar-status')).toHaveText(
    'Showing 3 upcoming events from Outlook.',
  )
  await expect(outlook.getByText('Your main calendar and Hiking club')).toBeVisible()
  expect(microsoft.calls.filter(c => c.url.pathname.endsWith('/authorize'))).toHaveLength(1)
  const link = await emulators.readDoc(account, 'meta/outlookCalendar')
  expect(link).toEqual({
    calendars: [
      { id: 'default', name: '' },
      { id: 'AAMkAGI2club=', name: 'Hiking club' },
    ],
    connectedAt: expect.any(String),
    syncedAt: expect.any(String),
  })
  // The hike's place came from Outlook, so it was named without a place search.
  await expect(
    section.getByRole('listitem', { name: 'Griffith hike' }).getByText('Griffith Observatory'),
  ).toBeVisible()

  // Deleted in Outlook, and a reload (which forgets nothing on the server) then Refresh:
  // the token is still in memory only until the page goes, so Refresh signs in again.
  microsoft.events.delete('picnic')
  await page.reload()
  await expect(outlook.getByText('Your main calendar and Hiking club')).toBeVisible()
  const again = page.waitForEvent('popup')
  await outlook.getByRole('button', { name: 'Refresh' }).click()
  await (await again).waitForEvent('close')
  await expect(page.getByTestId('outlook-calendar-status')).toHaveText(
    'Showing 2 upcoming events from Outlook.',
  )
  await expect
    .poll(async () =>
      Object.values(await emulators.readEvents(account))
        .map(e => e.title)
        .sort(),
    )
    .toEqual(['Griffith hike', 'Morning run'])
  expect(placeSearches.some(name => /Rainier|Teams|Venice/.test(name))).toBe(false)

  // Disconnect: the events and the choice go, and Microsoft's pages are offered.
  await outlook.getByRole('button', { name: 'Disconnect' }).click()
  await outlook.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByTestId('outlook-calendar-status')).toContainText(
    'Disconnected Outlook and removed its events.',
  )
  await expect(
    page.getByTestId('outlook-calendar-status').getByRole('link', { name: 'My Apps' }),
  ).toBeVisible()
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(0)
  expect(await emulators.readDoc(account, 'meta/outlookCalendar')).toBeNull()
  await expect(outlook.getByRole('button', { name: 'Show my Outlook events' })).toBeVisible()
  await expect(section.getByText('From Outlook')).toHaveCount(0)
  // Nothing but reads, and no request the page's policy refused.
  expect(
    microsoft.calls
      .filter(c => c.url.origin === 'https://graph.microsoft.com')
      .map(c => c.method)
      .every(method => method === 'GET'),
  ).toBe(true)
  expect(await violations()).toEqual([])
})

test('the redirect page carries no script but its own', async ({ page }) => {
  const response = await page.request.get('/auth/microsoft/?code=x&state=y')
  const html = await response.text()
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(m => m[1] ?? '')
  // The theme script and the hand-over script, both inline; nothing loaded from anywhere.
  expect(scripts.every(attributes => !/\bsrc=/.test(attributes))).toBe(true)
  expect(scripts).toHaveLength(2)
  expect(html).toContain('solara-microsoft-auth:')
  // No framework chunk either (scripts/static-pages.mjs), so no analytics or Firebase.
  expect(html).not.toMatch(/_next\/static\/chunks\//)
})

test('a cancelled sign-in is not an error, and an organization’s refusal says what to do', async ({
  page,
  emulators,
  microsoft,
}) => {
  const account = await emulators.createAccount('Ola Berg')
  await openDashboard(page, account)
  const outlook = outlookPanel(page)
  const show = outlook.getByRole('button', { name: 'Show my Outlook events' })

  microsoft.outcome = 'cancel'
  let popup = page.waitForEvent('popup')
  await show.click()
  await (await popup).waitForEvent('close')
  await expect(show).toBeEnabled()
  await expect(page.getByTestId('outlook-calendar-status')).toHaveCount(0)

  microsoft.outcome = 'admin'
  popup = page.waitForEvent('popup')
  await show.click()
  await (await popup).waitForEvent('close')
  await expect(page.getByTestId('outlook-calendar-status')).toHaveText(
    'Your organization needs to approve Solara before it can read your work calendar. Ask your IT team.',
  )
  expect(await emulators.readDoc(account, 'meta/outlookCalendar')).toBeNull()
  expect(microsoft.calls.filter(c => c.url.pathname.endsWith('/token'))).toHaveLength(0)
})

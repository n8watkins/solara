import type { Browser, Page } from '@playwright/test'
import { type Account, type Emulators, expect, openDashboard, preparePage, test } from './fixtures'
import { FakeGoogleCalendar } from './fake-google-calendar'

// The sunscreen timer's reminder with Solara closed (ROADMAP item 40): for a signed-in
// account, Start writes one "remind me at" record the rules accept and the server's
// trigger counts, which the push is sent from (functions/src/notifications/reminders.ts);
// a mode switch replaces it, and Stop deletes it, so no push comes. Before this, the
// timer lived only in the tab: nothing on the server knew a reminder was due.
//
// The rules check the record against the server's real time, so these pages run on the
// real clock instead of the suite's frozen June morning, in a time zone where it is late
// morning now (so the sun is up and the timer shows), with a forecast for that day.

const MINUTE = 60_000

/** Places whose local time covers every hour of the UTC day within a few hours. */
const PLACES = [
  { city: 'Honolulu', region: 'Hawaii', lat: 21.31, lon: -157.86, timezone: 'Pacific/Honolulu' },
  {
    city: 'Los Angeles',
    region: 'California',
    lat: 34.05,
    lon: -118.24,
    timezone: 'America/Los_Angeles',
  },
  { city: 'New York', region: 'New York', lat: 40.71, lon: -74.01, timezone: 'America/New_York' },
  {
    city: 'São Paulo',
    region: 'São Paulo',
    lat: -23.55,
    lon: -46.63,
    timezone: 'America/Sao_Paulo',
  },
  { city: 'London', region: 'England', lat: 51.51, lon: -0.13, timezone: 'Europe/London' },
  { city: 'Dubai', region: 'Dubai', lat: 25.2, lon: 55.27, timezone: 'Asia/Dubai' },
  { city: 'Mumbai', region: 'Maharashtra', lat: 19.08, lon: 72.88, timezone: 'Asia/Kolkata' },
  { city: 'Tokyo', region: 'Tokyo', lat: 35.68, lon: 139.69, timezone: 'Asia/Tokyo' },
  {
    city: 'Sydney',
    region: 'New South Wales',
    lat: -33.87,
    lon: 151.21,
    timezone: 'Australia/Sydney',
  },
  { city: 'Auckland', region: 'Auckland', lat: -36.85, lon: 174.76, timezone: 'Pacific/Auckland' },
]

function localClock(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')) + Number(part('minute')) / 60,
  }
}

/** A place where it is between 10am and 2:30pm now, with at least an hour of margin. */
function placeInDaylight(now: number) {
  const place = PLACES.find(p => {
    const { hour } = localClock(now, p.timezone)
    return hour >= 10 && hour < 14.5
  })
  if (!place) throw new Error('no fixture place is in late morning now')
  return place
}

/** UV through the day: up from 6am, a peak of 8 at 1pm, down by 8pm. */
function uvAt(hour: number): number {
  return hour <= 6 || hour >= 20
    ? 0
    : Math.round(8 * Math.sin((Math.PI * (hour - 6)) / 14) * 10) / 10
}

/** Open-Meteo's answer for the place: yesterday and the next 10 days in its own zone. */
function liveForecast(timeZone: string, now: number) {
  const today = localClock(now, timeZone).date
  const time: string[] = []
  const uv: number[] = []
  for (let offset = -1; offset < 10; offset++) {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)
    for (let hour = 0; hour < 24; hour++) {
      time.push(`${date}T${String(hour).padStart(2, '0')}:00`)
      uv.push(uvAt(hour))
    }
  }
  const hour = localClock(now, timeZone).hour
  return {
    timezone: timeZone,
    current: { uv_index: uvAt(hour), temperature_2m: 24, weathercode: 0 },
    hourly: {
      time,
      uv_index: uv,
      uv_index_clear_sky: uv,
      temperature_2m: uv.map(() => 24),
      weathercode: uv.map(() => 0),
      cloudcover: uv.map(() => 0),
    },
  }
}

/** A page on the real clock in `place`'s zone, with the suite's other stubs. */
async function livePage(browser: Browser, baseURL: string, place: (typeof PLACES)[number]) {
  const context = await browser.newContext({ baseURL, timezoneId: place.timezone })
  const page = await context.newPage()
  const blocked: string[] = []
  const now = Date.now()
  await preparePage(page, baseURL, blocked, new FakeGoogleCalendar(), undefined, {
    at: now,
    forecast: () => liveForecast(place.timezone, Date.now()),
  })
  return { page, blocked, close: () => context.close() }
}

async function signedInAccount(emulators: Emulators, name: string, place: (typeof PLACES)[number]) {
  const account = await emulators.createAccount(name)
  await emulators.seedPrefs(account, { location: place })
  return account
}

/** A notification device registered for the account, as registerNotificationDevice keeps it. */
async function seedDevice(emulators: Emulators, account: Account) {
  await emulators.seedDoc(account, `notificationDevices/${'a'.repeat(36)}`, {
    token: 'e2e-device-token',
    enabled: true,
    platform: 'web',
  })
}

function timer(page: Page) {
  return page.getByRole('region', { name: /Sunscreen timer|Reapply sunscreen|Time to reapply/ })
}

const millis = (value: unknown) => Date.parse(String(value))

test('a signed-in timer schedules its reminder as a push, and Stop cancels it', async ({
  browser,
  baseURL,
  emulators,
}) => {
  const place = placeInDaylight(Date.now())
  const account = await signedInAccount(emulators, 'Rae Lind', place)
  await seedDevice(emulators, account)
  const { page, blocked, close } = await livePage(browser, baseURL!, place)
  await openDashboard(page, account)

  // Before Start, nothing on the server knows a reminder is due.
  expect(await emulators.readDoc(account, 'reminders/reapply')).toBeNull()

  const startedAt = Date.now()
  await timer(page).getByRole('button', { name: 'Start' }).click()
  await expect(timer(page)).toContainText(
    'It also comes to your devices with alerts on, even with Solara closed.',
  )
  const record = await emulators.readDoc(account, 'reminders/reapply')
  expect(record).toMatchObject({ mode: 'standard', id: expect.stringMatching(/^[a-f0-9]{32}$/) })
  const remindAt = millis(record!.remindAt)
  expect(remindAt - millis(record!.appliedAt)).toBe(120 * MINUTE)
  expect(Math.abs(millis(record!.appliedAt) - startedAt)).toBeLessThan(MINUTE)
  expect(record!.dueAt).toBe(record!.remindAt)
  // The trigger counted it against the day's cap and handed it to Cloud Tasks.
  await expect
    .poll(async () => (await emulators.readDoc(account, 'alertState/reapply'))?.scheduled, {
      timeout: 20_000,
    })
    .toBe(1)
  // The browser keeps the push's tag, so the tab and the push show one notification.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('solara_reapply')!))
  expect(stored.reminderTag).toMatch(new RegExp(`:reapply-v1:${record!.id}$`))

  // Swimming: a new schedule 80 minutes after the application replaces the old one.
  await timer(page).getByRole('button', { name: 'Swimming or sweating' }).click()
  await expect
    .poll(async () => (await emulators.readDoc(account, 'reminders/reapply'))?.mode)
    .toBe('water')
  const water = await emulators.readDoc(account, 'reminders/reapply')
  expect(water!.id).not.toBe(record!.id)
  expect(millis(water!.remindAt) - millis(water!.appliedAt)).toBe(80 * MINUTE)

  // Stop: the record is gone, so no push comes.
  await timer(page).getByRole('button', { name: 'Stop' }).click()
  await expect(timer(page)).toContainText('Heading out?')
  await expect.poll(() => emulators.readDoc(account, 'reminders/reapply')).toBeNull()

  expect(blocked, 'requests that tried to leave the machine').toEqual([])
  await close()
})

test('without a device with alerts on, the timer says how to get it with Solara closed', async ({
  browser,
  baseURL,
  emulators,
}) => {
  const place = placeInDaylight(Date.now())
  const account = await signedInAccount(emulators, 'Sol Varga', place)
  const { page, blocked, close } = await livePage(browser, baseURL!, place)
  await openDashboard(page, account)

  await timer(page).getByRole('button', { name: 'Start' }).click()
  await expect(timer(page)).toContainText(
    'To get it with Solara closed, turn on alerts for this device.',
  )
  // Kept anyway: a device turned on later still gets it.
  await expect.poll(() => emulators.readDoc(account, 'reminders/reapply')).not.toBeNull()

  await timer(page).getByRole('button', { name: 'turn on alerts' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('tab', { name: 'Alerts' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    settings.getByRole('heading', { name: 'Daily UV and sunscreen reminders' }),
  ).toBeVisible()
  await expect(settings.getByRole('combobox', { name: 'Daily UV', exact: true })).toHaveValue('on')

  expect(blocked, 'requests that tried to leave the machine').toEqual([])
  await close()
})

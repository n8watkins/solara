import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// Imported events (components/events/): the Events section with sample events on Pro
// and Free, and an import from a picked .ics file with a place fixed by hand.
// Screenshots and axe reports go to test-results/ui-harness/ like the other specs.

/** Answers Open-Meteo: the fixture forecast for any place, and a place search. */
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

async function sectionShot(page: Page, testInfo: TestInfo, name: string) {
  const dir = join('test-results', 'ui-harness', 'screenshots')
  mkdirSync(dir, { recursive: true })
  // The sticky header would cover the top of a tall section scrolled into view.
  await page.addStyleTag({ content: '.sticky { position: static !important; }' })
  await page.getByTestId('events-section').screenshot({
    path: join(dir, `${name}--${testInfo.project.name}.png`),
    animations: 'disabled',
  })
}

const cards = (page: Page) => page.getByTestId('event-card')

test('sample events on Pro: UV, burn, sunscreen and the place fix', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&events=sample')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByRole('region', { name: 'Events' })
  await expect(cards(page)).toHaveCount(4)

  const run = section.getByRole('listitem', { name: 'Griffith Park trail run' })
  await expect(run.getByText('Today · 4pm – 5:30pm')).toBeVisible()
  await expect(run.getByText(/^Peak UV \d+\.\d at 4pm/)).toBeVisible()
  // Group planning on the Pro fixture is off: the account's own fair skin.
  await expect(run.getByText(/fair skin could burn in about \d+ min at the peak/)).toBeVisible()
  await expect(run.getByText(/Sunscreen: apply 3:30pm – 3:45pm/)).toBeVisible()
  await expect(run.getByRole('combobox', { name: 'Counts as' })).toHaveValue('run')
  await expect(run.getByRole('link', { name: /Event page/ })).toHaveAttribute('target', '_blank')

  const picnic = section.getByRole('listitem', { name: 'Balboa Park picnic' })
  await expect(picnic.getByText('San Diego, California')).toBeVisible()
  await expect(picnic.getByText(/^Peak UV/)).toBeVisible()

  const volleyball = section.getByRole('listitem', { name: 'Beach volleyball with the office' })
  await expect(volleyball.getByText('Using Los Angeles, California')).toBeVisible()
  await expect(
    volleyball.getByText('The event has no place, so this uses your place.'),
  ).toBeVisible()

  await captureScreen(page, testInfo, capture, { name: 'events-pro', fullPage: true })
  await sectionShot(page, testInfo, 'events-section-pro')
  if (!testInfo.project.name.startsWith('mobile')) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await sectionShot(page, testInfo, 'events-section-pro-1280')
  }

  // The place fix: search, pick, and the card moves there.
  await volleyball.getByRole('button', { name: 'Set the place' }).click()
  await volleyball
    .getByRole('combobox', { name: 'Place for Beach volleyball with the office' })
    .fill('San Diego')
  await page.getByRole('option', { name: /San Diego/ }).click()
  await expect(page.getByTestId('events-status')).toHaveText('Place set to San Diego.')
  await expect(volleyball.getByText('San Diego, California')).toBeVisible()
  await expect(volleyball.getByRole('button', { name: 'Set the place' })).toHaveCount(0)

  // Remove one.
  await volleyball.getByRole('button', { name: 'Remove Beach volleyball with the office' }).click()
  await expect(cards(page)).toHaveCount(3)
})

test('sample events on Free: a later event says when its forecast starts', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&events=sample&tier=free')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const race = page.getByRole('listitem', { name: 'Rose Bowl Half Marathon' })
  await expect(race.getByText('Forecast from Sat, Jun 20.')).toBeVisible()
  await expect(race.getByRole('button', { name: 'See it now with Pro' })).toBeVisible()
  await race.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-free', fullPage: false })
  await sectionShot(page, testInfo, 'events-section-free')
})

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:harness-import-1',
  'DTSTART;TZID=America/Los_Angeles:20260616T090000',
  'DTEND;TZID=America/Los_Angeles:20260616T103000',
  'SUMMARY:Mission Bay paddle',
  'LOCATION:Mission Bay\\, San Diego',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:harness-import-2',
  'DTSTART;VALUE=DATE:20260617',
  'SUMMARY:Holiday',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('import an .ics file', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByRole('region', { name: 'Events' })
  await expect(section.getByText(/No upcoming events yet/)).toBeVisible()

  // The file is parsed in a Web Worker (REVIEW4 M2), whose script loads.
  const parsedOffThread = page.waitForEvent('worker')
  const workerScript = page.waitForResponse(response =>
    /turbopack-worker[^/]*\.js/.test(response.url()),
  )
  await page.getByTestId('events-file').setInputFiles({
    name: 'events.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(ICS),
  })
  await expect(page.getByTestId('events-status')).toHaveText(
    'Imported 1 event. Skipped 1 all-day event.',
  )
  await parsedOffThread
  expect((await workerScript).ok()).toBe(true)
  const paddle = section.getByRole('listitem', { name: 'Mission Bay paddle' })
  await expect(paddle.getByText('San Diego, California')).toBeVisible()
  await expect(paddle.getByText('Tomorrow · 9am – 10:30am')).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'events-import', fullPage: true })

  // A file that is not a calendar is explained.
  await page.getByTestId('events-file').setInputFiles({
    name: 'page.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from('<html>Not found</html>'),
  })
  await expect(page.getByTestId('events-status')).toContainText('not a calendar')
})

test('an account at the cap says so, and "Remove all" clears every stored event', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&events=full')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByRole('region', { name: 'Events' })
  await expect(cards(page)).toHaveCount(4)
  await expect(section.getByTestId('events-cap')).toHaveText(
    'You have 1,000 imported events, the most an account can keep. Remove some to import more.',
  )
  await section.getByTestId('events-cap').scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'events-cap', fullPage: false })
  await sectionShot(page, testInfo, 'events-section-cap')
  if (!testInfo.project.name.startsWith('mobile')) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await sectionShot(page, testInfo, 'events-section-cap-1280')
  }

  // A new event does not fit; the summary says why.
  await page.getByTestId('events-file').setInputFiles({
    name: 'events.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(ICS),
  })
  await expect(page.getByTestId('events-status')).toHaveText(
    'No events were imported. 1 event did not fit. You have 1,000 imported events, the most an account can keep. Remove some to import more. Skipped 1 all-day event.',
  )

  await section.getByRole('button', { name: 'Remove all', exact: true }).click()
  await section.getByRole('button', { name: 'Remove all 1,000' }).click()
  await expect(page.getByTestId('events-status')).toHaveText('Removed every imported event.')
  await expect(cards(page)).toHaveCount(0)
  await expect(section.getByTestId('events-cap')).toHaveCount(0)
})

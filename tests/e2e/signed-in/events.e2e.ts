import { expect, openDashboard, RUNNING, startAsGuest, test, uvStrip } from './fixtures'
import type { Page } from './fixtures'

// Imported events end to end (docs/integrations/EVENTS.md, phase 1): the real app on the
// emulators (Auth, Firestore with the real rules), importing tests/e2e/signed-in/files/
// events.ics from the file picker. The clock is Monday 2026-06-15, 10:30 in Los Angeles.

const FILE = 'tests/e2e/signed-in/files/events.ics'

function eventsSection(page: Page) {
  return page.getByRole('region', { name: 'Events' })
}

async function importFile(page: Page) {
  await page.getByTestId('events-file').setInputFiles(FILE)
}

test('import an .ics file, fix a place, change an activity, remove and re-import', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ola Reyes')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  const section = eventsSection(page)
  await expect(section.getByText(/No upcoming events yet/)).toBeVisible()

  await importFile(page)
  await expect(page.getByTestId('events-status')).toHaveText(
    'Imported 6 events. Skipped 1 all-day event. 4 events had no place Solara could find; set it on the event.',
  )

  // Stored in Firestore, with only what the card needs, and an expiry.
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(6)
  const stored = Object.values(await emulators.readEvents(account))
  const race = stored.find(e => e.title === 'Tuesday 10K, Griffith Park')
  expect(race).toEqual({
    key: expect.stringMatching(/^[0-9a-f]{32}$/),
    source: 'file',
    seriesId: expect.stringMatching(/^[0-9a-f]{32}$/),
    title: 'Tuesday 10K, Griffith Park',
    start: '2026-06-16T16:00:00.000Z',
    end: '2026-06-16T17:30:00.000Z',
    timeZone: 'America/Los_Angeles',
    where: 'Griffith Park, 4730 Crystal Springs Dr, Los Angeles, CA 90027, USA',
    lat: 34.14,
    lon: -118.29,
    placeLabel: 'Griffith Park',
    placeGuessed: false,
    activityId: 'run',
    url: 'https://race.example/10k',
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    expireAt: '2026-07-16T17:30:00Z',
  })
  const picnic = stored.find(e => e.title === 'Picnic')
  expect(picnic).toMatchObject({ placeLabel: 'Los Angeles, California', placeGuessed: false })
  const rides = stored.filter(e => e.title === 'Club ride')
  expect(rides.map(r => r.start).sort()).toEqual([
    '2026-06-16T00:00:00.000Z',
    '2026-06-18T00:00:00.000Z',
    '2026-06-23T00:00:00.000Z',
    '2026-06-25T00:00:00.000Z',
  ])
  expect(rides.every(r => r.placeGuessed === true)).toBe(true)

  // The card: UV during the race tomorrow, burn and sunscreen.
  const raceCard = section.getByRole('listitem', { name: 'Tuesday 10K, Griffith Park' })
  await expect(raceCard.getByText('Tomorrow · 9am–10:30am')).toBeVisible()
  await expect(raceCard.getByText(/^Peak UV \d+\.\d at 10am · average/)).toBeVisible()
  await expect(raceCard.getByText(/fair skin could burn in about \d+ min/)).toBeVisible()
  await expect(raceCard.getByText(/^Sunscreen: apply 8:30am–8:45am/)).toBeVisible()
  // Free shows today and tomorrow; Wednesday's ride says when its forecast starts.
  await section.getByRole('button', { name: 'Show all 6 events' }).click()
  await expect(
    section
      .getByRole('listitem', { name: 'Club ride' })
      .nth(1)
      .getByText('Forecast from Tue, Jun 16.'),
  ).toBeVisible()

  // Every device sees them: a reload reads them back from Firestore.
  await page.reload()
  await expect(uvStrip(page)).toBeVisible()
  await expect(section.getByRole('listitem', { name: 'Picnic' })).toBeVisible()

  // Set the place of the ride once; it applies to every occurrence.
  const ride = section.getByRole('listitem', { name: 'Club ride' }).first()
  await ride.getByRole('button', { name: 'Set the place' }).click()
  await ride.getByRole('combobox', { name: 'Place for Club ride' }).fill('Los Angeles')
  await page.getByRole('option', { name: /Los Angeles/ }).click()
  await expect(page.getByTestId('events-status')).toHaveText(
    'Place set to Los Angeles for 4 events.',
  )
  await expect
    .poll(async () =>
      Object.values(await emulators.readEvents(account))
        .filter(e => e.title === 'Club ride')
        .every(e => e.placeGuessed === false),
    )
    .toBe(true)

  // Count the picnic as a run.
  await section
    .getByRole('listitem', { name: 'Picnic' })
    .getByRole('combobox', { name: 'Counts as' })
    .selectOption('run')
  await expect
    .poll(async () =>
      Object.values(await emulators.readEvents(account)).find(e => e.title === 'Picnic'),
    )
    .toMatchObject({ activityId: 'run' })

  // Remove the race.
  await raceCard.getByRole('button', { name: 'Remove Tuesday 10K, Griffith Park' }).click()
  await expect(page.getByTestId('events-status')).toHaveText('Removed Tuesday 10K, Griffith Park.')
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(5)

  // Importing the same file again updates instead of adding copies, and keeps the
  // place and activity the person chose.
  await importFile(page)
  await expect(page.getByTestId('events-status')).toHaveText(
    'Imported 6 events. Skipped 1 all-day event.',
  )
  const again = Object.values(await emulators.readEvents(account))
  expect(again).toHaveLength(6)
  expect(again.find(e => e.title === 'Picnic')).toMatchObject({ activityId: 'run' })
  expect(again.filter(e => e.title === 'Club ride').every(e => !e.placeGuessed)).toBe(true)
})

test('a guest is not offered event import', async ({ page }) => {
  await startAsGuest(page)
  await expect(uvStrip(page)).toBeVisible()
  await expect(eventsSection(page)).toHaveCount(0)
})

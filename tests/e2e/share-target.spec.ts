import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'
import { INVITE, share, sharedCard } from './share-sheet'

// Sharing to the installed app (public/manifest.webmanifest's share_target): Android's
// share sheet POSTs the file or link to /app/share-target/ as multipart form data. The
// app-shell service worker (scripts/sw/shell.ts) must answer that POST, since Hosting
// only serves static files. These tests make the same POST from a form, against the
// export served by the Hosting emulator with firebase.json's headers, with the worker on.
test.use({ serviceWorkers: 'allow' })

const GUEST_PLAN = {
  prefs: {
    location: {
      lat: 34.05,
      lon: -118.24,
      city: 'Los Angeles',
      region: 'California',
      timezone: 'America/Los_Angeles',
    },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
}

test.beforeEach(async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await startClock(page)
  await page.addInitScript(plan => {
    if (!localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', plan)
  }, JSON.stringify(GUEST_PLAN))
})

/** Opens the app and waits until the shell worker controls it, as in an installed app. */
async function openInstalledApp(page: Page) {
  await page.goto('/app/')
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

test('a shared .ics file opens the app with its events, and a guest is asked to sign in', async ({
  page,
}) => {
  await openInstalledApp(page)
  await share(page, { file: { name: 'invite.ics', type: 'text/calendar', text: INVITE } })
  await page.waitForURL(/\/app\/\?shared=[a-z0-9]+$/)
  const card = sharedCard(page)
  await expect(card).toBeVisible()
  await expect(card).toContainText('invite.ics has 2 upcoming events')
  await expect(card.getByRole('listitem')).toHaveText([
    'Tuesday 10K Tomorrow · 9am – 10:30am',
    'Picnic Wed, Jun 17 · 12pm – 1:30pm',
  ])
  await expect(card).toContainText('Sign in to keep them')
})

test('"Not now" removes the shared file, and its address then says there is nothing to import', async ({
  page,
}) => {
  await openInstalledApp(page)
  await share(page, { file: { name: 'invite.ics', type: 'text/calendar', text: INVITE } })
  await page.waitForURL(/\?shared=/)
  const sharedUrl = page.url()
  const card = sharedCard(page)
  await expect(card).toContainText('invite.ics has 2 upcoming events')
  await card.getByRole('button', { name: 'Not now' }).click()
  await expect(card).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/$/)
  expect(await page.evaluate(() => caches.has('solara-share-v1'))).toBe(false)

  await page.goto(sharedUrl)
  await expect(sharedCard(page)).toContainText('Nothing to import')
})

test('files that are too large or not calendars are refused before they are kept', async ({
  page,
}) => {
  await openInstalledApp(page)
  await share(page, {
    file: { name: 'season.ics', type: 'text/calendar', bytes: 2 * 1024 * 1024 },
  })
  await page.waitForURL(/\?shared=/)
  await expect(sharedCard(page).getByRole('alert')).toHaveText(
    'That file is larger than 1 MB. Export a shorter range of events, then share it again.',
  )
  // Nothing of the file was kept, only why it was refused.
  const kept = await page.evaluate(async () => {
    const response = await (await caches.open('solara-share-v1')).match('/app/share-target/item')
    return response ? (await response.blob()).size : null
  })
  expect(kept).toBe(0)

  await share(page, { file: { name: 'photo.html', type: 'text/html', text: '<script>1</script>' } })
  await page.waitForURL(/\?shared=/)
  await expect(sharedCard(page).getByRole('alert')).toContainText(
    'Solara can import calendar (.ics) files only.',
  )
})

test('a shared web page link explains how to get a calendar file', async ({ page }) => {
  await openInstalledApp(page)
  await share(page, {
    fields: {
      title: 'Saturday hike',
      text: 'Join us! https://www.meetup.com/la-hikers/events/123456/',
    },
  })
  await page.waitForURL(/\?shared=/)
  await expect(sharedCard(page)).toContainText(
    'That is a link to a web page (www.meetup.com), not a calendar.',
  )
})

test('sharing works offline: the worker keeps the file, and the app shows it once online', async ({
  page,
  context,
}) => {
  await openInstalledApp(page)
  await context.setOffline(true)
  await share(page, { file: { name: 'invite.ics', type: 'text/calendar', text: INVITE } })
  await page.waitForURL(/\?shared=/)
  // The cached app opens; the card's code was never fetched, so it waits for the network.
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await context.setOffline(false)
  await expect(sharedCard(page)).toContainText('invite.ics has 2 upcoming events')
})

test('a share posted from another website keeps nothing and just opens the app', async ({
  page,
  baseURL,
}) => {
  await openInstalledApp(page)
  // Another site's page with a form that posts a file to Solara's share address.
  await page.route('http://other.example/', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Other</title>' }),
  )
  await page.goto('http://other.example/')
  await page.evaluate(
    ({ action, text }) => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.enctype = 'multipart/form-data'
      form.action = action
      const input = document.createElement('input')
      input.type = 'file'
      input.name = 'calendar'
      const transfer = new DataTransfer()
      transfer.items.add(new File([text], 'invite.ics', { type: 'text/calendar' }))
      input.files = transfer.files
      form.append(input)
      document.body.append(form)
      form.submit()
    },
    { action: `${baseURL}/app/share-target/`, text: INVITE },
  )
  await page.waitForURL(/\/app\/$/)
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await expect(sharedCard(page)).toHaveCount(0)
  expect(await page.evaluate(() => caches.has('solara-share-v1'))).toBe(false)
})

test.describe('before the worker runs', () => {
  test.use({ serviceWorkers: 'block' })

  test('Hosting answers the share with a page asking to share again', async ({ page }) => {
    await page.goto('/app/')
    await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
    await share(page, { file: { name: 'invite.ics', type: 'text/calendar', text: INVITE } })
    await page.waitForURL(/\/app\/share-target\/$/)
    await expect(page.getByRole('heading', { name: 'Share it again' })).toBeVisible()
    await page.getByRole('link', { name: 'Open Solara' }).click()
    await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  })
})

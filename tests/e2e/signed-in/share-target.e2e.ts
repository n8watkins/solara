import { INVITE, share, sharedCard } from '../share-sheet'
import {
  completeGoogleSignIn,
  expect,
  openDashboard,
  startAsGuest,
  test,
  uvStrip,
} from './fixtures'
import type { Page } from './fixtures'

// Sharing a calendar file or link to the installed app (lib/share-target.ts) end to end:
// the export's app-shell service worker takes the share sheet's POST, and the real app on
// the emulators (Auth, Firestore with the real rules, the Functions) imports it after the
// person confirms. The suite blocks service workers elsewhere (playwright.config.ts).
test.use({ serviceWorkers: 'allow' })

/** Waits until the shell worker controls the page, as in an installed app. */
async function installed(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

function shareInvite(page: Page) {
  return share(page, { file: { name: 'invite.ics', type: 'text/calendar', text: INVITE } })
}

test('a signed-in account previews a shared .ics file, imports it and the share is removed', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ola Reyes')
  await emulators.seedPrefs(account)
  await openDashboard(page, account)
  await installed(page)

  await shareInvite(page)
  await page.waitForURL(/\/app\/\?shared=[0-9a-f]{16}$/)
  const card = sharedCard(page)
  await expect(card).toContainText('invite.ics has 2 upcoming events.')
  await expect(card.getByRole('listitem')).toHaveText([
    'Tuesday 10K Tomorrow · 9am–10:30am',
    'Picnic Wed, Jun 17 · 12pm–1:30pm',
  ])
  // Nothing is stored before the person confirms.
  expect(Object.keys(await emulators.readEvents(account))).toHaveLength(0)

  await card.getByRole('button', { name: 'Import 2 events' }).click()
  await expect(card.getByRole('status')).toHaveText(/^Imported 2 events\./)
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(2)
  const stored = Object.values(await emulators.readEvents(account))
  expect(stored.map(event => event.title).sort()).toEqual(['Picnic', 'Tuesday 10K'])
  expect(stored.every(event => event.source === 'file')).toBe(true)
  // The share is gone from the browser and the address.
  await expect(page).toHaveURL(/\/app\/$/)
  expect(await page.evaluate(() => caches.has('solara-share-v1'))).toBe(false)

  await card.getByRole('button', { name: 'Done' }).click()
  await expect(card).toHaveCount(0)
  const events = page.getByRole('region', { name: 'Events' })
  await expect(events.getByRole('listitem', { name: 'Tuesday 10K' })).toBeVisible()
})

test('a guest shares a file, signs in from the card, and the import continues', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Sam Lee')
  await startAsGuest(page)
  await installed(page)

  await shareInvite(page)
  await page.waitForURL(/\?shared=/)
  const card = sharedCard(page)
  await expect(card).toContainText('invite.ics has 2 upcoming events.')
  await expect(card).toContainText(
    'Sign in to keep them: Solara keeps events with your account. The file waits here for 30 minutes.',
  )
  await expect(card.getByRole('button', { name: /Import/ })).toHaveCount(0)

  await completeGoogleSignIn(page, account, () =>
    card.getByRole('button', { name: 'Sign in with Google' }).click(),
  )
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await expect(uvStrip(page)).toBeVisible()
  // The file waited through the sign-in.
  await expect(sharedCard(page)).toContainText('invite.ics has 2 upcoming events.')
  await sharedCard(page).getByRole('button', { name: 'Import 2 events' }).click()
  await expect(sharedCard(page).getByRole('status')).toHaveText(/^Imported 2 events\./)
  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(2)
})

test('a shared calendar link opens the linked calendars form, prefilled, on Pro', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ola Reyes')
  await emulators.seedPrefs(account, { tier: 'paid' })
  await openDashboard(page, account)
  await installed(page)

  const link = 'webcal://club.example/races.ics'
  await share(page, { fields: { title: 'Club races', text: `Our races: ${link}` } })
  await page.waitForURL(/\?shared=/)
  const card = sharedCard(page)
  await expect(card).toContainText('A calendar link from club.example.')
  await card.getByRole('button', { name: 'Add this calendar' }).click()

  const panel = page.getByTestId('event-subscriptions')
  const field = panel.getByRole('textbox', { name: 'Calendar link' })
  await expect(field).toHaveValue(link)
  await expect(field).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Add a calendar from…' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(card).toContainText('is in Linked calendars below')
  expect(await page.evaluate(() => caches.has('solara-share-v1'))).toBe(false)
})

test('on Free, a shared calendar link offers Pro instead', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Ola Reyes')
  await emulators.seedPrefs(account)
  await openDashboard(page, account)
  await installed(page)

  await share(page, { fields: { url: 'https://club.example/races.ics' } })
  await page.waitForURL(/\?shared=/)
  const card = sharedCard(page)
  await expect(card).toContainText(
    "A calendar link from club.example. Linked calendars, which keep a calendar's events current, are part of Pro.",
  )
  await card.getByRole('button', { name: 'See Pro' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('event-subscriptions').getByRole('textbox')).toHaveCount(0)
})

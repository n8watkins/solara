import { readFile } from 'node:fs/promises'
import { EXPORT_METADATA_FIELDS, EXPORT_SECTIONS } from '../../../lib/account-data'
import { accountMenu, completeGoogleSignIn, expect, openDashboard, RUNNING, test } from './fixtures'
import type { Account, Emulators, Page } from './fixtures'

// Account download and deletion without Cloud Functions (the free Spark plan, ROADMAP
// item 33): the account page does both in the browser, against the emulators' Auth and
// Firestore with the real rules. This build has Functions, so each test takes the path a
// build without them takes, with the emulator-only switch that accountControlsPath
// (lib/account-data.ts) reads. account-data.e2e.ts covers the Functions path.
//
// The clock is Monday 2026-06-15, 10:30 in Los Angeles.

const ICS = 'tests/e2e/signed-in/files/events.ics'
const LEGACY_KEY = 'f'.repeat(32)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('solara-firebase-emulators.functions-off', '1')
  })
})

/** Solara's entries in localStorage, other than the device settings that stay. */
function accountKeys(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage).filter(
      key =>
        key.startsWith('solara_') && !['solara_theme', 'solara_install_dismissed'].includes(key),
    ),
  )
}

async function openAccountPage(page: Page) {
  await page.getByRole('contentinfo').getByRole('link', { name: 'Account data' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Account controls' })).toBeVisible()
}

/** Settings, imported events and a scheduled activity, made in the app as a person would. */
async function accountWithData(page: Page, emulators: Emulators): Promise<Account> {
  const account = await emulators.createAccount('Sam Okafor')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  // An event stored before the key lists existed, which no list names.
  await emulators.seedEvents(account, [
    {
      key: LEGACY_KEY,
      source: 'file',
      seriesId: LEGACY_KEY,
      title: 'Old import',
      start: '2026-06-20T15:00:00.000Z',
      end: '2026-06-20T16:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      where: '',
      lat: 34.05,
      lon: -118.24,
      placeLabel: 'Los Angeles, California',
      placeGuessed: false,
      activityId: '',
      url: '',
      createdAt: '2026-06-01T17:00:00.000Z',
      updatedAt: '2026-06-01T17:00:00.000Z',
    },
  ])
  await openDashboard(page, account)

  // A setting, saved through the rules.
  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings
    .getByRole('combobox', { name: 'Skin type' })
    .selectOption({ label: 'Medium (Type III)' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toBeHidden()
  await expect.poll(async () => (await emulators.readPrefs(account))?.skinType).toBe('medium')

  // Imported events, from the file picker.
  await page.getByTestId('events-file').setInputFiles(ICS)
  await expect(page.getByTestId('events-status')).toContainText('Imported 6 events.')

  // A scheduled activity, added to (the fake) Google Calendar.
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Running, Today, 6pm–8pm, peak UV 3.1' }).click()
  await page
    .getByRole('dialog', { name: 'Running' })
    .getByRole('button', { name: /Add to Google Calendar/ })
    .click()
  await expect(main.getByRole('button', { name: /^Scheduled: Running, Today/ })).toBeVisible()

  await expect.poll(async () => Object.keys(await emulators.readEvents(account)).length).toBe(7)
  await expect.poll(async () => Object.keys(await emulators.readScheduled(account)).length).toBe(1)
  expect(await emulators.readDoc(account, 'meta/events')).not.toBeNull()
  expect(await emulators.readDoc(account, 'meta/scheduled')).not.toBeNull()
  return account
}

test('without Functions, download the data and delete the account from the browser', async ({
  page,
  emulators,
}) => {
  const account = await accountWithData(page, emulators)
  await openAccountPage(page)

  // Plain words, a way out by email, and no developer notice.
  await expect(page.getByText(/Cloud Functions|App Check/)).toHaveCount(0)
  await expect(
    page.getByText(/^Something not working\? Email contact@n8builds\.dev and we will send/),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'contact@n8builds.dev' })).toHaveAttribute(
    'href',
    'mailto:contact@n8builds.dev',
  )

  // Download: the same file the Function makes.
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download account data' }).click()
  const download = await downloaded
  await expect(page.getByRole('status')).toHaveText('Your account data was downloaded.')
  expect(download.suggestedFilename()).toBe('solara-account-2026-06-15.json')
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as Record<
    string,
    unknown
  > & {
    account: Record<string, unknown>
    importedEvents: { key: string; title: string }[]
    scheduledActivities: { activityId: string }[]
  }
  expect(Object.keys(exported).sort()).toEqual(
    [...Object.keys(EXPORT_SECTIONS), ...EXPORT_METADATA_FIELDS].sort(),
  )
  expect(exported).toMatchObject({ formatVersion: 1, truncated: [], alerts: [] })
  expect(exported.account).toMatchObject({
    uid: account.uid,
    tier: 'free',
    skinType: 'medium',
    activities: [{ id: 'run', name: 'Running' }],
  })
  expect(exported.importedEvents).toHaveLength(7)
  expect(exported.importedEvents.map(e => e.title)).toContain('Tuesday 10K, Griffith Park')
  expect(exported.importedEvents.map(e => e.key)).toContain(LEGACY_KEY)
  expect(exported.scheduledActivities).toEqual([expect.objectContaining({ activityId: 'run' })])
  expect(await accountKeys(page)).toEqual(
    expect.arrayContaining(['solara_account_owner', 'solara_forecast']),
  )

  // Delete: the confirmation, then Google confirms the account again in a popup.
  const deleteButton = page.getByRole('button', { name: 'Delete permanently' })
  await expect(deleteButton).toBeDisabled()
  await expect(
    page.getByText('Google then asks you to sign in again, to confirm it is you.'),
  ).toBeVisible()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await completeGoogleSignIn(page, account, () => deleteButton.click())

  await expect(page).toHaveURL(/\/account\/\?deletion=done$/)
  await expect(page.getByRole('heading', { name: 'Your account was deleted' })).toBeVisible()
  expect(await accountKeys(page)).toEqual([])

  // Nothing is left in Firestore or Auth.
  expect(await emulators.remainingAccountDocs(account)).toEqual([])
  expect(await emulators.authUserExists(account)).toBe(false)
  // With nothing of the account left, the landing page shows again instead of the app.
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
})

test('a deletion Google did not confirm deletes nothing', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Ana Ruiz')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  await openAccountPage(page)

  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  const popupOpened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await (await popupOpened).close()

  // Auth notices a closed popup only after it has waited for a late answer (about 10 s).
  await expect(page.getByRole('status')).toHaveText(
    'Deletion was canceled because Google did not confirm your account. Nothing was deleted.',
    { timeout: 20_000 },
  )
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeEnabled()
  expect(await emulators.readPrefs(account)).not.toBeNull()
  expect(await emulators.authUserExists(account)).toBe(true)
})

test('an account with billing is sent to email, and can still download', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Kai Brandt')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  // As the Stripe webhook would leave it; only the deleteAccount Function may end it.
  await emulators.setTier(account, 'paid')
  await openAccountPage(page)

  const section = page.getByRole('region', { name: 'Delete account' })
  await expect(section).toContainText(
    "Part of this account can only be removed by Solara's servers, which are not running yet. To delete it, email contact@n8builds.dev and we will delete your account and all its data within 30 days.",
  )
  await expect(section.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0)

  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download account data' }).click()
  const exported = JSON.parse(await readFile(await (await downloaded).path(), 'utf8')) as {
    billing: { plan: string }
  }
  expect(exported.billing.plan).toBe('pro')
  expect(await emulators.readPrefs(account)).not.toBeNull()
})

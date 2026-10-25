import { readFile } from 'node:fs/promises'
import {
  completeGoogleSignIn,
  expect,
  FUNCTIONS_PATH,
  openDashboard,
  RUNNING,
  test,
} from './fixtures'

test('downloads a copy of the account data', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Lee Archer')
  await emulators.seedPrefs(account, { tier: 'paid', activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('contentinfo').getByRole('link', { name: 'Account data' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Account controls' })).toBeVisible()

  // Served by the exportAccountData Function, called with the user's ID token and an
  // App Check token.
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download account data' }).click()
  const download = await downloaded
  await expect(page.getByRole('status')).toHaveText('Your account data was downloaded.')

  expect(download.suggestedFilename()).toBe('solara-account-2026-06-15.json')
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    formatVersion: number
    account: Record<string, unknown>
    notificationDevices: unknown[]
  }
  expect(exported.formatVersion).toBe(1)
  expect(exported.account).toMatchObject({
    uid: account.uid,
    tier: 'paid',
    location: { city: 'Los Angeles' },
    activities: [{ id: 'run', name: 'Running' }],
  })
  expect(exported.notificationDevices).toEqual([])
})

test('deleting the account leaves none of its data in the browser and confirms it', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Noor Vale')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)
  // Device settings (theme, tip rotation, dismissed install prompt) belong to the browser,
  // not the account, so they may stay.
  const solaraKeys = () =>
    page.evaluate(
      deviceKeys =>
        Object.keys(localStorage).filter(
          key => key.startsWith('solara_') && !deviceKeys.includes(key),
        ),
      ['solara_theme', 'solara_tip', 'solara_install_dismissed'],
    )
  // The account's marker and its places' forecast are kept while it is signed in.
  expect(await solaraKeys()).toEqual(
    expect.arrayContaining(['solara_account_owner', 'solara_forecast']),
  )

  await page.getByRole('contentinfo').getByRole('link', { name: 'Account data' }).click()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  // Deletion asks Google to confirm the account again, in a popup.
  await completeGoogleSignIn(page, account, () =>
    page.getByRole('button', { name: 'Delete permanently' }).click(),
  )

  await expect(page).toHaveURL(/\/account\/\?deletion=(pending|done)$/)
  expect(await solaraKeys()).toEqual([])
  await expect(
    page.getByRole('heading', { name: /^Your account (was deleted|deletion is in progress)/ }),
  ).toBeVisible()
  // With nothing of the account left, the landing page shows again instead of the app.
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
})

test('account Functions still refuse callers without App Check', async ({ request }) => {
  const response = await request.get(`${FUNCTIONS_PATH}/exportAccountData`)
  expect(response.status()).toBe(401)
  expect(await response.json()).toMatchObject({ code: 'app-check-required' })
})

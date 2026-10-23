import { readFile } from 'node:fs/promises'
import { expect, FUNCTIONS_PATH, openDashboard, RUNNING, test } from './fixtures'

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

test('account Functions still refuse callers without App Check', async ({ request }) => {
  const response = await request.get(`${FUNCTIONS_PATH}/exportAccountData`)
  expect(response.status()).toBe(401)
  expect(await response.json()).toMatchObject({ code: 'app-check-required' })
})

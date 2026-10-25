import { accountMenu, expect, openDashboard, test } from './fixtures'

test('saves settings to the account and restores them on reload', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Eve Moss')
  await emulators.seedPrefs(account)
  await openDashboard(page, account)
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Skin type' }).selectOption({ label: 'Medium' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toBeHidden()

  await expect(page.getByText('Now · medium skin, no SPF')).toBeVisible()
  await expect.poll(async () => (await emulators.readPrefs(account))?.skinType).toBe('medium')

  await page.reload()
  await expect(page.getByText('Now · medium skin, no SPF')).toBeVisible()
  await accountMenu(page, 'Settings')
  await expect(settings.getByRole('combobox', { name: 'Skin type' })).toHaveValue('medium')
})

test('a full browser storage never stops a settings change from reaching the account', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ida Lowe')
  await emulators.seedPrefs(account)
  await openDashboard(page, account)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Storage is full (or blocked): every write throws, as browsers do over quota.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
  })

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Skin type' }).selectOption({ label: 'Medium' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toBeHidden()

  await expect(page.getByText('Now · medium skin, no SPF')).toBeVisible()
  await expect.poll(async () => (await emulators.readPrefs(account))?.skinType).toBe('medium')
  expect(errors).toEqual([])
})

test('discarding unsaved settings leaves the account alone', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Fin Ross')
  await emulators.seedPrefs(account)
  await openDashboard(page, account)

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Skin type' }).selectOption({ label: 'Dark' })
  // With unsaved changes, Cancel becomes Discard and asks first.
  page.once('dialog', confirm => {
    expect(confirm.message()).toBe('Discard unsaved settings changes?')
    void confirm.accept()
  })
  await settings.getByRole('button', { name: 'Discard' }).click()
  await expect(settings).toBeHidden()

  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()
  expect((await emulators.readPrefs(account))?.skinType).toBe('fair')
})

test('removing the last family profile stays removed after a reload', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Gia Patel')
  await emulators.seedPrefs(account, {
    tier: 'paid',
    profiles: [{ id: 'maya', name: 'Maya', skinType: 'very-fair', icon: '🧒' }],
    activeProfileId: 'maya',
  })
  await openDashboard(page, account)

  const switcher = page.getByRole('banner').getByRole('button', { name: 'Profile: Maya' })
  await switcher.click()
  await page.getByRole('button', { name: 'Edit Maya' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Profile: Me' })).toBeVisible()
  await expect.poll(async () => (await emulators.readPrefs(account))?.profiles).toEqual([])

  // Regression (W2-A): the removed profile used to come back on the next load.
  await page.reload()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Profile: Me' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Profile: Maya' })).toHaveCount(
    0,
  )
})

test('settings still save after the server changes the plan in an open tab', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Hugo Lane')
  await emulators.seedPrefs(account, { tier: 'free' })
  await openDashboard(page, account)
  await expect(page.getByRole('banner').getByText('Pro', { exact: true })).toHaveCount(0)

  // The Stripe webhook upgrades the account while this tab still holds the old plan.
  await emulators.setTier(account, 'paid')

  // Regression (W2-A): every later save used to fail the rules with permission-denied.
  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Skin type' }).selectOption({ label: 'Medium' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toBeHidden()
  await expect(page.getByText('Now · medium skin, no SPF')).toBeVisible()
  await expect(page.getByText(/cloud sync failed/)).toHaveCount(0)
  await expect
    .poll(() => emulators.readPrefs(account))
    .toMatchObject({ skinType: 'medium', tier: 'paid' })

  // After a reload the saved setting and the server's plan both show.
  await page.reload()
  await expect(page.getByText('Now · medium skin, no SPF')).toBeVisible()
  await expect(page.getByRole('banner').getByText('Pro', { exact: true })).toBeVisible()
})

test('a document from a newer Solara is never overwritten by this one', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ivy Nakamura')
  await emulators.seedPrefs(account, {
    newerClient: { schemaVersion: 99, fields: { futureSetting: 'kept' } },
  })
  const stored = await emulators.readPrefs(account)
  await openDashboard(page, account)

  // The newer document is read best-effort.
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Skin type' }).selectOption({ label: 'Medium' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toBeHidden()

  const notice = page.getByRole('alert').filter({ hasText: 'updated in another tab' })
  await expect(notice).toHaveText(
    /Solara was updated in another tab or device\. Reload to keep editing your settings\./,
  )
  await expect(notice.getByRole('button', { name: 'Reload' })).toBeVisible()
  // Nothing was written: the document is exactly what the newer client saved.
  expect(await emulators.readPrefs(account)).toEqual(stored)

  await notice.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()
  await expect(notice).toHaveCount(0)
  expect(await emulators.readPrefs(account)).toEqual(stored)
})

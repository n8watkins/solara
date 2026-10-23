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

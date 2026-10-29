import { expect, openDashboard, RUNNING, test } from './fixtures'
import type { Account, Emulators } from './fixtures'

/** The saved activities' names, as stored in the account. */
async function savedActivities(emulators: Emulators, account: Account) {
  const prefs = await emulators.readPrefs(account)
  return ((prefs?.activities as { name: string }[] | undefined) ?? []).map(a => a.name)
}

test('adds a preset activity and keeps it across reloads', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Ari Gold')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: '+ Add Activity' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add activity' })
  await dialog.getByRole('button', { name: /^Hiking 2h/ }).click()
  await expect(dialog.getByRole('button', { name: /^Hiking 2h/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
  await expect.poll(() => savedActivities(emulators, account)).toEqual(['Running', 'Hiking'])

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
})

test('edits an activity and keeps the changes', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Bo Chen')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: 'Edit Running' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit activity' })
  await dialog.getByRole('textbox', { name: 'Activity name' }).fill('Morning run')
  await dialog.getByRole('button', { name: '+15 min' }).click()
  await expect(dialog.getByRole('spinbutton', { name: 'Duration' })).toHaveValue('60')
  await dialog.getByRole('button', { name: 'SPF 30+' }).click()
  // Rain and heat (weather-fit.ts): stored only when they differ from Running's defaults.
  await dialog.getByRole('combobox', { name: 'Rain', exact: true }).selectOption('ok')
  await dialog.getByRole('combobox', { name: 'Max feels-like' }).selectOption({ label: '95°F' })
  await dialog.getByRole('button', { name: 'Save activity' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole('button', { name: 'Edit Morning run' })).toBeVisible()
  await expect
    .poll(async () => (await emulators.readPrefs(account))?.activities)
    .toEqual([
      expect.objectContaining({
        id: 'run',
        name: 'Morning run',
        durationMins: 60,
        sunscreen: true,
        avoidRain: false,
        maxFeelsLikeC: 35,
      }),
    ])

  await page.reload()
  await page.getByRole('button', { name: 'Edit Morning run' }).click()
  await expect(dialog.getByRole('spinbutton', { name: 'Duration' })).toHaveValue('60')
  await expect(dialog.getByRole('button', { name: 'SPF 30+' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(dialog.getByRole('combobox', { name: 'Rain', exact: true })).toHaveValue('ok')
  await expect(
    dialog.getByRole('combobox', { name: 'Max feels-like' }).locator('option:checked'),
  ).toHaveText('95°F')
})

test('deletes an activity after confirming', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Cy Diaz')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: 'Edit Running' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit activity' })

  // Dismissing the confirmation keeps the activity.
  page.once('dialog', confirm => void confirm.dismiss())
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toBeVisible()

  page.once('dialog', confirm => {
    expect(confirm.message()).toBe('Remove Running?')
    void confirm.accept()
  })
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByText('No activities set up yet')).toBeVisible()
  await expect.poll(() => savedActivities(emulators, account)).toEqual([])

  await page.reload()
  await expect(page.getByText('No activities set up yet')).toBeVisible()
})

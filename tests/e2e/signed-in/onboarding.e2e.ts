import { expect, RUNNING, signIn, test, uvStrip } from './fixtures'

test('a new account is created from the setup answers', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Sam Okafor')

  await signIn(page, account, { skinType: 'Olive' })

  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByText('No activities set up yet')).toBeVisible()
  await expect(page.getByText('Now · olive skin, no SPF')).toBeVisible()
  await expect
    .poll(() => emulators.readPrefs(account))
    .toMatchObject({
      uid: account.uid,
      tier: 'free',
      skinType: 'olive',
      onboardingComplete: true,
      activities: [],
      location: { city: 'Los Angeles', region: 'California' },
    })

  // The account is the source of truth from now on.
  await page.reload()
  await expect(page.getByText('Now · olive skin, no SPF')).toBeVisible()
})

test('a returning account signing in from setup sees its saved plan', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Rae Lin')
  await emulators.seedPrefs(account, { activities: [RUNNING] })

  // Setup answers that differ from the saved profile (fair skin).
  await signIn(page, account, { skinType: 'Olive' })

  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()
  expect(await emulators.readPrefs(account)).toMatchObject({ skinType: 'fair' })
})

test('a returning account that edits right after signing in from setup keeps its plan', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Ola Berg')
  await emulators.seedPrefs(account, { activities: [RUNNING] })

  await signIn(page, account, { skinType: 'Olive' })
  await expect(uvStrip(page)).toBeVisible()

  // Add an activity straight away, with no page load in between. (Before the fix the
  // dashboard showed the empty setup plan here, which has a second add button.)
  await page.getByRole('button', { name: '+ Add Activity' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add activity' })
  await dialog.getByRole('button', { name: /^Hiking 2h/ }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()

  await expect
    .poll(async () => (await emulators.readPrefs(account))?.activities)
    .toEqual([
      expect.objectContaining({ id: 'run', name: 'Running' }),
      expect.objectContaining({ name: 'Hiking' }),
    ])
  // The setup answers never replace the saved profile.
  expect(await emulators.readPrefs(account)).toMatchObject({ skinType: 'fair', tier: 'free' })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
})

test('a returning Pro account signing in from setup keeps its plan tier', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Pia Ross')
  await emulators.seedPrefs(account, { tier: 'paid', activities: [RUNNING] })

  await signIn(page, account)

  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByRole('banner').getByText('Pro', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Go Pro/ })).toHaveCount(0)
  await expect.poll(() => emulators.readPrefs(account)).toMatchObject({ tier: 'paid' })
})

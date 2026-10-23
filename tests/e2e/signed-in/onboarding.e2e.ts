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
  test.fail(
    true,
    'Known bug: after signing in from setup, the dashboard shows the setup answers ' +
      '(no activities) until the next page load, because Onboarding hands its answers ' +
      "to App after App loaded the saved account. The account's data in Firestore is " +
      'intact. Remove this line once fixed.',
  )
  const account = await emulators.createAccount('Rae Lin')
  await emulators.seedPrefs(account, { activities: [RUNNING] })

  await signIn(page, account)

  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible({ timeout: 5_000 })
})

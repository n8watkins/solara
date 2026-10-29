import { accountMenu, expect, HIKING, openDashboard, RUNNING, TENNIS, test } from './fixtures'
import type { Page } from './fixtures'

const proBadge = (page: Page) => page.getByRole('banner').getByText('Pro', { exact: true })

test('a free account is held to the free plan and offered Pro', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Ida Free')
  await emulators.seedPrefs(account, { tier: 'free', activities: [RUNNING, HIKING, TENNIS] })
  await openDashboard(page, account)
  await expect(proBadge(page)).toHaveCount(0)

  // Three activities is the free limit: presets lock and custom activities are off.
  await page.getByRole('button', { name: '+ Add Activity' }).click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await expect(
    add.getByText('Free plan: up to 3 activities. Upgrade to Pro for up to 20.'),
  ).toBeVisible()
  await expect(add.getByRole('button', { name: /^Jogging 30 min Locked/ })).toBeDisabled()
  await expect(add.getByRole('button', { name: '+ Create custom activity' })).toBeDisabled()
  await add.getByRole('button', { name: 'Done' }).click()

  // Two forecast days; the rest sit behind the locked Pro tab, which opens the plans.
  await expect(page.getByRole('button', { name: 'Tomorrow', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'More days', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
  const locked = page.getByRole('dialog', { name: 'Solara Pro' })
  await expect(locked.getByRole('table', { name: 'Free and Pro plan features' })).toBeVisible()
  await locked.getByRole('button', { name: 'Close' }).click()
  await expect(locked).toBeHidden()

  // The plan upsell opens the Pro plans, as Settings does.
  await page.getByRole('button', { name: /Go Pro for 10-day planning/ }).click()
  const plans = page.getByRole('dialog', { name: 'Solara Pro' })
  await expect(plans.getByRole('table', { name: 'Free and Pro plan features' })).toBeVisible()
  await expect(plans.getByRole('button', { name: 'Start free trial' })).toBeEnabled()
  await plans.getByRole('button', { name: 'Close' }).click()
  await expect(plans).toBeHidden()
  await expect(page.getByRole('button', { name: /Go Pro for 10-day planning/ })).toBeFocused()

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Account' }).click()
  await expect(settings.getByText('Free', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'See Pro plans' }).click()
  const pricing = page.getByRole('dialog', { name: 'Solara Pro' })
  await expect(pricing.getByRole('table', { name: 'Free and Pro plan features' })).toBeVisible()
  await expect(pricing.getByRole('button', { name: 'Start free trial' })).toBeEnabled()
  await pricing.getByRole('button', { name: 'Close' }).click()
  await expect(pricing).toBeHidden()
  await settings.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByText('Go Pro for the full 10-day Calendar view.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Running, Wed, Jun 17,/ })).toHaveCount(0)
})

test('a paid account gets the full forecast and more activities', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Jo Paid')
  await emulators.seedPrefs(account, { tier: 'paid', activities: [RUNNING, HIKING, TENNIS] })
  await openDashboard(page, account)
  await expect(proBadge(page)).toBeVisible()
  await expect(page.getByRole('button', { name: /Go Pro/ })).toHaveCount(0)

  await accountMenu(page, 'Settings')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Account' }).click()
  await expect(settings.getByText('Pro', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'See Pro plans' })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('button', { name: 'More days', exact: true }).click()
  const days = page.getByRole('dialog', { name: 'Choose a day' })
  await expect(days.getByRole('button', { name: 'Wed, Jun 24' })).toBeVisible()
  await days.getByRole('button', { name: 'Wed, Jun 24' }).click()
  await expect(page.getByRole('button', { name: 'Wed, Jun 24', exact: true })).toBeVisible()

  // A fourth activity is allowed.
  await page.getByRole('button', { name: '+ Add Activity' }).click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Jogging 30 min/ }).click()
  await add.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Edit Jogging' })).toBeVisible()
  await expect
    .poll(async () => ((await emulators.readPrefs(account))?.activities as unknown[]).length)
    .toBe(4)

  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Running, Wed, Jun 24, 6pm–8pm, peak UV 3.0' }),
  ).toBeVisible()
})

test('an upgrade recorded by the server applies on the next load', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Kai Upgrade')
  await emulators.seedPrefs(account, { tier: 'free', activities: [RUNNING] })
  await openDashboard(page, account)
  await expect(proBadge(page)).toHaveCount(0)

  await emulators.setTier(account, 'paid')
  await page.reload()
  await expect(proBadge(page)).toBeVisible()
  await expect(page.getByRole('button', { name: /Go Pro/ })).toHaveCount(0)
})

test('family profiles are Pro: a free account cannot add a second person', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Kit Free')
  await emulators.seedPrefs(account, { tier: 'free', activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: 'Profile: Me' }).click()
  const panel = page.getByRole('dialog', { name: 'Profiles' })
  await expect(panel.getByText('Family profiles come with Pro')).toBeVisible()
  // This build has checkout switched on, so the offer opens the plans; without it the
  // offer says Pro is a waitlist (tests/harness/family-profiles.spec.ts).
  await expect(panel.getByText(/Pro is not on sale yet/)).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /Add person or pet/ })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Plan for a group' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'See Pro' }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
})

test('a Pro family plans by its most sensitive person', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Fay Family')
  await emulators.seedPrefs(account, {
    tier: 'paid',
    activities: [RUNNING],
    profiles: [
      { id: 'me', name: 'Me', skinType: 'olive', icon: '🧑' },
      { id: 'maya', name: 'Maya', skinType: 'very-fair', icon: '🧒' },
      { id: 'leo', name: 'Leo', skinType: 'medium', icon: '👦' },
    ],
    activeProfileId: 'me',
  })
  await openDashboard(page, account)
  // The seeded live skin type (fair) until the group plans.
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Profile: Me' }).click()
  const panel = page.getByRole('dialog', { name: 'Profiles' })
  await panel.getByRole('button', { name: 'Plan for a group' }).click()
  await expect(page.getByText('Now · Maya (most sensitive), no SPF')).toBeVisible()
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Profile: group of 3, planned for Maya' }),
  ).toBeVisible()

  // Leaving Maya out hands the plan to the next most sensitive person.
  await panel.getByRole('checkbox', { name: /Maya/ }).click()
  await expect(page.getByText('Now · Leo (most sensitive), no SPF')).toBeVisible()
  await expect
    .poll(() => emulators.readPrefs(account))
    .toMatchObject({ groupMode: true, groupProfileIds: ['me', 'leo'], skinType: 'fair' })

  await page.reload()
  await expect(page.getByText('Now · Leo (most sensitive), no SPF')).toBeVisible()
})

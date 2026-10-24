import {
  accountMenu,
  completeGoogleSignIn,
  expect,
  HIKING,
  openDashboard,
  signIn,
  startAsGuest,
  test,
  uvStrip,
} from './fixtures'
import type { Page } from './fixtures'

// Guest mode (decision D7): a guest's plan carries into a brand-new account on its
// first sign-in, never into an account that already exists, and never into a later
// account on the same browser (W1-B isolation still holds).

/** The guest adds Running, the one activity the guest plan holds. */
async function addRunning(page: Page) {
  await page.getByRole('button', { name: '+ Add Activity' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Running 45m/ }).click()
  await add.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
}

function guestPlan(page: Page) {
  return page.evaluate(() => localStorage.getItem('solara_guest'))
}

test('a guest plan carries into a new account on first sign-in', async ({ page, emulators }) => {
  await startAsGuest(page, { skinType: 'Olive' })
  await addRunning(page)
  // Nothing is written anywhere but this browser while signed out.
  expect(await guestPlan(page)).toContain('"tier":"anonymous"')

  const account = await emulators.createAccount('Gia New')
  await completeGoogleSignIn(page, account, () =>
    page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click(),
  )

  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByText('Now · olive skin, no SPF')).toBeVisible()
  // The free plan sees tomorrow.
  await expect(page.getByRole('button', { name: 'Tomorrow', exact: true })).toBeVisible()
  await expect
    .poll(() => emulators.readPrefs(account))
    .toMatchObject({
      uid: account.uid,
      tier: 'free',
      skinType: 'olive',
      location: { city: 'Los Angeles' },
      activities: [{ id: 'run', name: 'Running' }],
    })
  expect(await guestPlan(page)).toBeNull()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
})

test('a returning account keeps its own plan, and no later account inherits the guest plan', async ({
  page,
  emulators,
}) => {
  const returning = await emulators.createAccount('Ravi Back')
  await emulators.seedPrefs(returning, { tier: 'paid', activities: [HIKING] })

  await startAsGuest(page, { skinType: 'Olive' })
  await addRunning(page)

  // Sign in from the save-plan upsell (asking for a second activity).
  await page.getByRole('button', { name: '+ Add Activity' }).click()
  const upsell = page.getByRole('status', { name: 'Save your plan, sign in free' })
  await completeGoogleSignIn(page, returning, () =>
    upsell.getByRole('button', { name: 'Sign in free' }).click(),
  )

  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toHaveCount(0)
  await expect(page.getByText('Now · fair skin, no SPF')).toBeVisible()
  await expect(page.getByRole('banner').getByText('Pro', { exact: true })).toBeVisible()
  expect(await emulators.readPrefs(returning)).toMatchObject({
    tier: 'paid',
    skinType: 'fair',
    activities: [{ id: 'hike', name: 'Hiking' }],
  })
  expect(await guestPlan(page)).toBeNull()

  // After sign-out, the next new account on this browser starts from its own setup.
  await accountMenu(page, 'Sign out')
  await expect(page.getByRole('heading', { name: 'Know when to go outside' })).toBeVisible()
  const next = await emulators.createAccount('Nia Next')
  await signIn(page, next, { skinType: 'Medium' })
  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByText('No activities set up yet')).toBeVisible()
  await expect
    .poll(() => emulators.readPrefs(next))
    .toMatchObject({ uid: next.uid, tier: 'free', skinType: 'medium', activities: [] })
})

test('an old bookmark of / opens the app for a signed-in account', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Bo Mark')
  await emulators.seedPrefs(account, { activities: [HIKING] })
  await openDashboard(page, account)

  await page.goto('/')
  await expect(page).toHaveURL(/\/app\/$/)
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
})

test('"Sign in" on the landing page signs a returning account straight in', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Lu Land')
  await emulators.seedPrefs(account, { activities: [HIKING] })
  await page.goto('/')
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click()
  await completeGoogleSignIn(page, account, () =>
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  )
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
})

test('a new account signing in from the landing page finishes setup', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Fin Setup')
  await page.goto('/app/?signin')
  await completeGoogleSignIn(page, account, () =>
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  )
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await page.getByLabel('City or location').fill('Los Angeles')
  await page.getByRole('button', { name: 'Go' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: /^Dark/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible()
  await page.getByRole('button', { name: /Finish setup/ }).click()
  await expect(uvStrip(page)).toBeVisible()
  await expect
    .poll(() => emulators.readPrefs(account))
    .toMatchObject({ uid: account.uid, tier: 'free', skinType: 'dark' })
})

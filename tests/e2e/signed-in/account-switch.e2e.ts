import {
  accountMenu,
  expect,
  HIKING,
  openDashboard,
  RUNNING,
  signIn,
  TENNIS,
  test,
  uvStrip,
} from './fixtures'
import type { Account, Emulators, Page } from './fixtures'

// One browser, two people: the second account must never see the first one's
// plan, plan tier or settings, whether the first signed out or their session simply
// ended (W1-B).

async function seedAlice(emulators: Emulators): Promise<Account> {
  const alice = await emulators.createAccount('Alice Stone')
  await emulators.seedPrefs(alice, { tier: 'paid', activities: [RUNNING, HIKING, TENNIS] })
  return alice
}

/** Everything the app keeps in this browser outside Firebase Auth. */
function localData(page: Page) {
  return page.evaluate(() => JSON.stringify({ ...localStorage }))
}

async function expectFreshAccount(page: Page, emulators: Emulators, alice: Account, bob: Account) {
  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByText('No activities set up yet')).toBeVisible()
  await expect(page.getByText('Now · olive skin, no SPF')).toBeVisible()
  await expect(page.getByRole('banner').getByText('Pro', { exact: true })).toHaveCount(0)
  for (const name of ['Running', 'Hiking', 'Tennis']) {
    await expect(page.getByRole('button', { name: `Edit ${name}` })).toHaveCount(0)
  }
  expect(await localData(page)).not.toContain(alice.uid)

  await expect
    .poll(() => emulators.readPrefs(bob))
    .toMatchObject({ uid: bob.uid, tier: 'free', skinType: 'olive', activities: [] })
  // Alice's account is untouched.
  expect(await emulators.readPrefs(alice)).toMatchObject({
    tier: 'paid',
    activities: [{ name: 'Running' }, { name: 'Hiking' }, { name: 'Tennis' }],
  })

  // Still Bob's own data after a reload.
  await page.reload()
  await expect(page.getByText('No activities set up yet')).toBeVisible()
  await expect(page.getByText('Now · olive skin, no SPF')).toBeVisible()
}

test('after sign-out, the next account starts clean', async ({ page, emulators }) => {
  const alice = await seedAlice(emulators)
  await openDashboard(page, alice)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  expect(await localData(page)).toContain(alice.uid)

  await accountMenu(page, 'Sign out')
  // Signed out, the visitor lands on the landing page.
  await expect(page.getByRole('heading', { name: 'Know when to go outside' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(await localData(page)).not.toContain(alice.uid)

  const bob = await emulators.createAccount('Bob Vance')
  await signIn(page, bob, { skinType: 'Olive' })
  await expectFreshAccount(page, emulators, alice, bob)
})

test('when a session ends without sign-out, the next account starts clean', async ({
  page,
  emulators,
}) => {
  const alice = await seedAlice(emulators)
  await openDashboard(page, alice)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()

  // The Firebase session disappears (expired, revoked or cleared), but Solara's
  // own data for Alice is still in this browser.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('firebaseLocalStorageDb')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve()
      }),
  )
  await page.reload()
  // Signed out with no guest plan: setup, and nothing of Alice's on screen.
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()

  const bob = await emulators.createAccount('Bob Vance')
  await signIn(page, bob, { skinType: 'Olive' })
  await expectFreshAccount(page, emulators, alice, bob)
})

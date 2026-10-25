import { expect, openDashboard, RUNNING, test, uvStrip } from './fixtures'
import type { Page, Route } from '@playwright/test'

// A returning account's start-up (lib/use-account.ts, lib/cached-account.ts): the
// dashboard shows at once from this browser's copy of the account while Firebase
// loads and Auth confirms the session, and accepts no input until the saved plan has
// loaded. Only the session's own account is ever shown that way.

/** Holds Auth's check of the stored session until the returned function is called. */
async function holdSessionCheck(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = []
  let holding = true
  await page.route('**/identitytoolkit.googleapis.com/v1/accounts:lookup*', route => {
    if (holding) held.push(route)
    else void route.continue()
  })
  return async () => {
    holding = false
    await expect.poll(() => held.length).toBeGreaterThan(0)
    for (const route of held) await route.continue()
  }
}

/** Whether the app's content is inert (shown, but not accepting input). */
function appInert(page: Page) {
  return page.evaluate(() => {
    const busy = document.querySelector<HTMLElement>('[aria-busy="true"]')
    return !!busy?.inert
  })
}

test('a returning account sees its dashboard before the session is confirmed', async ({
  page,
  emulators,
}) => {
  const alice = await emulators.createAccount('Alice Stone')
  await emulators.seedPrefs(alice, { activities: [RUNNING] })
  await openDashboard(page, alice)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()

  const release = await holdSessionCheck(page)
  await page.reload()

  // Alice's own plan and header, while Auth has not answered yet.
  await expect(uvStrip(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveAttribute(
    'title',
    'Alice Stone',
  )
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  expect(await appInert(page)).toBe(true)

  // Once Auth confirms the session and the saved plan loads, it is the live app.
  await release()
  await expect.poll(() => appInert(page)).toBe(false)
  await page.getByRole('button', { name: 'Edit Running' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test("a session that ended never shows the previous account's plan", async ({
  page,
  emulators,
}) => {
  const alice = await emulators.createAccount('Alice Stone')
  await emulators.seedPrefs(alice, { activities: [RUNNING] })
  await openDashboard(page, alice)
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()

  // Auth's session is gone, but Solara's own copy of Alice's plan is still here.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('firebaseLocalStorageDb')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve()
      }),
  )
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[aria-label="Edit Running"]')) {
        ;(window as { sawPlan?: boolean }).sawPlan = true
      }
    }).observe(document, { childList: true, subtree: true })
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  expect(await page.evaluate(() => (window as { sawPlan?: boolean }).sawPlan ?? false)).toBe(false)
})

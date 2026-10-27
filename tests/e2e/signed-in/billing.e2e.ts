// Pro billing end to end: the plans dialog, the createCheckoutSession Function, Stripe
// (the local fake in fake-stripe.mjs, which delivers signed webhooks), the stripeWebhook
// Function, the app's return from Checkout, the account page and the billing portal.
import { expect, HIKING, openDashboard, RUNNING, TENNIS, test } from './fixtures'
import type { Page } from './fixtures'

const proBadge = (page: Page) => page.getByRole('banner').getByText('Pro', { exact: true })

test('a free account starts a yearly Pro trial and manages it', async ({
  page,
  emulators,
  stripe,
}) => {
  const account = await emulators.createAccount('Rae Trial')
  await emulators.seedPrefs(account, { tier: 'free', activities: [RUNNING, HIKING, TENNIS] })
  await openDashboard(page, account)
  await expect(proBadge(page)).toHaveCount(0)

  // The plans dialog offers both plans; yearly is chosen.
  await page.getByRole('button', { name: /Go Pro for 10-day planning/ }).click()
  const plans = page.getByRole('dialog', { name: 'Solara Pro' })
  await plans.getByRole('radio', { name: /Yearly/ }).check({ force: true })
  await expect(plans.getByText('After the 7-day free trial. Cancel anytime.')).toBeVisible()
  await plans.getByRole('button', { name: 'Start free trial' }).click()

  // The Function created a Stripe Checkout Session for this account, the yearly price
  // and the trial, and the browser went to Stripe's page.
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/)
  const sessionId = new URL(page.url()).pathname.split('/').pop()!
  const session = (await stripe.state()).sessions.find(entry => entry.id === sessionId)
  expect(session).toMatchObject({
    client_reference_id: account.uid,
    customer_email: account.email,
    metadata: { firebaseUid: account.uid, plan: 'yearly' },
    subscription_data: { trial_period_days: '7', metadata: { plan: 'yearly' } },
    _price: 'price_e2e_yearly',
  })
  expect(String(session?.success_url)).toMatch(/\/app\/\?checkout=success&session_id=/)

  // The customer starts the trial on Stripe; Stripe tells the webhook.
  expect((await stripe.completeCheckout(sessionId)).status).toBe(200)

  // Stripe sends the browser back to the app, which confirms Pro.
  await page.goto(`/app/?checkout=success&session_id=${sessionId}`)
  await expect(page.getByText('Pro is active on your account.')).toBeVisible()
  await expect(proBadge(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'More days', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/app\/$/)

  const stored = await emulators.readPrefs(account)
  expect(stored).toMatchObject({
    tier: 'paid',
    subscriptionStatus: 'trialing',
    subscriptionPlan: 'yearly',
    stripeTrialUsed: true,
    subscriptionCancelAtPeriodEnd: false,
  })

  // The account page shows the plan and when the trial ends, and opens the portal.
  await page.goto('/account/')
  await expect(
    page.getByText(/^Pro, yearly\. Your free trial ends on .+; the first payment is taken then\.$/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Manage subscription' }).click()
  await page.waitForURL(/^https:\/\/billing\.stripe\.com\/p\/session\//)

  // Canceling in the portal keeps Pro to the end of the trial and says so.
  const subscription = (await stripe.state()).subscriptions.find(
    entry => (entry.metadata as Record<string, string>).firebaseUid === account.uid,
  )!
  expect((await stripe.cancelAtPeriodEnd(subscription.id)).status).toBe(200)
  await page.goto('/account/')
  await expect(
    page.getByText(/^Pro, yearly\. Your free trial ends on .+ and will not renew\.$/),
  ).toBeVisible()
  expect(await emulators.readPrefs(account)).toMatchObject({
    tier: 'paid',
    subscriptionCancelAtPeriodEnd: true,
  })
})

test('a canceled checkout charges nothing and keeps the free plan', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Cal Cancel')
  await emulators.seedPrefs(account, { tier: 'free', activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: /Go Pro for 10-day planning/ }).click()
  await page
    .getByRole('dialog', { name: 'Solara Pro' })
    .getByRole('button', { name: 'Start free trial' })
    .click()
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//)

  await page.goto('/app/?checkout=canceled')
  await expect(page.getByText('Checkout was canceled. You were not charged.')).toBeVisible()
  await expect(proBadge(page)).toHaveCount(0)
  expect(await emulators.readPrefs(account)).toMatchObject({ tier: 'free' })

  // With no subscription, the account page says Free and offers no portal.
  await page.goto('/account/')
  await expect(page.getByText('You are on the Free plan.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0)
})

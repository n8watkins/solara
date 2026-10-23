import { expect, openDashboard, RUNNING, test } from './fixtures'

test('shares an activity window as a link that opens the plan', async ({
  page,
  context,
  emulators,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const account = await emulators.createAccount('Hal Ito')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: 'Share 6pm–8pm' }).click()
  await expect(page.getByText('Copied share text and link.')).toBeVisible()

  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain("Let's do running today from 6pm–8pm in Los Angeles, California.")
  const link = copied.match(/https?:\/\/\S+/)?.[0]
  expect(link).toBeDefined()
  const url = new URL(link!)
  expect(url.origin).toBe(new URL(page.url()).origin)
  expect(url.pathname).toBe('/share/')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    a: 'Running',
    city: 'Los Angeles',
    region: 'California',
    date: '2026-06-15',
    from: '18',
    to: '20',
    uv: '3.1',
  })

  // The recipient sees the plan, without needing an account.
  await page.goto(url.pathname + url.search)
  await expect(page.getByRole('heading', { level: 1, name: 'Running' })).toBeVisible()
  await expect(page.getByText(/Today · 6pm–8pm · Los Angeles, California/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Plan your own lower-UV window' })).toBeVisible()
})

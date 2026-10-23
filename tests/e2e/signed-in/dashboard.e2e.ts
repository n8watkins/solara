import { expect, HIKING, openDashboard, RUNNING, test, uvStrip } from './fixtures'

test('a returning account sees its saved plan on the forecast', async ({ page, emulators }) => {
  const account = await emulators.createAccount('Dana Park')
  await emulators.seedPrefs(account, { activities: [RUNNING, HIKING] })

  await openDashboard(page, account)

  // The saved location and the stubbed forecast, read at the frozen 10:30.
  const header = page.getByRole('banner')
  await expect(header.getByRole('button', { name: /Los Angeles/ })).toBeVisible()
  await expect(header.getByText('Current UV index 7.0, High')).toBeVisible()
  await expect(
    uvStrip(page).getByRole('button', { name: 'UV 6.0 , High, at 10am , current hour' }),
  ).toBeVisible()
  await expect(page.getByText('UV peaks at 10.3, Extreme, at 1pm.')).toBeVisible()

  // Each saved activity gets today's remaining lower-UV window.
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Hiking' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share 6pm–8pm' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share 4pm–8pm' })).toBeVisible()

  // Tomorrow switches the whole dashboard to the next forecast day.
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
  await expect(uvStrip(page).getByRole('button', { name: /current hour/ })).toHaveCount(0)
})

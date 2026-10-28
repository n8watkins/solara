import { expect, HIKING, openDashboard, RUNNING, test } from './fixtures'

test('the calendar shows each activity window and opens its details', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Gus Hale')
  await emulators.seedPrefs(account, { activities: [RUNNING, HIKING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  const main = page.getByRole('main')
  await expect(main.getByRole('group', { name: 'Hours shown' })).toBeVisible()
  await expect(
    main.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }),
  ).toBeVisible()
  await expect(
    // Planned for a clear sky: 4pm would be over the limit if tomorrow's thin clouds break.
    main.getByRole('button', { name: 'Hiking, Tomorrow, 5pm – 8pm, peak UV 5.1' }),
  ).toBeVisible()

  // Filtering to one activity hides the others.
  await main.getByRole('combobox', { name: 'Show' }).selectOption({ label: '🏃 Running' })
  await expect(main.getByRole('button', { name: /^Hiking,/ })).toHaveCount(0)
  // At the frozen 10:30 the morning window has already passed, so today offers
  // only the evening one; tomorrow has both.
  await expect(main.getByRole('button', { name: /^Running, Today,/ })).toHaveCount(1)
  await expect(main.getByRole('button', { name: /^Running, Tomorrow,/ })).toHaveCount(2)

  await main.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }).click()
  const details = page.getByRole('dialog', { name: 'Running' })
  await expect(details.getByText('Today · 6pm – 8pm')).toBeVisible()
  // With Google Calendar set up, adding goes through the API and shows as Scheduled
  // (scheduled.e2e.ts); the plain template link is the fallback without it.
  await expect(details.getByRole('button', { name: /Add to Google Calendar/ })).toBeVisible()
  await details.getByRole('button', { name: 'Close' }).click()
  await expect(details).toBeHidden()

  // Back on the dashboard, the plan is unchanged.
  await page.getByRole('button', { name: /Dashboard/ }).click()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
})

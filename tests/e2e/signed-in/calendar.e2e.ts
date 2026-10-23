import { expect, HIKING, openDashboard, RUNNING, test } from './fixtures'

test('the calendar shows each activity window and opens its details', async ({
  page,
  emulators,
}) => {
  const account = await emulators.createAccount('Gus Hale')
  await emulators.seedPrefs(account, { activities: [RUNNING, HIKING] })
  await openDashboard(page, account)

  await page.getByRole('button', { name: /Calendar/ }).click()
  const main = page.getByRole('main')
  await expect(main.getByRole('group', { name: 'Hours shown' })).toBeVisible()
  await expect(
    main.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }),
  ).toBeVisible()
  await expect(
    main.getByRole('button', { name: 'Hiking, Tomorrow, 4pm – 8pm, peak UV 7.2' }),
  ).toBeVisible()

  // Filtering to one activity hides the others.
  await main.getByRole('combobox', { name: 'Show' }).selectOption({ label: '🏃 Running' })
  await expect(main.getByRole('button', { name: /^Hiking,/ })).toHaveCount(0)
  await expect(main.getByRole('button', { name: /^Running, Today,/ })).toHaveCount(2)

  await main.getByRole('button', { name: 'Running, Today, 6pm – 8pm, peak UV 3.1' }).click()
  const details = page.getByRole('dialog', { name: 'Running' })
  await expect(details.getByText('Today · 6pm – 8pm')).toBeVisible()
  await expect(details.getByRole('link', { name: /Add to Google Calendar/ })).toHaveAttribute(
    'href',
    /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Running/,
  )
  await details.getByRole('button', { name: 'Close' }).click()
  await expect(details).toBeHidden()

  // Back on the dashboard, the plan is unchanged.
  await page.getByRole('button', { name: /Dashboard/ }).click()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
})

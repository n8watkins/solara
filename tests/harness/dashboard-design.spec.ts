import { expect, test, type Page } from '@playwright/test'
import { captureScreen } from './capture'
import { DAWN_MS, NIGHT_MS, atNight, openDashboard, prepareLiveDashboard } from './live-forecast'

// The dashboard's states, hierarchy and clutter from the design audit
// (handoff/design-audit.md items 5-8, 10-14, 21): after dark, before sunrise, the
// empty plan, the phone header, one caveat, plain card copy, the preset tiles,
// Manage at the plan's limit and the desktop columns.

test.describe('logic checks', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'logic check, run once')
  })

  // Item 5: no bare "0.0 None now" and unexplained dashes after dark.
  test('after dark the dashboard says the sun is down and when UV returns', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'free', edit: atNight })
    const readout = page.getByTestId('uv-readout')
    await expect(readout).toContainText('Sun is down')
    await expect(readout).toContainText('UV returns about 7am tomorrow')
    const hero = page.getByTestId('hero-empty')
    await expect(hero).toContainText('Sun is down')
    await expect(hero).toContainText('Tomorrow peaks 9.7 at 1pm, below UV 3 until 9am.')
    await expect(hero).toContainText('Next: Running tomorrow at 6am.')
    await expect(page.getByTestId('burn-metric')).toContainText('No burn risk until 7am tomorrow')
    await expect(page.getByText('--', { exact: true })).toHaveCount(0)
    // Item 6: "now" is marked on the sun path, at the end of the day it is past.
    await expect(page.getByTestId('sun-arc-night')).toBeVisible()
  })

  test('a guest after dark is not shown tomorrow, only offered it', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, tier: 'guest', edit: atNight })
    const hero = page.getByTestId('hero-empty')
    await expect(hero).toContainText('Sun is down')
    await expect(hero).not.toContainText('Tomorrow peaks')
    await expect(hero.getByRole('button', { name: 'Sign in free to plan tomorrow' })).toBeVisible()
  })

  test('before sunrise the readout says when UV starts', async ({ page }) => {
    await openDashboard(page, { at: DAWN_MS, edit: atNight })
    await expect(page.getByTestId('uv-readout')).toContainText('Before sunrise')
    await expect(page.getByTestId('uv-readout')).toContainText('UV returns about 7am')
  })

  // Item 10: the caveat appears once.
  test('the dashboard carries one caveat line', async ({ page }) => {
    await openDashboard(page, {})
    await expect(page.getByText(/medical advice/)).toHaveCount(1)
  })

  // Item 11: plain words on the activity card.
  test('activity cards use plain words', async ({ page }) => {
    await openDashboard(page, { at: NIGHT_MS, edit: atNight })
    const card = page.getByTestId('activity-card').filter({ hasText: 'Hiking' })
    await expect(card).toContainText('Planned forUV 8 or lower with SPF')
    await expect(card).toContainText('Burn time at UV 8')
    await expect(card).toContainText('of daylight hours fit')
    await expect(card.getByText('Done for today')).toHaveClass(/badge-done/)
    await expect(card).not.toContainText(/Threshold|Planning UV limit|visible day/)
  })

  // Item 7: one Add button when the plan is empty.
  test('an empty plan offers one Add button', async ({ page }) => {
    await openDashboard(page, { tier: 'guest' })
    await page.getByRole('button', { name: 'Manage' }).click()
    const manage = page.getByRole('dialog', { name: 'Manage activities' })
    await manage.getByRole('button', { name: 'Remove Running' }).click()
    await manage.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: '+ Add Activity' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
  })

  // Item 13: at the plan's limit there is no grey Duplicate, and a note says why.
  test('Manage at the plan limit explains instead of a dead Duplicate', async ({ page }) => {
    await openDashboard(page, { tier: 'guest' })
    await page.getByRole('button', { name: 'Manage' }).click()
    const manage = page.getByRole('dialog', { name: 'Manage activities' })
    await expect(manage.getByText('Guests can plan 1 activity.', { exact: false })).toBeVisible()
    await expect(manage.getByRole('button', { name: /Duplicate/ })).toHaveCount(0)
  })

  // Item 12: tiles add with a + and hide with a labeled Hide, never an ambiguous x.
  test('preset tiles add with a plus and hide with a labeled button', async ({ page }) => {
    await openDashboard(page, { tier: 'free' })
    await page.getByRole('button', { name: '+ Add Activity' }).click()
    const add = page.getByRole('dialog', { name: 'Add activity' })
    await expect(add.getByRole('button', { name: 'Hide Mountain biking suggestion' })).toHaveText(
      'Hide',
    )
    const hides = add.getByRole('button', { name: /^Hide .* suggestion$/ })
    expect(await hides.count()).toBeGreaterThan(5)
    for (const text of await hides.allTextContents()) expect(text).toBe('Hide')
  })
})

/** The two dashboard columns' left edges at desktop width (item 14). */
async function columnLefts(page: Page) {
  const uv = await page.getByTestId('uv-readout').boundingBox()
  const activities = await page.getByText('Add what you do outside', { exact: false }).boundingBox()
  return { uv: uv!.x, activities: activities!.x }
}

test('from 1024 px the UV card and the plan sit side by side', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'layout check, run once')
  await openDashboard(page, {})
  const wide = await columnLefts(page)
  expect(wide.activities).toBeGreaterThan(wide.uv + 400)
  await page.setViewportSize({ width: 900, height: 900 })
  await expect.poll(async () => (await columnLefts(page)).activities).toBeLessThan(wide.uv + 40)
})

// Item 8: on phones the header gives the place the room; the UV chip is desktop only.
test('the phone header shows the whole city and no UV chip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-light', 'phone layout check, run once')
  await openDashboard(page, {})
  await expect(page.getByTitle(/Current UV index/)).toBeHidden()
  const city = page.locator('header').getByText('Los Angeles')
  const truncated = await city.evaluate(el => el.scrollWidth > el.clientWidth)
  expect(truncated).toBe(false)
})

// Screens for review, at 390 px and 1440 px in both themes.
const SCREENS = [
  { name: 'dashboard-night-paid', at: NIGHT_MS, tier: 'paid', edit: atNight },
  { name: 'dashboard-dawn', at: DAWN_MS, tier: 'paid', edit: atNight },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await prepareLiveDashboard(page, testInfo, screen)
    await captureScreen(page, testInfo, capture, { name: screen.name, fullPage: true })
  })
}

import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Guest mode and the gentle upsell (decision D7): the guest dashboard, each upsell
// at its natural moment, and the plans dialog every upsell opens. Same output as
// the other harness specs (screenshots plus axe, into test-results/ui-harness/).

/** A guest who first set Solara up five days before the harness's frozen day. */
const RETURNING_GUEST = JSON.stringify({ prefs: {}, since: '2026-06-10' })

interface Screen {
  name: string
  query: string
  fullPage: boolean
  /** Runs before the page loads (seeds this browser's storage). */
  init?: string
  reach: (page: Page) => Promise<Locator> | Locator
}

const SCREENS: Screen[] = [
  {
    name: 'guest-dashboard',
    query: 'tier=guest',
    fullPage: true,
    reach: async page => {
      // Today only, with the rest of the forecast behind the locked tab.
      await expect(page.getByRole('button', { name: 'Tomorrow' })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'See the next 10 days with Pro' }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0)
      // No upsell card on a first visit.
      await expect(page.getByTestId('upsell')).toHaveCount(0)
      return page.getByTestId('hero-slot')
    },
  },
  {
    name: 'upsell-save-plan',
    query: 'tier=guest',
    fullPage: false,
    reach: async page => {
      // A second activity is the guest plan's limit: the save-plan offer appears.
      await page.getByRole('button', { name: '+ Add Activity' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const upsell = page.getByRole('status', { name: 'Save your plan, sign in free' })
      await expect(upsell).toBeFocused()
      await upsell.scrollIntoViewIfNeeded()
      return upsell
    },
  },
  {
    name: 'upsell-returning-guest',
    query: 'tier=guest',
    fullPage: false,
    init: `localStorage.setItem('solara_guest', ${JSON.stringify(RETURNING_GUEST)})`,
    reach: async page => {
      const upsell = page.getByRole('status', { name: 'Save your plan, sign in free' })
      await upsell.scrollIntoViewIfNeeded()
      return upsell
    },
  },
  {
    name: 'upsell-morning-alert',
    query: 'tier=free',
    fullPage: false,
    reach: page => page.getByRole('button', { name: /Get this as a morning alert/ }),
  },
  {
    name: 'pricing-guest',
    query: 'tier=guest',
    fullPage: false,
    reach: async page => {
      await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
      const dialog = page.getByRole('dialog', { name: 'Solara Pro' })
      await expect(
        dialog.getByRole('table', { name: 'Guest, Free and Pro plan features' }),
      ).toBeVisible()
      return dialog.getByRole('button', { name: 'Sign in free' })
    },
  },
  {
    // A guest changes the skin type after setup from "Edit" on the burn card (REVIEW8 QA M3).
    name: 'guest-settings-skin',
    query: 'tier=guest',
    fullPage: false,
    reach: async page => {
      await page.getByTestId('burn-metric').getByRole('button', { name: 'Edit skin type' }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await expect(dialog.getByRole('tab', { name: 'Sun profile' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      return dialog.getByLabel('Skin type')
    },
  },
  {
    // ... and theme and units from the header's Settings button.
    name: 'guest-settings-display',
    query: 'tier=guest',
    fullPage: false,
    reach: async page => {
      await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await dialog.getByRole('tab', { name: 'Display' }).click()
      return dialog.getByLabel('Temperature')
    },
  },
  {
    name: 'pricing-free',
    query: 'tier=free',
    fullPage: false,
    reach: async page => {
      await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
      const dialog = page.getByRole('dialog', { name: 'Solara Pro' })
      await expect(dialog.getByRole('table', { name: 'Free and Pro plan features' })).toBeVisible()
      return dialog.getByRole('button', { name: 'Join Pro waitlist' })
    },
  },
]

for (const screen of SCREENS) {
  test(screen.name, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo)
    if (screen.init) await page.addInitScript(screen.init)
    await page.goto(`/harness/?screen=dashboard&${screen.query}`)
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')
    await expect(await screen.reach(page)).toBeVisible()
    await captureScreen(page, testInfo, capture, screen)
  })
}

test('a dismissed upsell stays dismissed on this device', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await page.addInitScript(
    `localStorage.setItem('solara_guest', ${JSON.stringify(RETURNING_GUEST)})`,
  )
  await page.goto('/harness/?screen=dashboard&tier=guest')
  const upsell = page.getByRole('status', { name: 'Save your plan, sign in free' })
  await upsell.getByRole('button', { name: 'Not now' }).click()
  await expect(upsell).toHaveCount(0)

  const alert = page.getByRole('button', { name: /Get this as a morning alert/ })
  await page.getByRole('button', { name: 'Not now: morning alerts' }).click()
  await expect(alert).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  await expect(page.getByTestId('upsell')).toHaveCount(0)
  await expect(alert).toHaveCount(0)

  // Once dismissed, asking for a second activity opens the dialog with the limit note.
  await page.getByRole('button', { name: '+ Add Activity' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Add activity' })
      .getByText('Guests can plan 1 activity. Sign in free to plan up to 3.'),
  ).toBeVisible()
})

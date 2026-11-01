import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// Guest mode without any Firebase project (the hermetic build): setup, the guest
// dashboard on the guest plan, its limits and upsells, and a plan kept on this device.

test.beforeEach(async ({ page }) => {
  await page.route('https://geocoding-api.open-meteo.com/**', route =>
    route.fulfill({
      json: {
        results: [
          {
            name: 'Los Angeles',
            admin1: 'California',
            country: 'United States',
            latitude: 34.05,
            longitude: -118.24,
            timezone: 'America/Los_Angeles',
          },
        ],
      },
    }),
  )
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await startClock(page)
})

async function startAsGuest(page: Page) {
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByLabel('City or location').fill('Los Angeles')
  await page.getByRole('button', { name: 'Go' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: /See today's plan/ }).click()
  await expect(page.getByRole('toolbar', { name: 'UV forecast by hour' })).toBeVisible()
}

test('a guest plans today with one activity, kept on this device', async ({ page }) => {
  await startAsGuest(page)

  // Today only; later days sit behind the Pro tab. No calendar for guests.
  await expect(page.getByRole('button', { name: 'Tomorrow' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0)
  // No upsell on a first visit.
  await expect(page.getByTestId('upsell')).toHaveCount(0)

  await page.getByRole('button', { name: '+ Add activity' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Running 45 min/ }).click()
  await expect(
    add.getByText('Guests can plan 1 activity. Sign in free to plan up to 3.'),
  ).toBeVisible()
  await add.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()

  // Asking for a second activity offers free sign-in instead of the dialog.
  await page.getByRole('button', { name: '+ Add activity' }).click()
  const upsell = page.getByRole('status', { name: 'Save your plan, sign in free' })
  await expect(upsell).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await upsell.getByRole('button', { name: 'Not now' }).click()
  await expect(upsell).toHaveCount(0)

  // The plan and the dismissal survive a reload; the guest goes straight back to it.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()
  await expect(page.getByTestId('upsell')).toHaveCount(0)
  const stored = await page.evaluate(() => localStorage.getItem('solara_guest'))
  expect(JSON.parse(stored!)).toMatchObject({ prefs: { uid: '', tier: 'anonymous' } })
})

test('the locked tab and the morning alert open the Pro plans', async ({ page }) => {
  await startAsGuest(page)
  await page.getByRole('button', { name: 'See the next 10 days with Pro' }).click()
  const plans = page.getByRole('dialog', { name: 'Solara Pro' })
  await expect(
    plans.getByRole('table', { name: 'Guest, Free and Pro plan features' }),
  ).toBeVisible()
  await expect(plans.getByText('$2.99')).toBeVisible()
  await expect(plans.getByText('Save 44%')).toBeVisible()
  await plans.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: 'See the next 10 days with Pro' })).toBeFocused()

  await page.getByRole('button', { name: '+ Add activity' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Running 45 min/ }).click()
  await add.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Get this as a morning alert/ }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
})

test('the hourly strip is one Tab stop, with the arrow keys between hours', async ({ page }) => {
  // REVIEW10 VERIFY10 N6: the strip was 15 Tab stops; it is a toolbar with a roving
  // tabindex. The frozen clock is 10:30, so the strip's stop is the current hour's bar,
  // which reads the live UV as "Now".
  await startAsGuest(page)
  const strip = page.getByRole('toolbar', { name: 'UV forecast by hour' })
  const stops = strip.locator('button:not([tabindex="-1"])')
  await expect(stops).toHaveCount(1)
  const now = strip.getByRole('button', { name: /, Now$/ })
  await expect(now).toHaveAttribute('tabindex', '0')

  // Tab from the control before the strip lands on its one stop, and the next Tab
  // leaves the strip.
  await now.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(strip.locator(':focus')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(now).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(strip.locator(':focus')).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await expect(now).toBeFocused()

  // The arrows, Home and End move the focus and select the hour they land on.
  await page.keyboard.press('ArrowRight')
  const eleven = strip.getByRole('button', { name: /at 11am$/ })
  await expect(eleven).toBeFocused()
  await expect(eleven).toHaveAttribute('aria-pressed', 'true')
  await expect(eleven).toHaveAttribute('tabindex', '0')
  await expect(stops).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(strip.getByRole('button', { name: /at 9am$/ })).toBeFocused()
  await page.keyboard.press('End')
  await expect(strip.getByRole('button', { name: /at 8pm$/ })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(strip.getByRole('button', { name: /at 8pm$/ })).toBeFocused()
  await page.keyboard.press('Home')
  const first = strip.getByRole('button', { name: /at 6am$/ })
  await expect(first).toBeFocused()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  // Leaving and coming back returns to the hour last chosen.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(first).toBeFocused()
})

test('a guest who comes back on a later day is offered to save the plan', async ({ page }) => {
  await page.addInitScript(() => {
    const prefs = {
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
      skinType: 'fair',
      activities: [],
      onboardingComplete: true,
    }
    localStorage.setItem('solara_guest', JSON.stringify({ prefs, since: '2026-06-12' }))
  })
  await page.goto('/app/')
  await expect(page.getByRole('status', { name: 'Save your plan, sign in free' })).toBeVisible()
})

// The first-load JavaScript budget is measured on a production-like build:
// tests/e2e/budget/first-load.budget.ts (npm run test:e2e:budget).

test('a guest plan with activities shows its activity cards with the dashboard', async ({
  page,
}) => {
  // The activity plan loads on demand (components/deferred.tsx): the dashboard waits
  // for it before its first paint, so the cards never pop in after the forecast.
  await page.addInitScript(() => {
    const prefs = {
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
      skinType: 'fair',
      activities: [
        {
          id: 'run',
          name: 'Running',
          icon: '🏃',
          durationMins: 45,
          maxUV: 4,
          sunscreen: false,
          timePreference: 'earliest',
        },
      ],
      onboardingComplete: true,
    }
    localStorage.setItem('solara_guest', JSON.stringify({ prefs, since: '2026-06-15' }))
  })
  await page.goto('/app/')
  // Checked in the same frame the forecast first shows: the cards, and the hero's slot,
  // which the slot planning (loaded with the activity plan) has already found.
  const cardWithForecast = await page.waitForFunction(() => {
    if (!document.querySelector('[aria-label="UV forecast by hour"]')) return null
    return {
      card: !!document.querySelector('[data-testid="activity-card"]'),
      heroSlot: /Next slot for Running\D{0,6}\d/u.test(document.body.textContent ?? ''),
    }
  })
  expect(await cardWithForecast.jsonValue()).toEqual({ card: true, heroSlot: true })
  await expect(page.getByTestId('activity-card')).toContainText('Running')
})

/** Records every layout shift of the pages this test opens, on `window.layoutShifts`. */
async function recordLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    const shifts: string[] = []
    Object.assign(window, { layoutShifts: shifts })
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        hadRecentInput: boolean
        sources: { node?: Node }[]
      })[]) {
        if (entry.hadRecentInput) continue
        const nodes = entry.sources.map(source => {
          const node = source.node as Element | undefined
          return `${node?.tagName}(${node?.textContent?.slice(0, 40)})`
        })
        shifts.push(`${entry.value.toFixed(4)} ${nodes.join(' ')}`)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

for (const locale of ['en-US', 'es-MX']) {
  test.describe(`pages outside the app in ${locale}`, () => {
    test.use({ locale })

    // REVIEW10 QA L1 and L2: the account page painted its footer at the top before its
    // content arrived, and the 404 page moved when the consent banner laid itself out.
    // The banner shows (no choice stored), as on a first visit.
    test('open without layout shifts, at every width', async ({ page }) => {
      await recordLayoutShifts(page)
      for (const path of ['/account/', '/no-such-page/']) {
        for (const width of [320, 390, 1280]) {
          await page.setViewportSize({ width, height: 844 })
          await page.goto(path)
          await expect(page.locator('main h1, main h2').first()).toBeVisible()
          await page.waitForTimeout(500)
          const shifts = await page.evaluate(
            () => (window as unknown as { layoutShifts: string[] }).layoutShifts,
          )
          expect(shifts, `layout shifts on ${path} at ${width} px`).toEqual([])
        }
      }
    })
  })
}

test("a guest's dashboard opens without layout shifts, at every width", async ({ page }) => {
  // Nothing that arrives during start-up may move what is already on screen: the
  // forecast takes a moment, as on a real connection, so the header and the loading
  // state have painted before the dashboard and the header's current-UV chip arrive.
  await page.route('https://api.open-meteo.com/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 400))
    await route.fulfill({ json: buildRawForecast() })
  })
  await page.addInitScript(() => {
    const prefs = {
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
      skinType: 'fair',
      activities: [],
      onboardingComplete: true,
    }
    localStorage.setItem('solara_guest', JSON.stringify({ prefs, since: '2026-06-15' }))
    const shifts: string[] = []
    Object.assign(window, { layoutShifts: shifts })
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        hadRecentInput: boolean
        sources: { node?: Node }[]
      })[]) {
        if (entry.hadRecentInput) continue
        const nodes = entry.sources.map(source => (source.node as Element | undefined)?.className)
        shifts.push(`${entry.value.toFixed(4)} ${nodes.join(' ')}`)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/app/')
    await expect(page.getByRole('toolbar', { name: 'UV forecast by hour' })).toBeVisible()
    await page.waitForTimeout(500)
    const shifts = await page.evaluate(
      () => (window as unknown as { layoutShifts: string[] }).layoutShifts,
    )
    expect(shifts, `layout shifts at ${width} px`).toEqual([])
  }
})

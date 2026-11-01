import { gzipSync } from 'node:zlib'
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
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
}

test('a guest plans today with one activity, kept on this device', async ({ page }) => {
  await startAsGuest(page)

  // Today only; later days sit behind the Pro tab. No calendar for guests.
  await expect(page.getByRole('button', { name: 'Tomorrow' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0)
  // No upsell on a first visit.
  await expect(page.getByTestId('upsell')).toHaveCount(0)

  await page.getByRole('button', { name: '+ Add Activity' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Running 45 min/ }).click()
  await expect(
    add.getByText('Guests can plan 1 activity. Sign in free to plan up to 3.'),
  ).toBeVisible()
  await add.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Edit Running' })).toBeVisible()

  // Asking for a second activity offers free sign-in instead of the dialog.
  await page.getByRole('button', { name: '+ Add Activity' }).click()
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

  await page.getByRole('button', { name: '+ Add Activity' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await add.getByRole('button', { name: /^Running 45 min/ }).click()
  await add.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Get this as a morning alert/ }).click()
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toBeVisible()
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

/**
 * Gzip size budget for the JavaScript a guest downloads before the dashboard shows,
 * compressed like Firebase Hosting serves it (gzip level 9; browsers that accept
 * Brotli get about 15% less). Next.js and React are about 130 KB of it. Firebase, the
 * dialogs, setup, the location panel, the install prompt, the signed-in parts, the
 * analytics code and the activity plan with its slot planning (which a plan without
 * activities, like a new guest's, never needs) load on demand (lib/firebase.ts,
 * components/deferred.tsx), the boundaries are validated with Valibot, and the React
 * Compiler is off (next.config.ts); about 182 KB today, 192.1 KB before ROADMAP item
 * 39, 199 KB before #127 and over 500 KB before #83. The budget leaves about 4 KB for
 * growth (ROADMAP decisions, "First-load budget"): raise it only with a reason.
 */
const GUEST_FIRST_LOAD_BUDGET_KB = 186

test("a guest's first load stays within the JavaScript budget", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const prefs = {
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
      skinType: 'fair',
      activities: [],
      onboardingComplete: true,
    }
    localStorage.setItem('solara_guest', JSON.stringify({ prefs, since: '2026-06-15' }))
  })
  const scripts: Promise<{ url: string; gzip: number }>[] = []
  page.on('response', response => {
    if (response.request().resourceType() !== 'script') return
    if (!response.url().startsWith(baseURL!)) return
    scripts.push(
      response
        .body()
        .then(body => ({ url: response.url(), gzip: gzipSync(body, { level: 9 }).length })),
    )
  })
  await page.goto('/app/')
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()

  const loaded = await Promise.all(scripts)
  const kb = loaded.reduce((sum, script) => sum + script.gzip, 0) / 1024
  const list = loaded.map(script => `${(script.gzip / 1024).toFixed(1)} KB ${script.url}`)
  expect(kb, `guest first load: ${kb.toFixed(1)} KB gzip\n${list.join('\n')}`).toBeLessThan(
    GUEST_FIRST_LOAD_BUDGET_KB,
  )
})

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
    await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
    await page.waitForTimeout(500)
    const shifts = await page.evaluate(
      () => (window as unknown as { layoutShifts: string[] }).layoutShifts,
    )
    expect(shifts, `layout shifts at ${width} px`).toEqual([])
  }
})

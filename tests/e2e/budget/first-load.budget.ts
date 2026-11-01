import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../../harness/clock'
import { buildRawForecast } from '../../harness/fixtures'

// The JavaScript a returning guest downloads before the dashboard shows (the hourly
// strip), compressed like Firebase Hosting serves it (gzip level 9; browsers that accept
// Brotli get about 15% less), on a production-like build (playwright.config.ts here).
//
// Next.js and React are about 130 KB of it. Firebase, the dialogs, setup, the location
// panel, the install prompt, the signed-in parts, the analytics code and the activity
// plan with its slot planning and its text (which a plan without activities, like a new
// guest's, never needs) load on demand (lib/firebase.ts, components/deferred.tsx), the
// boundaries are validated with Valibot, and the React Compiler is off (next.config.ts).
// Spanish adds the opening screen's translations and the part of the rest that the first
// screen's deferred parts read (lib/i18n.ts); the text of setup, the account, events and
// pricing loads only with the part that shows it.
//
// The budgets leave room for growth (ROADMAP decisions, "First-load budget"): raise one
// only with a reason written here. History: 199 KB before #127, 192.1 KB before ROADMAP
// item 39, over 500 KB before #83; REVIEW10 QA M1 measured 192.40 KB (English) and
// 218.54 KB (Spanish) on the live site against these same budgets.
const BUDGET_KB = { en: 192, es: 218 } as const

const GUEST = JSON.stringify({
  prefs: {
    location: {
      lat: 34.05,
      lon: -118.24,
      city: 'Los Angeles',
      region: 'California',
      timezone: 'America/Los_Angeles',
    },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
})

/** Every same-origin script the page downloads, gzip-sized, until the dashboard shows. */
async function firstLoad(page: Page, origin: string, hourlyStrip: string) {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  // Analytics consent stays unanswered: its banner is part of a first visit's screen.
  await page.addInitScript(plan => localStorage.setItem('solara_guest', plan), GUEST)
  await startClock(page)
  const scripts: Promise<{ url: string; gzip: number }>[] = []
  page.on('response', response => {
    if (response.request().resourceType() !== 'script') return
    if (!response.url().startsWith(origin)) return
    scripts.push(
      response
        .body()
        .then(body => ({ url: response.url(), gzip: gzipSync(body, { level: 9 }).length })),
    )
  })
  await page.goto('/app/')
  await expect(page.getByRole('group', { name: hourlyStrip })).toBeVisible()
  const loaded = await Promise.all(scripts)
  const kb = loaded.reduce((sum, script) => sum + script.gzip, 0) / 1024
  const list = loaded
    .sort((a, b) => b.gzip - a.gzip)
    .map(script => `${(script.gzip / 1024).toFixed(2)} KB ${script.url.slice(origin.length)}`)
  return { kb, report: `${kb.toFixed(2)} KB gzip in ${loaded.length} scripts\n${list.join('\n')}` }
}

test.describe('in English', () => {
  test.use({ locale: 'en-US' })

  test("a guest's first load stays within the budget", async ({ page, baseURL }, testInfo) => {
    const { kb, report } = await firstLoad(page, baseURL!, 'UV forecast by hour')
    await testInfo.attach('first-load', { body: report, contentType: 'text/plain' })
    console.log(`English first load: ${report}`)
    expect(kb, `English first load: ${report}`).toBeLessThan(BUDGET_KB.en)
  })
})

test.describe('in Spanish', () => {
  test.use({ locale: 'es-MX' })

  test("a guest's first load stays within the budget", async ({ page, baseURL }, testInfo) => {
    const { kb, report } = await firstLoad(page, baseURL!, 'Pronóstico UV por hora')
    await testInfo.attach('first-load', { body: report, contentType: 'text/plain' })
    console.log(`Spanish first load: ${report}`)
    expect(kb, `Spanish first load: ${report}`).toBeLessThan(BUDGET_KB.es)
  })
})

import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../../harness/clock'
import { buildRawForecast } from '../../harness/fixtures'
import {
  builtScripts,
  ON_DEMAND_MODULES,
  onDemandModulesIn,
  recordScripts,
} from '../on-demand-modules'

// The JavaScript a returning guest downloads before the dashboard shows (the hourly
// strip), compressed like Firebase Hosting serves it (gzip level 9; browsers that accept
// Brotli get about 15% less), on a production-like build (playwright.config.ts here).
//
// Next.js and React are about 130 KB of it. Firebase, the dialogs, setup, the location
// panel, the install prompt, the signed-in parts, the analytics code and the activity
// plan with its slot planning and its text (which a plan without activities, like a new
// guest's, never needs) load on demand (lib/firebase.ts, components/deferred.tsx), and
// the React Compiler is off (next.config.ts). So does Valibot: what the opening screen
// reads (the forecast, its cache and the guest plan) is checked by hand-written code
// (ROADMAP item 52), and each test below also fails if Valibot, Firebase or Google
// Analytics is among the scripts (../on-demand-modules.ts).
// Spanish adds the opening screen's translations and the part of the rest that the first
// screen's deferred parts read (lib/i18n.ts); the text of setup, the account, events and
// pricing loads only with the part that shows it.
//
// The budgets leave room for growth (ROADMAP decisions, "First-load budget"): raise one
// only with a reason written here. History: 199 KB before #127, 192.1 KB before ROADMAP
// item 39, over 500 KB before #83; REVIEW10 QA M1 measured 192.40 KB (English) and
// 218.54 KB (Spanish) on the live site against these same budgets. English went from 192 to
// 193 KB with ROADMAP item 51 (190.7 to 192.2 KB): reading forecast hours on the place's
// clock across daylight saving changes, recovering a tab left open across a deploy (which
// cannot load on demand, since that code is what fails) and the hourly strip's keyboard
// all run on the opening screen. ROADMAP item 52 took Valibot and the code for a return
// from Stripe Checkout, Google sign-in's popup and the forecast proxy out of it (192.54 to
// 186.85 KB in English, 198.08 to 192.24 KB in Spanish), and the budgets moved from 193 and
// 218 KB to 190 and 196 KB.
const BUDGET_KB = { en: 190, es: 196 } as const

// A returning guest's plan as setup saved it (lib/guest.ts saveGuestPrefs). A plan in any
// other form (an older one, or one changed outside Solara) loads the preferences schema
// once to repair it (lib/stored-guest-plan.ts); it is saved repaired, so it is not what a
// returning guest downloads.
const GUEST = JSON.stringify({
  prefs: {
    uid: '',
    schemaVersion: 2,
    location: {
      lat: 34.05,
      lon: -118.24,
      city: 'Los Angeles',
      region: 'California',
      timezone: 'America/Los_Angeles',
    },
    savedLocations: [],
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'anonymous',
    onboardingComplete: true,
    hiddenActivitySuggestionIds: [],
    collapsedActivityCategories: [],
    notificationHour: 7,
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
  const recording = recordScripts(page, origin)
  await page.goto('/app/')
  await expect(page.getByRole('toolbar', { name: hourlyStrip })).toBeVisible()
  const loaded = (await recording.scripts()).map(({ url, body }) => ({
    url,
    gzip: gzipSync(body, { level: 9 }).length,
    onDemand: onDemandModulesIn(body.toString('utf8')),
  }))
  const kb = loaded.reduce((sum, script) => sum + script.gzip, 0) / 1024
  const list = loaded
    .sort((a, b) => b.gzip - a.gzip)
    .map(script => `${(script.gzip / 1024).toFixed(2)} KB ${script.url}`)
  const onDemand = loaded.flatMap(({ url, onDemand }) => onDemand.map(name => `${name} in ${url}`))
  return {
    kb,
    onDemand,
    report: `${kb.toFixed(2)} KB gzip in ${loaded.length} scripts\n${list.join('\n')}`,
  }
}

test('every on-demand module is still recognised in the build', () => {
  // Otherwise a changed library would pass the checks below by matching nothing.
  const scripts = builtScripts(process.env.E2E_SITE_DIR || 'out')
  for (const { name, text } of ON_DEMAND_MODULES) {
    expect(
      scripts.some(script => text.test(script)),
      `${name} not found in the build`,
    ).toBe(true)
  }
})

test.describe('in English', () => {
  test.use({ locale: 'en-US' })

  test("a guest's first load stays within the budget", async ({ page, baseURL }, testInfo) => {
    const { kb, onDemand, report } = await firstLoad(page, baseURL!, 'UV forecast by hour')
    await testInfo.attach('first-load', { body: report, contentType: 'text/plain' })
    console.log(`English first load: ${report}`)
    expect(kb, `English first load: ${report}`).toBeLessThan(BUDGET_KB.en)
    expect(onDemand, 'modules that load on demand').toEqual([])
  })
})

test.describe('in Spanish', () => {
  test.use({ locale: 'es-MX' })

  test("a guest's first load stays within the budget", async ({ page, baseURL }, testInfo) => {
    const { kb, onDemand, report } = await firstLoad(page, baseURL!, 'Pronóstico UV por hora')
    await testInfo.attach('first-load', { body: report, contentType: 'text/plain' })
    console.log(`Spanish first load: ${report}`)
    expect(kb, `Spanish first load: ${report}`).toBeLessThan(BUDGET_KB.es)
    expect(onDemand, 'modules that load on demand').toEqual([])
  })
})

// The app's first load, in a production build with a (fake) Firebase project: a guest
// never downloads Firebase, which loads only once someone reaches for "Sign in" or a
// stored session needs it (lib/firebase.ts). The first-load JavaScript budget is
// checked in the signed-out suite (tests/e2e/guest.spec.ts), whose build has no
// Sentry DSN, like production today.
import type { Page } from '@playwright/test'
import { startClock } from '../../harness/clock'
import { buildRawForecast } from '../../harness/fixtures'
import { expect, restoreSession, test } from './fixtures'

/** Text only the Firebase Auth SDK carries, to recognize its chunk. */
const FIREBASE_AUTH_MARKER = 'identitytoolkit.googleapis.com'

/** Hosts the Firebase SDK talks to (Auth, Firestore, App Check, the Auth iframe). */
const FIREBASE_HOSTS =
  /^https:\/\/([a-z0-9-]+\.googleapis\.com|apis\.google\.com|[a-z0-9-]+\.firebaseapp\.com|www\.google\.com\/recaptcha)/

const GUEST_PLAN = {
  prefs: {
    location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
}

/** Same-origin scripts the page has downloaded so far, with their bodies. */
function trackScripts(page: Page, origin: string) {
  const scripts: Promise<{ url: string; body: Buffer }>[] = []
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.url().startsWith(origin)) {
      // Read now: a body is gone once its page has been replaced.
      scripts.push(response.body().then(body => ({ url: response.url(), body })))
    }
  })
  return {
    async includes(text: string) {
      return (await Promise.all(scripts)).some(({ body }) => body.includes(text))
    },
  }
}

test.beforeEach(async ({ page, network }) => {
  // Registered after the network fixture, so it answers before that blocks it.
  void network
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await page.addInitScript(() => {
    localStorage.setItem('solara.analytics-consent.v1', 'declined')
  })
  // The fixture forecast's day (tests/harness/clock.ts).
  await startClock(page)
})

test('a guest never downloads Firebase, on setup or on the dashboard', async ({
  page,
  network,
  baseURL,
}) => {
  const scripts = trackScripts(page, baseURL!)

  await page.goto('/app/')
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  await page.evaluate(
    plan => localStorage.setItem('solara_guest', JSON.stringify(plan)),
    GUEST_PLAN,
  )
  await page.reload()
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  expect(await scripts.includes(FIREBASE_AUTH_MARKER)).toBe(false)
  const urls = network.requests.map(request => request.url())
  expect(urls.filter(url => FIREBASE_HOSTS.test(url))).toEqual([])
  expect(await network.cspViolations()).toEqual([])
})

test('reaching for "Sign in" loads Firebase, still without App Check', async ({
  page,
  network,
  baseURL,
}) => {
  await page.addInitScript(
    plan => localStorage.setItem('solara_guest', JSON.stringify(plan)),
    GUEST_PLAN,
  )
  const scripts = trackScripts(page, baseURL!)
  await page.goto('/app/')
  await expect(page.getByRole('group', { name: 'UV forecast by hour' })).toBeVisible()
  expect(await scripts.includes(FIREBASE_AUTH_MARKER)).toBe(false)

  await page.getByRole('button', { name: 'Sign in' }).hover()
  await expect.poll(() => scripts.includes(FIREBASE_AUTH_MARKER)).toBe(true)

  // App Check (reCAPTCHA) still waits for an actual sign-in.
  await page.waitForLoadState('networkidle')
  expect(network.to('https://www.google.com/recaptcha')).toEqual([])
  expect(network.to('https://content-firebaseappcheck.googleapis.com')).toEqual([])
})

test('a stored session loads Firebase at start-up', async ({ page, baseURL }) => {
  await restoreSession(page)
  const scripts = trackScripts(page, baseURL!)
  await page.goto('/app/')
  await expect.poll(() => scripts.includes(FIREBASE_AUTH_MARKER)).toBe(true)
})

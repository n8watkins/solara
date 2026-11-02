import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { HARNESS_NOW_MS, startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// The place that follows the phone (ROADMAP item 54) on the real export, as a returning
// guest whose home is Los Angeles, with the device's position mocked: far away with
// location permission already granted (the banner, Switch, everything follows, Back to
// home), near home (nothing), permission not granted or denied (nothing on load, and
// "Use my location" asks only when tapped), and "Not now" (quiet for a day). The place
// menu by keyboard, with the names a screen reader hears. English and Spanish.

const LOS_ANGELES = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}
const SAN_DIEGO = { lat: 32.72, lon: -117.16, city: 'San Diego', region: 'California' }
const MADRID = { latitude: 40.4168, longitude: -3.7038 }
const SANTA_MONICA = { latitude: 34.0195, longitude: -118.4912 }

function guestRecord(savedLocations: object[] = []) {
  return JSON.stringify({
    prefs: {
      location: LOS_ANGELES,
      savedLocations,
      skinType: 'fair',
      activities: [],
      onboardingComplete: true,
    },
    since: '2026-06-01',
  })
}

/** What the page asked for: forecast positions, place lookups and position reads. */
interface Seen {
  forecasts: string[]
  lookups: URL[]
}

async function openAsGuest(
  page: Page,
  { saved = [] as object[], at = HARNESS_NOW_MS, permission = null as 'denied' | null } = {},
): Promise<Seen> {
  const seen: Seen = { forecasts: [], lookups: [] }
  await page.route('https://api.open-meteo.com/**', route => {
    const url = new URL(route.request().url())
    seen.forecasts.push(`${url.searchParams.get('latitude')},${url.searchParams.get('longitude')}`)
    return route.fulfill({ json: buildRawForecast() })
  })
  await page.route('https://nominatim.openstreetmap.org/**', route => {
    const url = new URL(route.request().url())
    seen.lookups.push(url)
    const spanish = url.searchParams.get('accept-language') === 'es'
    return route.fulfill({
      json: {
        address: { city: 'Madrid', state: spanish ? 'Comunidad de Madrid' : 'Community of Madrid' },
      },
    })
  })
  await page.addInitScript(
    ({ guest, permission }) => {
      if (!localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', guest)
      localStorage.setItem('solara.analytics-consent.v1', 'declined')
      // Counts every read of the position, to prove nothing asks on load.
      const geo = navigator.geolocation
      const read = geo.getCurrentPosition.bind(geo)
      ;(window as unknown as { positionReads: number }).positionReads = 0
      geo.getCurrentPosition = (...args) => {
        ;(window as unknown as { positionReads: number }).positionReads++
        return read(...args)
      }
      if (permission) {
        const query = navigator.permissions.query.bind(navigator.permissions)
        navigator.permissions.query = descriptor =>
          descriptor.name === 'geolocation'
            ? Promise.resolve({ state: permission } as PermissionStatus)
            : query(descriptor)
      }
    },
    { guest: guestRecord(saved), permission },
  )
  await startClock(page, at)
  await page.goto('/app/')
  await expect(page.getByTestId('header-place-name')).toHaveText('Los Angeles')
  return seen
}

/** Lets the check run (it starts 2 seconds after the dashboard shows) and settle. */
async function afterTheCheck(page: Page) {
  await page.clock.runFor(3000)
  await page.waitForTimeout(500)
}

const positionReads = (page: Page) =>
  page.evaluate(() => (window as unknown as { positionReads: number }).positionReads)

async function allow(context: BrowserContext, where: { latitude: number; longitude: number }) {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation(where)
}

const LANGUAGES = [
  {
    code: 'en',
    locale: 'en-US',
    banner: 'You seem to be in Madrid. Show UV here?',
    switch: 'Switch',
    notNow: 'Not now',
    visiting: 'Visiting Madrid, home is Los Angeles',
    back: 'Back to Los Angeles',
    places: 'Places',
    showing: /Showing/,
    setHome: 'Set as home',
    useMyLocation: 'Use my location',
    denied: 'Location denied.',
  },
  {
    code: 'es',
    locale: 'es-MX',
    banner: 'Parece que estás en Madrid. ¿Mostrar el UV de aquí?',
    switch: 'Cambiar',
    notNow: 'Ahora no',
    visiting: 'De visita en Madrid, tu casa es Los Angeles',
    back: 'Volver a Los Angeles',
    places: 'Lugares',
    showing: /Mostrando/,
    setHome: 'Usar como casa',
    useMyLocation: 'Usar mi ubicación',
    denied: 'Ubicación denegada.',
  },
] as const

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test.use({ locale: lang.locale })

    test('far away: the banner, Switch, everything follows, then back home', async ({
      page,
      context,
    }) => {
      await allow(context, MADRID)
      const seen = await openAsGuest(page)
      const banner = page.getByTestId('travel-banner')
      await expect(banner).toHaveText(new RegExp(lang.banner.replace(/[?¿.]/g, '\\$&')))
      await expect(banner).toHaveAttribute('role', 'status')
      // The lookup asked for the place's name in the page's language, rounded.
      expect(seen.lookups).toHaveLength(1)
      expect(seen.lookups[0]!.searchParams.get('accept-language')).toBe(lang.code)
      expect(seen.lookups[0]!.searchParams.get('lat')).toBe('40.42')
      expect(seen.lookups[0]!.searchParams.get('lon')).toBe('-3.70')

      await banner.getByRole('button', { name: lang.switch }).click()
      await expect(banner).toHaveCount(0)
      const place = page.getByRole('button', { name: lang.visiting })
      await expect(place).toBeVisible()
      await expect(place).toHaveAttribute('data-visiting', 'true')
      // The forecast is now Madrid's.
      await expect.poll(() => seen.forecasts.at(-1)).toBe('40.42,-3.7')

      // A reload keeps the visit; home is untouched in the plan.
      await page.reload()
      await expect(page.getByRole('button', { name: lang.visiting })).toBeVisible()
      const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('solara_guest')!))
      expect(plan.prefs.location.city).toBe('Los Angeles')
      // The device's position itself is stored nowhere.
      const stored = await page.evaluate(() => JSON.stringify(localStorage))
      expect(stored).not.toContain('40.4168')
      expect(stored).not.toContain('-3.7038')

      // The menu: Back to home ends the visit.
      await page.getByRole('button', { name: lang.visiting }).click()
      const menu = page.getByRole('dialog', { name: lang.places })
      await expect(menu).toBeVisible()
      await menu.getByRole('button', { name: lang.back }).click()
      await expect(menu).toHaveCount(0)
      await expect(page.getByTestId('header-place-name')).toHaveText('Los Angeles')
      await expect(page.getByRole('button', { name: lang.visiting })).toHaveCount(0)
      await expect.poll(() => seen.forecasts.at(-1)).toBe('34.05,-118.24')
    })

    test('the place menu by keyboard, with what a screen reader hears', async ({ page }) => {
      await openAsGuest(page, { saved: [SAN_DIEGO] })
      const trigger = page.getByRole('button', { name: 'Los Angeles' })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const menu = page.getByRole('dialog', { name: lang.places })
      await expect(menu).toBeVisible()
      // Focus starts on the first place, home, which is the one shown.
      const home = menu.getByRole('button', { name: /^Los Angeles/ })
      await expect(home).toBeFocused()
      await expect(home).toHaveAttribute('aria-current', 'true')
      await expect(home).toHaveAccessibleName(lang.showing)
      // Tab reaches San Diego; Enter shows it as a visit.
      await page.keyboard.press('Tab')
      const sanDiego = menu.getByRole('button', { name: /^San Diego/ })
      await expect(sanDiego).toBeFocused()
      await expect(sanDiego).not.toHaveAttribute('aria-current')
      await page.keyboard.press('Enter')
      await expect(menu).toHaveCount(0)
      const visiting = page.getByRole('button', {
        name: lang.visiting.replace('Madrid', 'San Diego'),
      })
      await expect(visiting).toBeFocused()

      // Open again: "Back to Los Angeles" comes first, then the places; Escape closes.
      await page.keyboard.press('Enter')
      await expect(menu.getByRole('button', { name: lang.back })).toBeFocused()
      await expect(menu.getByRole('button', { name: /^San Diego/ })).toHaveAttribute(
        'aria-current',
        'true',
      )
      await expect(menu.getByRole('button', { name: lang.setHome })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(visiting).toBeFocused()

      // Set as home: San Diego becomes home, Los Angeles stays a saved place.
      await visiting.click()
      await menu.getByRole('button', { name: lang.setHome }).click()
      await expect(page.getByTestId('header-place-name')).toHaveText('San Diego')
      await expect(page.locator('[data-visiting]')).toHaveCount(0)
      const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('solara_guest')!))
      expect(plan.prefs.location.city).toBe('San Diego')
      expect(plan.prefs.savedLocations.map((p: { city: string }) => p.city)).toEqual([
        'Los Angeles',
      ])
    })
  })
}

test('near home: no banner and no lookup', async ({ page, context }) => {
  await allow(context, SANTA_MONICA)
  const seen = await openAsGuest(page)
  await afterTheCheck(page)
  expect(await positionReads(page)).toBe(1)
  await expect(page.getByTestId('travel-banner')).toHaveCount(0)
  expect(seen.lookups).toHaveLength(0)
})

test('near a saved place: offers it by its saved name, without a lookup', async ({
  page,
  context,
}) => {
  await allow(context, { latitude: 32.75, longitude: -117.1 })
  const seen = await openAsGuest(page, { saved: [SAN_DIEGO] })
  await expect(page.getByTestId('travel-banner')).toContainText('You seem to be in San Diego.')
  expect(seen.lookups).toHaveLength(0)
})

for (const permission of ['not yet asked', 'denied'] as const) {
  test(`permission ${permission}: nothing on load, "Use my location" asks only on tap`, async ({
    page,
  }) => {
    const seen = await openAsGuest(page, {
      permission: permission === 'denied' ? 'denied' : null,
    })
    await afterTheCheck(page)
    expect(await positionReads(page)).toBe(0)
    await expect(page.getByTestId('travel-banner')).toHaveCount(0)
    expect(seen.lookups).toHaveLength(0)

    await page.getByRole('button', { name: 'Los Angeles' }).click()
    const menu = page.getByRole('dialog', { name: 'Places' })
    await menu.getByRole('button', { name: 'Use my location' }).click()
    // Playwright grants nothing here, so the browser refuses: the menu says so.
    await expect(menu.getByRole('alert')).toHaveText('Location denied.')
    expect(await positionReads(page)).toBe(1)
    await expect(page.getByTestId('header-place-name')).toHaveText('Los Angeles')
  })
}

test('"Not now": quiet for that area for a day, then asks again', async ({ page, context }) => {
  await allow(context, MADRID)
  await openAsGuest(page)
  const banner = page.getByTestId('travel-banner')
  await banner.getByRole('button', { name: 'Not now' }).click()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('header-place-name')).toHaveText('Los Angeles')

  // The same day: nothing after a reload. Only the area is kept, at one decimal.
  await page.reload()
  await afterTheCheck(page)
  await expect(banner).toHaveCount(0)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('solara_travel')!))
  expect(kept).toMatchObject({ owner: 'guest', visit: null, notNow: [{ lat: 40.4, lon: -3.7 }] })

  // The next day it asks again.
  const tomorrow = await context.newPage()
  await openAsGuest(tomorrow, { at: HARNESS_NOW_MS + 25 * 60 * 60 * 1000 })
  await expect(tomorrow.getByTestId('travel-banner')).toContainText('You seem to be in Madrid.')
})

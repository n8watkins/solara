// Shared fixtures for the signed-in e2e suite.
//
// - Network: Open-Meteo and Nominatim answer from fixtures, and any other request
//   that would leave the machine fails the test. Only the test server, which also
//   fronts the emulators, is reachable.
// - Clock: every page starts at the UI harness's frozen instant (tests/harness/clock.ts).
// - Accounts: each test gets its own Auth emulator user, so tests stay independent
//   and can run in parallel against one set of emulators. Seeding uses the
//   emulators' admin REST APIs (`Bearer owner` bypasses security rules), the way the
//   server writes billing state in production.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test as base } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { buildRawForecast } from '../../harness/fixtures'
import { startClock } from '../../harness/clock'

function emulatorEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Run the suite with npm run test:e2e:signed-in.`)
  return value
}

/** Local stand-in for Google's API loader; see the file for why sign-in needs it. */
const FAKE_GAPI = readFileSync('tests/e2e/signed-in/fake-gapi.js', 'utf8')

const PROJECT = emulatorEnv('SIGNED_IN_PROJECT')
const AUTH_URL = `http://127.0.0.1:${emulatorEnv('SIGNED_IN_AUTH_PORT')}/identitytoolkit.googleapis.com`
const FIRESTORE_API = `http://127.0.0.1:${emulatorEnv('SIGNED_IN_FIRESTORE_PORT')}/v1/projects/${PROJECT}/databases/(default)/documents`
/** Where the app calls the Functions emulator, relative to the test server. */
export const FUNCTIONS_PATH = `/${PROJECT}/us-central1`

const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

async function admin(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: ADMIN })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${init.method} ${url} failed: ${JSON.stringify(body)}`)
  return body
}

type FirestoreValue = Record<string, unknown>

/** A plain JSON value in the Firestore REST encoding. */
function encode(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])),
    },
  }
}

/** The plain JSON value of a Firestore REST value. */
function decode(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) {
    const { values = [] } = value.arrayValue as { values?: FirestoreValue[] }
    return values.map(decode)
  }
  if ('mapValue' in value) {
    const { fields = {} } = value.mapValue as { fields?: Record<string, FirestoreValue> }
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]))
  }
  throw new Error(`Unsupported Firestore value: ${JSON.stringify(value)}`)
}

/** The fixture location: the harness forecast is shaped for Los Angeles in June. */
export const LOS_ANGELES = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

export interface Account {
  uid: string
  email: string
  displayName: string
}

export type Tier = 'free' | 'paid'

export interface SeedActivity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number
  sunscreen: boolean
}

export const RUNNING: SeedActivity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 45,
  maxUV: 4,
  sunscreen: false,
}
export const HIKING: SeedActivity = {
  id: 'hike',
  name: 'Hiking',
  icon: '🥾',
  durationMins: 120,
  maxUV: 3,
  sunscreen: true,
}
export const TENNIS: SeedActivity = {
  id: 'tennis',
  name: 'Tennis',
  icon: '🎾',
  durationMins: 60,
  maxUV: 4,
  sunscreen: true,
}

export interface SeedProfile {
  id: string
  name: string
  skinType: string
  icon?: string
}

export interface SeedOptions {
  tier?: Tier
  activities?: SeedActivity[]
  profiles?: SeedProfile[]
  activeProfileId?: string
  /** Written by a newer client: a later schema version and fields this one does not know. */
  newerClient?: { schemaVersion: number; fields: Record<string, unknown> }
}

/** A saved account document, as the app writes it after onboarding. */
export function accountPrefs(
  uid: string,
  { tier = 'free', activities = [], profiles, activeProfileId, newerClient }: SeedOptions = {},
) {
  return {
    uid,
    schemaVersion: 2,
    location: LOS_ANGELES,
    savedLocations: [],
    skinType: 'fair',
    sunscreen: false,
    activities,
    tier,
    onboardingComplete: true,
    hiddenActivitySuggestionIds: [],
    collapsedActivityCategories: [],
    notificationHour: 7,
    ...(profiles && { profiles }),
    ...(activeProfileId && { activeProfileId }),
    ...(newerClient && { ...newerClient.fields, schemaVersion: newerClient.schemaVersion }),
  }
}

export class Emulators {
  /**
   * Creates a Google account in the Auth emulator, the way a first Google sign-in
   * would, so the emulator's sign-in page lists it. The emulator accepts an unsigned
   * ID token for its fake Google provider.
   */
  async createAccount(name: string): Promise<Account> {
    const id = randomUUID().slice(0, 8)
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${id}@example.com`
    const idToken = JSON.stringify({ sub: `google-${id}`, email, email_verified: true, name })
    const body = (await admin(`${AUTH_URL}/v1/accounts:signInWithIdp?key=demo-api-key`, {
      method: 'POST',
      body: JSON.stringify({
        postBody: new URLSearchParams({ id_token: idToken, providerId: 'google.com' }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    })) as { localId: string }
    return { uid: body.localId, email, displayName: name }
  }

  /** Writes the account's saved preferences, as onboarding and billing would. */
  async seedPrefs(account: Account, options: SeedOptions = {}) {
    const { fields } = encode(accountPrefs(account.uid, options)).mapValue as {
      fields: Record<string, FirestoreValue>
    }
    await admin(`${FIRESTORE_API}/users/${account.uid}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    })
  }

  /** Changes the plan server-side, as the Stripe webhook does after checkout. */
  async setTier(account: Account, tier: Tier) {
    await admin(`${FIRESTORE_API}/users/${account.uid}?updateMask.fieldPaths=tier`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { tier: encode(tier) } }),
    })
  }

  /** The account document as stored, or null. */
  async readPrefs(account: Account): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${FIRESTORE_API}/users/${account.uid}`, { headers: ADMIN })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Reading users/${account.uid} failed: ${response.status}`)
    const { fields = {} } = (await response.json()) as { fields?: Record<string, FirestoreValue> }
    return decode({ mapValue: { fields } }) as Record<string, unknown>
  }
}

const EMULATOR_WIDGET_ASSETS = [
  'https://unpkg.com/material-components-web@',
  'https://fonts.googleapis.com/',
]

/** Whether a request comes from one of the Auth emulator's own pages. */
function fromEmulatorPage(route: Route): boolean {
  try {
    return new URL(route.request().frame().url()).pathname.startsWith('/emulator/')
  } catch {
    return false
  }
}

/** Requests that may leave the test server, and the fixture each one gets. */
async function stubNetwork(page: Page, origin: string, blocked: string[]): Promise<void> {
  await page.context().route(
    url => url.origin !== origin,
    async route => {
      const url = new URL(route.request().url())
      if (url.origin === 'https://api.open-meteo.com') {
        await route.fulfill({ json: buildRawForecast() })
        return
      }
      if (url.origin === 'https://geocoding-api.open-meteo.com') {
        await route.fulfill({
          json: {
            results: [
              {
                name: 'Los Angeles',
                admin1: 'California',
                country: 'United States',
                country_code: 'US',
                latitude: LOS_ANGELES.lat,
                longitude: LOS_ANGELES.lon,
                timezone: LOS_ANGELES.timezone,
              },
            ],
          },
        })
        return
      }
      if (url.origin === 'https://apis.google.com' && url.pathname === '/js/api.js') {
        // Popup sign-in loads Google's API loader even against the Auth emulator.
        await route.fulfill({ contentType: 'text/javascript', body: FAKE_GAPI })
        return
      }
      if (
        EMULATOR_WIDGET_ASSETS.some(prefix => url.href.startsWith(prefix)) &&
        fromEmulatorPage(route)
      ) {
        // The Auth emulator's sign-in page styles itself from CDNs; it works without.
        await route.fulfill({
          contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css',
          body: '',
        })
        return
      }
      if (url.origin === 'https://nominatim.openstreetmap.org') {
        await route.fulfill({
          json: { address: { city: 'Los Angeles', state: 'California', country_code: 'us' } },
        })
        return
      }
      if (url.protocol === 'data:' || url.protocol === 'blob:') {
        await route.continue()
        return
      }
      blocked.push(`${route.request().method()} ${url.href}`)
      await route.abort('blockedbyclient')
    },
  )
}

export const test = base.extend<{ emulators: Emulators; blockedRequests: string[] }>({
  emulators: async ({}, provide) => {
    await provide(new Emulators())
  },
  // Automatic: stub the network and freeze the clock before the test opens a page.
  blockedRequests: [
    async ({ page, baseURL }, provide) => {
      const blocked: string[] = []
      await stubNetwork(page, new URL(baseURL!).origin, blocked)
      await startClock(page)
      await provide(blocked)
      expect(blocked, 'requests that tried to leave the machine').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
export type { Page }

/**
 * Signs in through the app's own flow: setup (location and skin type), then
 * "Continue with Google", which opens the Auth emulator's stand-in for Google's
 * sign-in page in a popup. Resolves once the popup has closed.
 */
export async function signIn(
  page: Page,
  account: Account,
  { skinType = 'Fair' }: { skinType?: string } = {},
): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /Get started/ }).click()
  await page.getByLabel('City or location').fill('Los Angeles')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText('UV index right now in')).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Your skin type' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${skinType}`) }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  const popupOpened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  const popup = await popupOpened
  const popupClosed = popup.waitForEvent('close')
  await popup.getByText(account.email, { exact: true }).click()
  await popupClosed
}

/** The dashboard's hourly UV strip, present once the forecast has rendered. */
export function uvStrip(page: Page) {
  return page.getByRole('group', { name: 'UV forecast by hour' })
}

/**
 * Signs a returning account in and opens its dashboard.
 *
 * Signing in from setup currently shows the setup answers instead of the saved
 * account until the next page load (see onboarding.e2e.ts), so this reloads once
 * after sign-in, as a returning user would see after any refresh.
 */
export async function openDashboard(page: Page, account: Account): Promise<void> {
  await signIn(page, account)
  await expect(uvStrip(page)).toBeVisible()
  await page.reload()
  await expect(uvStrip(page)).toBeVisible()
}

/** Opens the account menu and picks an item. */
export async function accountMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page
    .getByRole('menu', { name: 'Account menu' })
    .getByRole('menuitem', { name: item })
    .click()
}

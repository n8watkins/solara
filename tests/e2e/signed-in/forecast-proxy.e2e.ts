// The forecast proxy Function in the emulator: App Check, the request check, the
// commercial API call with the key, and the per-place-and-hour cache in Firestore. The
// commercial API is a local stand-in (fake-open-meteo.mjs).
import { randomUUID } from 'node:crypto'
import { expect, FIRESTORE_API, FUNCTIONS_PATH, test } from './fixtures'

const openMeteo = process.env.OPEN_METEO_API_BASE!.replace(/\/v1\/forecast$/, '')
// The emulator build's local App Check tokens (tests/e2e/signed-in/emulator-app-check.js).
const appCheck = () => ({ 'X-Firebase-AppCheck': `solara-firebase-emulators.${randomUUID()}` })

/** The calls the stand-in received for one longitude (tests run in parallel). */
async function upstreamCalls(longitude: string): Promise<Array<Record<string, string>>> {
  const calls = (await (await fetch(`${openMeteo}/__test/calls`)).json()) as Array<
    Record<string, string>
  >
  return calls.filter(call => call.longitude === longitude)
}

test('serves the commercial forecast once per place and hour, behind App Check', async ({
  request,
}) => {
  // A place no other test asks for, so the cache starts empty, on the proxy's 0.02
  // degree grid (even hundredths), so the place it asks upstream for is this one.
  const lat = ((Math.floor(Math.random() * 4000) * 2) / 100 - 40).toFixed(2)
  const lon = '12.34'
  // A third decimal the proxy rounds away.
  const path = `${FUNCTIONS_PATH}/forecast?lat=${lat}1&lon=${lon}`

  const refused = await request.get(path)
  expect(refused.status()).toBe(401)
  expect(await refused.json()).toMatchObject({ code: 'app-check-required' })

  const first = await request.get(path, { headers: appCheck() })
  expect(first.status()).toBe(200)
  const body = (await first.json()) as { hourly: { uv_index: number[] } }
  expect(body.hourly.uv_index).toEqual([7.2, 6.1])

  // The proxy asked the commercial API with the key, for the rounded place only.
  const calls = await upstreamCalls(lon)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    apikey: 'e2e-open-meteo-key',
    latitude: String(Number(lat)),
    longitude: lon,
    forecast_days: '10',
    timezone: 'auto',
  })

  // Asked again (any instance), it answers from the cache.
  const second = await request.get(path, { headers: appCheck() })
  expect(second.status()).toBe(200)
  expect(await upstreamCalls(lon)).toHaveLength(1)

  const cached = await fetch(`${FIRESTORE_API}/forecastCache/${Number(lat).toFixed(2)}_${lon}`, {
    headers: { Authorization: 'Bearer owner' },
  })
  expect(cached.status).toBe(200)
  const { fields } = (await cached.json()) as { fields: Record<string, unknown> }
  expect(Object.keys(fields).sort()).toEqual(['expireAt', 'fetchedAt', 'hour', 'payload'])

  // The call was counted in the global upstream budget.
  const day = new Date().toISOString().slice(0, 10)
  const budget = await fetch(`${FIRESTORE_API}/forecastUpstream/day-${day}`, {
    headers: { Authorization: 'Bearer owner' },
  })
  expect(budget.status).toBe(200)
  const counter = (await budget.json()) as { fields: { count: { integerValue: string } } }
  expect(Number(counter.fields.count.integerValue)).toBeGreaterThanOrEqual(1)
})

test('refuses a malformed place before calling anyone', async ({ request }) => {
  const response = await request.get(`${FUNCTIONS_PATH}/forecast?lat=north&lon=97.13`, {
    headers: appCheck(),
  })
  expect(response.status()).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'invalid-argument' })
  expect(await upstreamCalls('97.13')).toEqual([])
})

// Sentry error reporting (decision D10), in a production build that has a (fake)
// NEXT_PUBLIC_SENTRY_DSN: errors reach the DSN's ingest host with personal data
// scrubbed, within the Content-Security-Policy, and nothing is sent without an error.
import type { Page } from '@playwright/test'
import { FAKE, SENTRY_INGEST } from './fake-config'
import { envelopeItems, expect, test, TEST_USER } from './fixtures'

// A JWT-shaped fake, assembled so secret scanners do not mistake it for a real token.
const JWT_PARTS = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTEifQ', 'c2lnbmF0dXJlLXNpZ25hdHVyZQ']
const JWT = JWT_PARTS.join('.')
const MESSAGE = `Solara e2e failure for ${TEST_USER.email} (${TEST_USER.uid}) with ${JWT} at lat=37.77 lon=-122.42`
const SECRETS = [TEST_USER.email, TEST_USER.uid, JWT, '37.77', '122.42', 'lat=37', 'secret-share']

/** Waits until the page has loaded and started the Sentry SDK (it loads when idle). */
async function sentryStarted(page: Page) {
  await expect
    .poll(() => page.evaluate(() => '__SENTRY__' in globalThis), { timeout: 15_000 })
    .toBe(true)
}

/** The error events in the envelopes sent to the ingest host. */
function sentEvents(bodies: string[]) {
  return bodies.flatMap(body =>
    envelopeItems(body)
      .filter(item => item.type === 'event')
      .map(item => item.payload),
  )
}

test('sends nothing to Sentry while there is no error', async ({ page, network }) => {
  await page.goto('/privacy/')
  await sentryStarted(page)
  await page.waitForLoadState('networkidle')
  expect(network.to(SENTRY_INGEST)).toEqual([])
  expect(await network.cspViolations()).toEqual([])
})

test('reports an uncaught error with personal data scrubbed', async ({ page, network }) => {
  await page.goto('/privacy/?lat=37.77&lon=-122.42&note=secret-share#secret-share')
  await sentryStarted(page)

  const ingest = page.waitForRequest(request => request.url().startsWith(`${SENTRY_INGEST}/`))
  await page.evaluate(message => {
    setTimeout(() => {
      throw new Error(message)
    })
  }, MESSAGE)
  const request = await ingest

  expect(new URL(request.url()).pathname).toBe('/api/22/envelope/')
  const body = request.postData() ?? ''
  for (const secret of SECRETS) expect(body).not.toContain(secret)

  const [event] = sentEvents([body])
  expect(event).toMatchObject({
    release: FAKE.release,
    environment: 'production',
    request: { url: expect.stringMatching(/\/privacy\/$/) },
    exception: {
      values: [
        {
          type: 'Error',
          value:
            'Solara e2e failure for [email] ([uid]) with [token] at lat=[redacted] lon=[redacted]',
          mechanism: { handled: false },
        },
      ],
    },
  })
  expect(event?.user).toBeUndefined()
  expect(event?.sdk).toMatchObject({ name: 'sentry.javascript.nextjs' })
  expect(await network.cspViolations()).toEqual([])
})

test('keeps errors from before the SDK loaded and reports them once it starts', async ({
  page,
  network,
}) => {
  // Thrown when the page has loaded (so the app's scripts have run) but before the
  // SDK, which loads once the page is idle afterwards.
  await page.addInitScript(message => {
    window.addEventListener('load', () => {
      throw new Error(message)
    })
  }, MESSAGE)
  await page.goto('/terms/')
  await sentryStarted(page)

  await expect
    .poll(() => sentEvents(network.to(SENTRY_INGEST).map(r => r.postData() ?? '')))
    .toEqual([
      expect.objectContaining({
        tags: expect.objectContaining({ source: 'early-onerror' }),
        exception: {
          values: [
            expect.objectContaining({
              value:
                'Solara e2e failure for [email] ([uid]) with [token] at lat=[redacted] lon=[redacted]',
            }),
          ],
        },
      }),
    ])
  for (const request of network.to(SENTRY_INGEST)) {
    for (const secret of SECRETS) expect(request.postData() ?? '').not.toContain(secret)
  }
})

// App Check with reCAPTCHA v3 (decision D11), in a production build that has a
// (fake) NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: signed-out pages never load
// reCAPTCHA, and signing in starts App Check, which loads reCAPTCHA and exchanges
// its token for an App Check token, within the Content-Security-Policy.
import {
  APP_CHECK_EXCHANGE,
  expect,
  FAKE_APP_CHECK_TOKEN,
  FAKE_RECAPTCHA_TOKEN,
  RECAPTCHA_SCRIPT,
  restoreSession,
  test,
} from './fixtures'

const RECAPTCHA_HOSTS =
  /^https:\/\/(www\.google\.com\/recaptcha|www\.gstatic\.com\/recaptcha|recaptcha\.google\.com)/

test('signed-out pages make no reCAPTCHA or App Check requests', async ({ page, network }) => {
  for (const path of ['/', '/privacy/', '/terms/', '/account/', '/share/']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  const thirdParty = network.requests.map(request => request.url())
  expect(thirdParty.filter(url => RECAPTCHA_HOSTS.test(url))).toEqual([])
  expect(network.to('https://content-firebaseappcheck.googleapis.com')).toEqual([])
  await expect(page.locator('script[src*="recaptcha"]')).toHaveCount(0)
  expect(await network.cspViolations()).toEqual([])
})

test('signing in starts App Check: reCAPTCHA v3 loads and its token is exchanged', async ({
  page,
  network,
}) => {
  await restoreSession(page)
  await page.goto('/')

  await expect.poll(() => network.to(APP_CHECK_EXCHANGE).length).toBeGreaterThan(0)

  // reCAPTCHA loads only after Auth has restored the session.
  const urls = network.requests.map(request => request.url())
  const lookup = urls.findIndex(url => new URL(url).hostname === 'identitytoolkit.googleapis.com')
  const script = urls.findIndex(url => url.startsWith(RECAPTCHA_SCRIPT))
  expect(lookup).toBeGreaterThanOrEqual(0)
  expect(script).toBeGreaterThan(lookup)

  const [exchange] = network.to(APP_CHECK_EXCHANGE)
  expect(exchange?.method()).toBe('POST')
  expect(exchange?.postDataJSON()).toMatchObject({ recaptcha_v3_token: FAKE_RECAPTCHA_TOKEN })

  // Firestore sends the App Check token from its first request on, so enforcing App
  // Check for Firestore does not lock signed-in users out. (Its WebChannel transport
  // carries headers in the request body.)
  await expect.poll(() => network.to('https://firestore.googleapis.com').length).toBeGreaterThan(0)
  const [firstFirestore] = network.to('https://firestore.googleapis.com')
  expect(decodeURIComponent(firstFirestore?.postData() ?? '')).toContain(
    `x-firebase-appcheck:${FAKE_APP_CHECK_TOKEN}`,
  )

  // The invisible widget Firebase renders stays hidden: no badge or frame on screen.
  await expect(page.locator('#fire_app_check_\\[DEFAULT\\]')).toBeHidden()
  expect(await network.cspViolations()).toEqual([])
})

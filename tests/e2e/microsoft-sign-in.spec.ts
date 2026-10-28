import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page, Route } from '@playwright/test'

// The Outlook sign-in popup against what ships (REVIEW7 M1): the real sign-in code
// (lib/microsoft-auth.ts) in a page of the export and the real redirect page
// (/auth/microsoft/), both served by the Hosting emulator with firebase.json's headers.
// Solara's own Cross-Origin-Opener-Policy severs the opener's handle on the popup the
// moment the redirect page loads, so `popup.closed` reads true before the page has
// handed the code back; the hand-back must not wait for anything else on the page.
//
// Microsoft's authorize page and token endpoint are answered here: the authorize page
// commits on Microsoft's origin (no opener policy, as a sign-in page) and then sends the
// popup back with a code, as after a real sign-in. Runs in Chromium, Firefox and WebKit
// (playwright.config.ts), since each engine applies the opener policy in its own way.

const LOGIN = 'https://login.microsoftonline.com'
const SCOPE = 'https://graph.microsoft.com/Calendars.ReadBasic'

/** lib/microsoft-auth.ts as a script that leaves its exports on `window.__microsoftAuth`. */
const AUTH_SCRIPT = `(() => {
  const exports = {}
  const process = { env: {} }
  ${
    ts.transpileModule(readFileSync('lib/microsoft-auth.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  }
  window.__microsoftAuth = exports
})()`

/** How the fake Microsoft page behaves: sends the popup back, or waits to be closed. */
type Outcome = 'consent' | 'stay'

async function fakeMicrosoft(context: BrowserContext, outcome: Outcome) {
  const redeemed: URLSearchParams[] = []
  await context.route(`${LOGIN}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/authorize')) {
      const back = new URL(url.searchParams.get('redirect_uri') ?? 'about:blank')
      back.searchParams.set('code', 'fake-code-1')
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      const script =
        outcome === 'consent'
          ? `<script>setTimeout(() => location.replace(${JSON.stringify(back.href)}), 300)</script>`
          : ''
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Sign in to your account</title><p>Fake Microsoft sign-in</p>${script}`,
      })
      return
    }
    redeemed.push(new URLSearchParams(request.postData() ?? ''))
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': (await request.allHeaders()).origin ?? '*' },
      json: { token_type: 'Bearer', expires_in: 3599, access_token: 'fake-graph-token' },
    })
  })
  return redeemed
}

/**
 * Opens a page of the export as the app's window, with the sign-in code loaded, and a
 * button that starts a sign-in (a popup needs a click). The outcome lands in
 * `window.__outcome`: the token, or `error:<reason>`.
 */
async function openApp(page: Page) {
  await page.goto('/privacy/')
  // Evaluated by the test, so the page's own Content-Security-Policy is not loosened.
  await page.evaluate(AUTH_SCRIPT)
  await page.evaluate(() => {
    type Auth = {
      createMicrosoftAuth(deps: unknown): {
        requestToken(scope: string, options: { interactive: boolean }): Promise<string>
      }
      MICROSOFT_REDIRECT_PATH: string
    }
    const exported = (window as unknown as { __microsoftAuth: Auth }).__microsoftAuth
    const auth = exported.createMicrosoftAuth({
      clientId: 'fake-client-id',
      redirectUri: `${location.origin}${exported.MICROSOFT_REDIRECT_PATH}`,
      open: (url: string) =>
        window.open(url, 'solara-microsoft-sign-in', 'popup,width=480,height=640'),
      channel: (name: string) => new BroadcastChannel(name),
      fetch: (url: string, init: RequestInit) => fetch(url, init),
      now: () => Date.now(),
    })
    const button = document.createElement('button')
    button.textContent = 'Sign in to Microsoft'
    button.addEventListener('click', () => {
      auth
        .requestToken('https://graph.microsoft.com/Calendars.ReadBasic', { interactive: true })
        .then(
          token => ((window as unknown as { __outcome: string }).__outcome = token),
          (error: { reason?: string }) =>
            ((window as unknown as { __outcome: string }).__outcome = `error:${error.reason}`),
        )
    })
    document.body.prepend(button)
  })
}

const outcome = (page: Page) =>
  page.evaluate(() => (window as unknown as { __outcome?: string }).__outcome ?? null)

test('the code is handed back even when the redirect page’s styles are slow', async ({
  page,
  context,
}) => {
  const redeemed = await fakeMicrosoft(context, 'consent')
  await openApp(page)
  // A cold cache on a slow network (or a deploy since the app was loaded): every
  // stylesheet and font takes 4 s, far longer than the opener waits after `closed`.
  await context.route(/\.(css|woff2)(\?|$)/, async route => {
    await new Promise(resolve => setTimeout(resolve, 4_000))
    await route.continue().catch(() => {})
  })

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in to Microsoft' }).click()
  const popup = await popupPromise
  // The redirect page's headers are what production sends, opener policy included.
  const redirect = await popup.waitForResponse(response =>
    response.url().includes('/auth/microsoft/'),
  )
  expect(redirect.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups')

  await expect.poll(() => outcome(page), { timeout: 15_000 }).toBe('fake-graph-token')
  expect(redeemed).toHaveLength(1)
  expect(redeemed[0]!.get('code')).toBe('fake-code-1')
  expect(redeemed[0]!.get('scope')).toBe(SCOPE)
  // The popup closed itself.
  await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true)
})

test('closing the popup on Microsoft’s page ends the sign-in quietly', async ({
  page,
  context,
}) => {
  const redeemed = await fakeMicrosoft(context, 'stay')
  await openApp(page)
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in to Microsoft' }).click()
  const popup = await popupPromise
  await popup.waitForURL(url => url.origin === LOGIN)
  await popup.close()
  await expect.poll(() => outcome(page), { timeout: 15_000 }).toBe('error:popup_closed')
  expect(redeemed).toHaveLength(0)
})

test('the redirect page runs under its own policy without a single violation', async ({ page }) => {
  const violations: string[] = []
  page.on('console', message => {
    if (/Content.Security.Policy|Content Security Policy/i.test(message.text())) {
      violations.push(message.text())
    }
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      console.error(`Content-Security-Policy: ${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  // Opened directly (no state), so it posts nothing; it cannot close a tab it did not open.
  const response = await page.goto('/auth/microsoft/')
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
  await expect(page.getByRole('heading', { name: 'Connecting Outlook' })).toBeVisible()
  // Its own stylesheets and font still apply.
  await expect(page.locator('main')).toHaveCSS('display', 'flex')
  await page.evaluate(() => document.fonts.ready)
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(policy).toMatch(/^default-src 'none'; script-src 'sha256-[^']+' 'sha256-[^']+';/)
  expect(policy).not.toMatch(/https?:|google|recaptcha/)
  expect(violations).toEqual([])
})

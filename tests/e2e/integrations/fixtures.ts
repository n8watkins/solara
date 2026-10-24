// Fixtures for the integrations suite (playwright.config.ts in this folder).
//
// Network: every request is recorded. The test server answers same-origin requests;
// Google reCAPTCHA, Firebase App Check, Firebase Auth and Sentry ingest are answered
// by fakes; every other request that would leave the machine is blocked. A test can
// then assert exactly which third parties a page contacted, and when.
import { expect, test as base } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { FAKE, SENTRY_INGEST } from './fake-config'

/** reCAPTCHA token the fake script returns; the App Check exchange must carry it. */
export const FAKE_RECAPTCHA_TOKEN = 'fake-recaptcha-v3-token'
/** App Check token the fake exchange returns. */
export const FAKE_APP_CHECK_TOKEN = 'fake-app-check-token'

export const RECAPTCHA_SCRIPT = 'https://www.google.com/recaptcha/api.js'
export const APP_CHECK_EXCHANGE = `https://content-firebaseappcheck.googleapis.com/v1/projects/${FAKE.projectId}/apps/${FAKE.appId}:exchangeRecaptchaV3Token`
const ACCOUNT_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'

/**
 * Stand-in for Google's reCAPTCHA v3 script, implementing the calls Firebase App
 * Check makes: `ready`, an invisible `render` and `execute`, which reports success
 * through the widget's callback the way the real widget does.
 */
const FAKE_RECAPTCHA_SCRIPT = `(() => {
  const widgets = [];
  window.grecaptcha = {
    ready: callback => callback(),
    render: (container, params) => widgets.push(params) - 1,
    execute: async (widgetId, options) => {
      if (options.action !== 'fire_app_check') throw new Error('unexpected action');
      widgets[widgetId].callback('${FAKE_RECAPTCHA_TOKEN}');
      return '${FAKE_RECAPTCHA_TOKEN}';
    },
  };
})();`

export interface SignedInUser {
  uid: string
  email: string
  displayName: string
}

export const TEST_USER: SignedInUser = {
  uid: 'Xy7Qp2Lm9Rt4Vb6Nc8Zd1Fg3Hk5J',
  email: 'ada.lovelace@example.com',
  displayName: 'Ada Lovelace',
}

/**
 * Restores a signed-in session the way Firebase Auth does after a reload: the user
 * record Auth persisted in localStorage, which Auth then refreshes with an
 * `accounts:lookup` call that the network fake answers.
 */
export async function restoreSession(page: Page, user: SignedInUser = TEST_USER): Promise<void> {
  const record = {
    uid: user.uid,
    email: user.email,
    emailVerified: true,
    displayName: user.displayName,
    isAnonymous: false,
    providerData: [
      {
        providerId: 'google.com',
        uid: '1234567890',
        displayName: user.displayName,
        email: user.email,
        phoneNumber: null,
        photoURL: null,
      },
    ],
    stsTokenManager: {
      refreshToken: 'fake-refresh-token',
      accessToken: 'fake.id.token',
      expirationTime: Date.now() + 60 * 60 * 1000,
    },
    createdAt: '1700000000000',
    lastLoginAt: '1700000000000',
    apiKey: FAKE.apiKey,
    appName: '[DEFAULT]',
  }
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `firebase:authUser:${FAKE.apiKey}:[DEFAULT]`,
    JSON.stringify(record),
  ] as const)
}

export interface Network {
  /** Every request the page made, in order. */
  requests: Request[]
  /** Requests whose URL starts with `prefix`. */
  to(prefix: string): Request[]
  /** Third-party requests that were blocked because no fake answers them. */
  blocked: string[]
  /** Content-Security-Policy violations the page reported. */
  cspViolations(): Promise<string[]>
}

export const test = base.extend<{ network: Network }>({
  network: async ({ page, baseURL }, provide) => {
    const requests: Request[] = []
    const blocked: string[] = []
    page.on('request', request => requests.push(request))

    await page.addInitScript(() => {
      const violations: string[] = []
      ;(window as unknown as { __cspViolations: string[] }).__cspViolations = violations
      document.addEventListener('securitypolicyviolation', event => {
        violations.push(`${event.violatedDirective} ${event.blockedURI}`)
      })
    })

    await page.route('**/*', async route => {
      const url = route.request().url()
      if (baseURL && url.startsWith(baseURL)) return route.fallback()
      if (url.startsWith(RECAPTCHA_SCRIPT)) {
        return route.fulfill({ contentType: 'text/javascript', body: FAKE_RECAPTCHA_SCRIPT })
      }
      if (url.startsWith(APP_CHECK_EXCHANGE)) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ token: FAKE_APP_CHECK_TOKEN, ttl: '3600s' }),
        })
      }
      if (url.startsWith(ACCOUNT_LOOKUP)) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            kind: 'identitytoolkit#GetAccountInfoResponse',
            users: [
              {
                localId: TEST_USER.uid,
                email: TEST_USER.email,
                emailVerified: true,
                displayName: TEST_USER.displayName,
                providerUserInfo: [
                  {
                    providerId: 'google.com',
                    federatedId: '1234567890',
                    rawId: '1234567890',
                    email: TEST_USER.email,
                    displayName: TEST_USER.displayName,
                  },
                ],
                lastLoginAt: '1700000000000',
                createdAt: '1700000000000',
              },
            ],
          }),
        })
      }
      if (url.startsWith(`${SENTRY_INGEST}/`)) {
        return route.fulfill({ contentType: 'application/json', body: '{}' })
      }
      blocked.push(url)
      return route.abort('blockedbyclient')
    })

    await provide({
      requests,
      blocked,
      to: prefix => requests.filter(request => request.url().startsWith(prefix)),
      cspViolations: () =>
        page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations),
    })
  },
})

export { expect }

/** Items of a Sentry envelope (newline-delimited JSON: a header, then item header and payload pairs). */
export function envelopeItems(body: string): { type: string; payload: Record<string, unknown> }[] {
  const lines = body.split('\n').filter(Boolean)
  const items: { type: string; payload: Record<string, unknown> }[] = []
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const header = JSON.parse(lines[i] ?? '{}') as { type: string }
    items.push({ type: header.type, payload: JSON.parse(lines[i + 1] ?? '{}') })
  }
  return items
}

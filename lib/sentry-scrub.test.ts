import type { ErrorEvent } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'
import { redact } from '@solara/core'
import { scrubBreadcrumb, scrubEvent, scrubText, scrubValue, stripUrlQuery } from './sentry-scrub'

const EMAIL = 'ada.lovelace+solara@example.co.uk'
const UID = 'Xy7Qp2Lm9Rt4Vb6Nc8Zd1Fg3Hk5J'
// A JWT-shaped fake, assembled so secret scanners do not mistake it for a real token.
const JWT_PARTS = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTEifQ', 'c2lnbmF0dXJlLXNpZ25hdHVyZQ']
const JWT = JWT_PARTS.join('.')
const FCM = 'fcm_' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(3)
const FORECAST = 'https://api.open-meteo.com/v1/forecast?latitude=37.77&longitude=-122.42'

describe('redaction rules', () => {
  // Functions import the same redact from #core, so web reports and Function logs agree.
  it('strip every kind of sensitive value', () => {
    expect(redact(`user ${EMAIL} failed`)).toBe('user [email] failed')
    expect(redact(`fetch ${FORECAST} failed`)).toBe(
      'fetch https://api.open-meteo.com/v1/forecast?[redacted] failed',
    )
    expect(redact('at {"lat": 37.7749, "lon":-122.4194}')).not.toMatch(/37\.77|122\.41/)
    expect(redact(`token ${JWT} and ${FCM}`)).toBe('token [token] and [token]')
    expect(redact('plain message with an id abc123')).toBe('plain message with an id abc123')
  })
})

describe('scrubText', () => {
  it('removes emails, uids, tokens, URL queries and coordinates', () => {
    const text = scrubText(
      `${EMAIL} (${UID}) sent ${JWT} from ${FORECAST} at lat=37.77 lon: -122.42, token ${FCM}`,
    )
    for (const secret of [EMAIL, UID, JWT, FCM, '37.77', '122.42', 'latitude=']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('[email] ([uid])')
    expect(text).toContain('https://api.open-meteo.com/v1/forecast?[redacted]')
  })

  it('keeps ids of other lengths, such as Sentry event ids and chunk names', () => {
    const eventId = '0123456789abcdef0123456789abcdef'
    expect(scrubText(`event ${eventId} in 0cz1d0mv5g_q7.js`)).toBe(
      `event ${eventId} in 0cz1d0mv5g_q7.js`,
    )
  })
})

describe('stripUrlQuery', () => {
  it('drops the query string and fragment', () => {
    expect(stripUrlQuery('https://solara-uv.web.app/share/?a=1#b')).toBe(
      'https://solara-uv.web.app/share/',
    )
    expect(stripUrlQuery('/settings#token')).toBe('/settings')
    expect(stripUrlQuery('/plain/')).toBe('/plain/')
  })
})

describe('scrubValue', () => {
  it('replaces sensitive keys and scrubs nested strings', () => {
    expect(
      scrubValue({
        email: 'x',
        lat: 1,
        nested: [{ note: `mail ${EMAIL}`, Longitude: 2, count: 3 }],
      }),
    ).toEqual({
      email: '[redacted]',
      lat: '[redacted]',
      nested: [{ note: 'mail [email]', Longitude: '[redacted]', count: 3 }],
    })
  })

  it('stops at a fixed depth', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 12; i++) deep = { deep }
    expect(JSON.stringify(scrubValue(deep))).toContain('[truncated]')
  })
})

describe('scrubBreadcrumb', () => {
  it('strips URLs in navigation and fetch breadcrumbs and scrubs messages', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        message: `signed in as ${EMAIL}`,
        data: { url: FORECAST, method: 'GET', from: '/?a=1', to: '/share/?activity=x' },
      }),
    ).toEqual({
      category: 'fetch',
      message: 'signed in as [email]',
      data: {
        url: 'https://api.open-meteo.com/v1/forecast',
        method: 'GET',
        from: '/',
        to: '/share/',
      },
    })
  })
})

describe('scrubEvent', () => {
  const event: ErrorEvent = {
    type: undefined,
    event_id: '0123456789abcdef0123456789abcdef',
    message: `failed for ${EMAIL}`,
    user: { id: UID, email: EMAIL, ip_address: '203.0.113.9' },
    server_name: 'host',
    transaction: '/share/?activity=Run',
    request: {
      url: 'https://solara-uv.web.app/?lat=37.77&lon=-122.42',
      query_string: 'lat=37.77',
      cookies: { session: 'secret' },
      headers: { 'User-Agent': 'Chrome', Referer: 'https://solara-uv.web.app/?q=1' },
    },
    exception: {
      values: [
        {
          type: 'FirebaseError',
          value: `Missing permissions for users/${UID} (${JWT})`,
          stacktrace: {
            frames: [
              {
                filename: 'app:///_next/static/chunks/0cz1d0mv5g_q7.js?v=1',
                abs_path: 'https://solara-uv.web.app/_next/static/chunks/0cz1d0mv5g_q7.js?v=1',
                function: 'loadPrefs',
                lineno: 1,
                colno: 2,
                vars: { email: EMAIL },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [{ category: 'console', message: `user ${EMAIL}` }],
    extra: { label: 'the dashboard', token: JWT },
    tags: { source: 'error-boundary' },
    contexts: { react: { componentStack: '\n    at Dashboard' }, geo: { latitude: 37.77 } },
  }

  it('leaves no personal data anywhere in the payload', () => {
    const json = JSON.stringify(scrubEvent(event))
    for (const secret of [EMAIL, UID, JWT, '37.77', '122.42', '203.0.113.9', 'secret', '?q=1']) {
      expect(json).not.toContain(secret)
    }
  })

  it('keeps what is needed to debug: ids, stack frames, user agent and component stack', () => {
    const scrubbed = scrubEvent(event)
    expect(scrubbed.event_id).toBe(event.event_id)
    expect(scrubbed.user).toBeUndefined()
    expect(scrubbed.server_name).toBeUndefined()
    expect(scrubbed.transaction).toBe('/share/')
    expect(scrubbed.request).toEqual({
      url: 'https://solara-uv.web.app/',
      headers: { 'User-Agent': 'Chrome' },
    })
    const [value] = scrubbed.exception?.values ?? []
    expect(value?.type).toBe('FirebaseError')
    expect(value?.value).toBe('Missing permissions for users/[uid] ([token])')
    expect(value?.stacktrace?.frames).toEqual([
      {
        filename: 'app:///_next/static/chunks/0cz1d0mv5g_q7.js',
        abs_path: 'https://solara-uv.web.app/_next/static/chunks/0cz1d0mv5g_q7.js',
        function: 'loadPrefs',
        lineno: 1,
        colno: 2,
      },
    ])
    expect(scrubbed.tags).toEqual({ source: 'error-boundary' })
    expect(scrubbed.extra).toEqual({ label: 'the dashboard', token: '[redacted]' })
    expect(scrubbed.contexts?.react).toEqual({ componentStack: '\n    at Dashboard' })
  })
})

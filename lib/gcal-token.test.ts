import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The GIS token client, faked the way Google documents it: an OAuth answer (a token
// or an OAuth error) goes to `callback`; closing or blocking the popup goes only to
// `error_callback`. lib/gcal.ts reads the client ID at import, so each test imports
// a fresh copy with the ID set.

interface TokenClientConfig {
  client_id: string
  scope: string
  callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void
  error_callback?: (err: { type: string; message?: string }) => void
}

let configs: TokenClientConfig[] = []
let onRequest: (config: TokenClientConfig) => void = () => {}

async function loadGcal() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID', 'test-client.apps.googleusercontent.com')
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient(config: TokenClientConfig) {
            configs.push(config)
            return { requestAccessToken: () => onRequest(config) }
          },
        },
      },
    },
  })
  return import('@/lib/gcal')
}

beforeEach(() => {
  configs = []
  onRequest = () => {}
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('requesting a Calendar token', () => {
  it('resolves with the token and caches it for the session', async () => {
    const gcal = await loadGcal()
    onRequest = config => config.callback({ access_token: 'tok-1', expires_in: 3599 })
    await expect(gcal.requestWriteToken()).resolves.toBe('tok-1')
    expect(configs[0]!.scope).toBe(gcal.CALENDAR_BOOKING_SCOPE)
    expect(gcal.hasWriteToken()).toBe(true)
    // The cached token is reused without another popup.
    await expect(gcal.requestWriteToken({ interactive: false })).resolves.toBe('tok-1')
    expect(configs).toHaveLength(1)
  })

  it('settles when the person closes the popup, which only error_callback reports', async () => {
    const gcal = await loadGcal()
    onRequest = config => config.error_callback?.({ type: 'popup_closed' })
    const error = await gcal.requestAccessToken().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(gcal.CalendarAuthError)
    expect((error as InstanceType<typeof gcal.CalendarAuthError>).reason).toBe('popup_closed')
    expect(gcal.isConsentDismissed(error)).toBe(true)
  })

  it('reports a blocked popup as a failure, not a dismissal', async () => {
    const gcal = await loadGcal()
    onRequest = config => config.error_callback?.({ type: 'popup_failed_to_open' })
    const error = await gcal.requestWriteToken().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(gcal.CalendarAuthError)
    expect((error as InstanceType<typeof gcal.CalendarAuthError>).reason).toBe(
      'popup_failed_to_open',
    )
    expect(gcal.isConsentDismissed(error)).toBe(false)
  })

  it('reports declined consent as CalendarAuthError with the OAuth code', async () => {
    const gcal = await loadGcal()
    onRequest = config => config.callback({ error: 'access_denied' })
    const error = await gcal.requestWriteToken().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(gcal.CalendarAuthError)
    expect((error as InstanceType<typeof gcal.CalendarAuthError>).reason).toBe('access_denied')
    expect(gcal.hasWriteToken()).toBe(false)
  })

  it('gives up after the timeout when GIS never reports back, and keeps a late token', async () => {
    vi.useFakeTimers()
    const gcal = await loadGcal()
    const pending = gcal.requestWriteToken().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(gcal.TOKEN_TIMEOUT_MS)
    const error = await pending
    expect(error).toBeInstanceOf(gcal.CalendarAuthError)
    expect((error as InstanceType<typeof gcal.CalendarAuthError>).reason).toBe('timeout')

    // The popup finishes after all: the token is kept, so the next try needs no popup.
    configs[0]!.callback({ access_token: 'late', expires_in: 3599 })
    expect(gcal.hasWriteToken()).toBe(true)
    await expect(gcal.requestWriteToken({ interactive: false })).resolves.toBe('late')
  })

  it('settles when requestAccessToken itself throws', async () => {
    const gcal = await loadGcal()
    onRequest = () => {
      throw new Error('GIS exploded')
    }
    await expect(gcal.requestWriteToken()).rejects.toThrow('GIS exploded')
  })
})

describe('Google refusing a request', () => {
  function respond(status: number, body?: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
      ),
    )
  }

  async function withToken() {
    const gcal = await loadGcal()
    onRequest = config => config.callback({ access_token: 'tok', expires_in: 3599 })
    await gcal.requestWriteToken()
    return gcal
  }

  it('asks to reconnect and forgets the token on 401', async () => {
    const gcal = await withToken()
    respond(401)
    await expect(gcal.getCalendarEvent('tok', 'abc123')).rejects.toBeInstanceOf(
      gcal.CalendarAuthError,
    )
    expect(gcal.hasWriteToken()).toBe(false)
  })

  it('asks to reconnect on a 403 about the token', async () => {
    const gcal = await withToken()
    respond(403, {
      error: { code: 403, errors: [{ domain: 'global', reason: 'insufficientPermissions' }] },
    })
    await expect(gcal.getCalendarEvent('tok', 'abc123')).rejects.toBeInstanceOf(
      gcal.CalendarAuthError,
    )
    expect(gcal.hasWriteToken()).toBe(false)
  })

  it.each([
    ['global', 'rateLimitExceeded'],
    ['usageLimits', 'userRateLimitExceeded'],
    ['usageLimits', 'quotaExceeded'],
    ['usageLimits', 'accessNotConfigured'],
    ['calendar', 'forbiddenForNonOrganizer'],
  ])('keeps the token on a %s %s 403', async (domain, reason) => {
    const gcal = await withToken()
    respond(403, { error: { code: 403, errors: [{ domain, reason }] } })
    const error = await gcal.getCalendarEvent('tok', 'abc123').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(gcal.CalendarAuthError)
    expect((error as Error).message).toContain(reason)
    expect(gcal.hasWriteToken()).toBe(true)
  })

  it('treats a 403 without a readable reason as a token problem', async () => {
    const gcal = await withToken()
    respond(403, 'not json')
    await expect(gcal.getCalendarEvent('tok', 'abc123')).rejects.toBeInstanceOf(
      gcal.CalendarAuthError,
    )
  })

  it('forgets the free/busy token when Google refuses it', async () => {
    const gcal = await loadGcal()
    onRequest = config => config.callback({ access_token: 'fb', expires_in: 3599 })
    await gcal.requestAccessToken()
    respond(401)
    await expect(
      gcal.fetchFreeBusy('fb', new Date('2026-06-15T00:00:00Z'), new Date('2026-06-16T00:00:00Z')),
    ).rejects.toBeInstanceOf(gcal.CalendarAuthError)
    // The next connect asks Google again instead of reusing the refused token.
    onRequest = config => config.callback({ access_token: 'fb-2', expires_in: 3599 })
    await expect(gcal.requestAccessToken()).resolves.toBe('fb-2')
  })
})

describe('revoking Calendar access', () => {
  it('revokes with a token from this session and forgets every token', async () => {
    const gcal = await loadGcal()
    const revoked: string[] = []
    ;(
      window as unknown as { google: { accounts: { oauth2: Record<string, unknown> } } }
    ).google.accounts.oauth2.revoke = (token: string, done: () => void) => {
      revoked.push(token)
      done()
    }
    onRequest = config => config.callback({ access_token: 'read-1', expires_in: 3599 })
    const scope = 'https://www.googleapis.com/auth/calendar.events.readonly'
    await expect(gcal.requestScopeToken(scope)).resolves.toBe('read-1')
    expect(gcal.hasScopeToken(scope)).toBe(true)
    await expect(gcal.revokeCalendarAccess()).resolves.toBe(true)
    expect(revoked).toEqual(['read-1'])
    expect(gcal.hasScopeToken(scope)).toBe(false)
  })
})

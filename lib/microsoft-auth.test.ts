import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MICROSOFT_AUTH_CHANNEL_PREFIX,
  MICROSOFT_CLOSED_GRACE_MS,
  MICROSOFT_TOKEN_URL,
  MicrosoftAuthError,
  authorizeUrl,
  base64UrlEncode,
  codeChallengeFor,
  createMicrosoftAuth,
  reasonFor,
  type AuthChannel,
  type MicrosoftAuthDeps,
  type RedirectResult,
} from './microsoft-auth'

const SCOPE = 'https://graph.microsoft.com/Calendars.ReadBasic'
const CLIENT_ID = '6731de76-14a6-49ae-97bc-6eba6914391e'
const REDIRECT = 'https://solara-uv.web.app/auth/microsoft/'

describe('PKCE', () => {
  it('encodes bytes as base64url without padding', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
    expect(base64UrlEncode(new Uint8Array([0x61]))).toBe('YQ')
  })

  it('derives the S256 challenge of RFC 7636 appendix B', async () => {
    expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('authorizeUrl', () => {
  it('asks the common authority for a code with PKCE, for one scope, picking an account', () => {
    const url = new URL(
      authorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT,
        scope: SCOPE,
        state: 'st',
        codeChallenge: 'ch',
        selectAccount: true,
      }),
    )
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT,
      response_mode: 'query',
      scope: SCOPE,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    // Never a refresh token, and nothing about who the person is.
    expect(url.searchParams.get('scope')).not.toMatch(/offline_access|openid|profile|email/)
  })

  it('reuses the signed-in Microsoft account unless asked to pick one (REVIEW7 L3)', () => {
    const url = new URL(
      authorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT,
        scope: SCOPE,
        state: 'st',
        codeChallenge: 'ch',
      }),
    )
    expect(url.searchParams.has('prompt')).toBe(false)
  })
})

describe('reasonFor', () => {
  const result = (error: string, errorDescription = '', errorSubcode = ''): RedirectResult => ({
    state: 's',
    code: '',
    error,
    errorDescription,
    errorSubcode,
  })

  it('treats a cancelled sign-in as the person closing the popup', () => {
    expect(reasonFor(result('access_denied', 'AADSTS65004: User declined', 'cancel'))).toBe(
      'popup_closed',
    )
  })

  it('names an organization that must approve Solara first', () => {
    for (const description of [
      'AADSTS90094: The grant requires admin permission.',
      'AADSTS90095: Admin consent is required',
      'AADSTS65001: The user or administrator has not consented to use the application',
    ]) {
      expect(reasonFor(result('access_denied', description))).toBe('admin_approval')
    }
    expect(reasonFor(result('consent_required'))).toBe('admin_approval')
  })

  it('keeps other OAuth errors as they are', () => {
    expect(reasonFor(result('access_denied'))).toBe('access_denied')
    expect(reasonFor(result('server_error'))).toBe('server_error')
    expect(reasonFor(result(''))).toBe('no_token')
  })
})

// ---- The popup flow, with a fake window, channel and token endpoint ------------------

interface FakePopup {
  closed: boolean
  location: { href: string; replace(url: string): void }
  close(): void
}

function harness(overrides: Partial<MicrosoftAuthDeps> = {}) {
  const channels = new Map<string, AuthChannel>()
  const popups: FakePopup[] = []
  const posts: { url: string; body: URLSearchParams }[] = []
  let tokenAnswer: () => Response = () =>
    Response.json({
      token_type: 'Bearer',
      scope: SCOPE,
      expires_in: 3599,
      access_token: 'test-access-token',
      // Microsoft never sends one without offline_access; Solara must ignore it anyway.
      refresh_token: 'should-not-be-kept',
    })
  const deps: MicrosoftAuthDeps = {
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    open: () => {
      const popup: FakePopup = {
        closed: false,
        location: {
          href: 'about:blank',
          replace(url) {
            popup.location.href = url
          },
        },
        close() {
          popup.closed = true
        },
      }
      popups.push(popup)
      return popup
    },
    channel: name => {
      const channel: AuthChannel = {
        onmessage: null,
        close: () => channels.delete(name),
      }
      channels.set(name, channel)
      return channel
    },
    fetch: async (url, init) => {
      posts.push({ url: String(url), body: new URLSearchParams(String(init?.body)) })
      return tokenAnswer()
    },
    now: () => Date.now(),
    ...overrides,
  }
  const auth = createMicrosoftAuth(deps)

  /** What Microsoft's redirect to /auth/microsoft/ posts, as the redirect page would. */
  async function redirect(params: Partial<RedirectResult>) {
    await vi.waitFor(() => expect(popups.at(-1)?.location.href).toMatch(/^https:/))
    const state = new URL(popups.at(-1)!.location.href).searchParams.get('state')!
    const channel = channels.get(`${MICROSOFT_AUTH_CHANNEL_PREFIX}${state}`)
    channel?.onmessage?.({
      data: { state, code: '', error: '', errorDescription: '', errorSubcode: '', ...params },
    } as MessageEvent)
    popups.at(-1)!.closed = true
    return state
  }

  return {
    auth,
    popups,
    posts,
    channels,
    redirect,
    answerToken(answer: () => Response) {
      tokenAnswer = answer
    },
  }
}

/** The error a promise rejected with. */
async function failure(promise: Promise<unknown>): Promise<MicrosoftAuthError> {
  try {
    await promise
  } catch (error) {
    return error as MicrosoftAuthError
  }
  throw new Error('expected a rejection')
}

describe('createMicrosoftAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the popup at once, redeems the code with the verifier, and keeps the token in memory', async () => {
    const { auth, popups, posts, redirect } = harness()
    const pending = auth.requestToken(SCOPE, { interactive: true, selectAccount: true })
    // Opened before anything is awaited, so the click's user activation still counts.
    expect(popups).toHaveLength(1)
    await redirect({ code: 'the-code' })
    expect(await pending).toBe('test-access-token')

    const authorize = new URL(popups[0]!.location.href)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe(MICROSOFT_TOKEN_URL)
    const body = Object.fromEntries(posts[0]!.body)
    expect(body).toEqual({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      scope: SCOPE,
    })
    expect(await codeChallengeFor(body.code_verifier!)).toBe(
      authorize.searchParams.get('code_challenge'),
    )
    expect(authorize.searchParams.get('prompt')).toBe('select_account')
    // The next request needs no popup until the token is about to expire.
    expect(auth.hasToken(SCOPE)).toBe(true)
    expect(await auth.requestToken(SCOPE, { interactive: false })).toBe('test-access-token')
    expect(popups).toHaveLength(1)
    vi.advanceTimersByTime(3599_000 - 60_000)
    expect(auth.hasToken(SCOPE)).toBe(false)
    // Never stored anywhere but memory.
    expect(JSON.stringify(globalThis.localStorage ?? {})).not.toContain('test-access-token')
  })

  it('never opens a popup without a click', async () => {
    const { auth, popups } = harness()
    const error = await failure(auth.requestToken(SCOPE, { interactive: false }))
    expect(error).toBeInstanceOf(MicrosoftAuthError)
    expect(error).toMatchObject({ name: 'CalendarAuthError', reason: 'no_token' })
    expect(popups).toHaveLength(0)
  })

  it('shares one popup between requests made while it is open', async () => {
    const { auth, popups, redirect } = harness()
    const first = auth.requestToken(SCOPE, { interactive: true })
    const second = auth.requestToken(SCOPE, { interactive: true })
    await redirect({ code: 'c' })
    expect(await first).toBe('test-access-token')
    expect(await second).toBe('test-access-token')
    expect(popups).toHaveLength(1)
  })

  it('reports a blocked popup', async () => {
    const { auth } = harness({ open: () => null })
    expect(await failure(auth.requestToken(SCOPE, { interactive: true }))).toMatchObject({
      reason: 'popup_failed_to_open',
    })
  })

  it('reports a popup closed without an answer, after a grace for a late message', async () => {
    const { auth, popups } = harness()
    let settled = false
    const pending = failure(auth.requestToken(SCOPE, { interactive: true })).finally(
      () => (settled = true),
    )
    await vi.waitFor(() => expect(popups[0]!.location.href).toMatch(/^https:/))
    popups[0]!.closed = true
    await vi.advanceTimersByTimeAsync(MICROSOFT_CLOSED_GRACE_MS - 1_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await pending).toMatchObject({ reason: 'popup_closed' })
  })

  it('takes an answer that arrives seconds after the popup reads as closed (REVIEW7 M1)', async () => {
    // Solara's opener policy makes the popup read as closed the moment the redirect page
    // arrives, before its script posts the code.
    const { auth, popups, channels } = harness()
    const pending = auth.requestToken(SCOPE, { interactive: true })
    await vi.waitFor(() => expect(popups[0]!.location.href).toMatch(/^https:/))
    const state = new URL(popups[0]!.location.href).searchParams.get('state')!
    popups[0]!.closed = true
    await vi.advanceTimersByTimeAsync(4_000)
    channels.get(`${MICROSOFT_AUTH_CHANNEL_PREFIX}${state}`)!.onmessage?.({
      data: { state, code: 'late-code', error: '', errorDescription: '', errorSubcode: '' },
    } as MessageEvent)
    expect(await pending).toBe('test-access-token')
  })

  it('gives up after the timeout and closes the popup', async () => {
    const { auth, popups } = harness()
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 1)
    expect(await pending).toMatchObject({ reason: 'timeout' })
    expect(popups[0]!.closed).toBe(true)
  })

  it('maps a refusal from the redirect, and asks nothing of the token endpoint', async () => {
    const { auth, posts, redirect } = harness()
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await redirect({ error: 'access_denied', errorDescription: 'AADSTS90094: admin' })
    expect(await pending).toMatchObject({ reason: 'admin_approval' })
    expect(posts).toEqual([])
  })

  it('ignores a message for another flow, and refuses one whose state does not match', async () => {
    const { auth, popups, channels, posts } = harness()
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await vi.waitFor(() => expect(popups[0]!.location.href).toMatch(/^https:/))
    const state = new URL(popups[0]!.location.href).searchParams.get('state')!
    const channel = channels.get(`${MICROSOFT_AUTH_CHANNEL_PREFIX}${state}`)!
    channel.onmessage?.({ data: 'noise' } as MessageEvent)
    channel.onmessage?.({
      data: { state: 'forged', code: 'x', error: '', errorDescription: '', errorSubcode: '' },
    } as MessageEvent)
    expect(await pending).toMatchObject({ reason: 'state_mismatch' })
    expect(posts).toEqual([])
    expect(channels.size).toBe(0)
  })

  it('maps a token endpoint error, and refuses an answer without a bearer token', async () => {
    const { auth, redirect, answerToken } = harness()
    answerToken(() =>
      Response.json(
        { error: 'invalid_grant', error_description: 'AADSTS70008: expired' },
        { status: 400 },
      ),
    )
    let pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await redirect({ code: 'c' })
    expect(await pending).toMatchObject({ reason: 'invalid_grant' })

    answerToken(() => Response.json({ token_type: 'pop', access_token: 'x', expires_in: 10 }))
    pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await redirect({ code: 'c' })
    expect(await pending).toMatchObject({ reason: 'no_token' })
    expect(auth.hasToken(SCOPE)).toBe(false)
  })

  it('a network failure on the token request is not an auth problem', async () => {
    const { auth, redirect } = harness({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await redirect({ code: 'c' })
    const error = await pending
    expect(error).toBeInstanceOf(TypeError)
  })

  it('forgets the token (sign-out, account switch, or a 401)', async () => {
    const { auth, redirect } = harness()
    const pending = auth.requestToken(SCOPE, { interactive: true })
    await redirect({ code: 'c' })
    await pending
    auth.forget()
    expect(auth.hasToken(SCOPE)).toBe(false)
  })

  it('keeps a token for at most an hour, whatever Microsoft says', async () => {
    const { auth, redirect, answerToken } = harness()
    answerToken(() =>
      Response.json({ token_type: 'Bearer', access_token: 'long-lived', expires_in: 5400 }),
    )
    const pending = auth.requestToken(SCOPE, { interactive: true })
    await redirect({ code: 'c' })
    await pending
    vi.advanceTimersByTime(3600_000 - 60_000)
    expect(auth.hasToken(SCOPE)).toBe(false)
  })

  it('ends a sign-in still open when the token is forgotten, closing its popup (REVIEW7 L1)', async () => {
    const { auth, popups, channels, posts } = harness()
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await vi.waitFor(() => expect(popups[0]!.location.href).toMatch(/^https:/))
    const state = new URL(popups[0]!.location.href).searchParams.get('state')!
    // Person A signs out of Solara while the popup is still open.
    auth.forget()
    expect(await pending).toMatchObject({ reason: 'popup_closed' })
    expect(popups[0]!.closed).toBe(true)
    expect(channels.size).toBe(0)
    // A finishes in the popup later: nobody listens, nothing is redeemed or kept.
    expect(channels.get(`${MICROSOFT_AUTH_CHANNEL_PREFIX}${state}`)).toBeUndefined()
    expect(posts).toEqual([])
    expect(auth.hasToken(SCOPE)).toBe(false)
  })

  it('drops a token whose redemption was under way when forgotten (REVIEW7 L1)', async () => {
    let release!: () => void
    const answered = new Promise<void>(resolve => (release = resolve))
    const { auth, redirect } = harness({
      fetch: async () => {
        await answered
        return Response.json({ token_type: 'Bearer', access_token: 'a-token', expires_in: 3599 })
      },
    })
    const pending = failure(auth.requestToken(SCOPE, { interactive: true }))
    await redirect({ code: 'c' })
    auth.forget()
    release()
    expect(await pending).toMatchObject({ reason: 'popup_closed' })
    expect(auth.hasToken(SCOPE)).toBe(false)
    // The next account's own sign-in starts afresh, and the old one's end leaves it alone.
    const next = auth.requestToken(SCOPE, { interactive: true })
    await redirect({ code: 'd' })
    expect(await next).toBe('a-token')
    expect(auth.hasToken(SCOPE)).toBe(true)
  })

  it('says a page without Web Crypto needs a secure connection, opening nothing (REVIEW7 L6)', async () => {
    const { auth, popups } = harness()
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    try {
      const error = await failure(auth.requestToken(SCOPE, { interactive: true }))
      expect(error).toMatchObject({ name: 'CalendarAuthError', reason: 'insecure_context' })
      expect(error.message).toMatch(/secure \(https\)/)
      expect(popups).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('closes the popup and reports nothing else when the challenge cannot be made', async () => {
    const { auth, popups, channels } = harness()
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('no digest'))
    try {
      await expect(auth.requestToken(SCOPE, { interactive: true })).rejects.toThrow('no digest')
      expect(popups[0]!.closed).toBe(true)
      expect(channels.size).toBe(0)
      // No stray popup_closed rejection follows (vitest fails the run on one).
      await vi.advanceTimersByTimeAsync(MICROSOFT_CLOSED_GRACE_MS * 2)
    } finally {
      digest.mockRestore()
    }
  })

  it('needs a client ID', async () => {
    const { auth, popups } = harness({ clientId: '' })
    await expect(auth.requestToken(SCOPE, { interactive: true })).rejects.toThrow(/not configured/)
    expect(popups).toHaveLength(0)
  })
})

// Sign-in to Microsoft for events from Outlook (docs/integrations/OUTLOOK.md): the OAuth 2.0
// authorization code flow with PKCE, by hand, in a popup, as Microsoft's identity
// platform documents it for single-page apps
// (https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
//
// Why not MSAL.js: about 77 KB gzip for one popup and one POST, and it always asks for
// `offline_access`, so it would hold a refresh token, which Solara promises never to have.
// This flow asks only for the Graph scope it needs, so Microsoft issues no refresh token;
// the access token (about an hour) is kept in memory only, like Google's (lib/gcal.ts).
//
// 1. On the click, a popup opens (before anything is awaited, so it is not blocked); a
//    random code verifier and state are made, and the popup goes to Microsoft's authorize
//    page with the verifier's S256 challenge.
// 2. Microsoft sends the popup back to /auth/microsoft/ (app/auth/microsoft/page.tsx),
//    whose one inline script posts the query's code, state or error on a BroadcastChannel
//    named for this state, removes them from the address bar and closes the popup.
// 3. The state is checked, and the code is redeemed with the verifier at the token
//    endpoint, which allows the browser's cross-origin POST because the registration's
//    redirect URI is of the "Single-page application" type.
//
// Imported only by lib/outlook-events.ts, itself loaded only with the Outlook panel.

/** Microsoft's sign-in origin (Content-Security-Policy `connect-src`, lib/csp.mts). */
export const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com'
/** `common`: personal Microsoft accounts and work or school accounts alike. */
const AUTHORITY = `${MICROSOFT_LOGIN_ORIGIN}/common/oauth2/v2.0`
export const MICROSOFT_AUTHORIZE_URL = `${AUTHORITY}/authorize`
export const MICROSOFT_TOKEN_URL = `${AUTHORITY}/token`

/** The redirect page; the Azure registration's SPA redirect URI is this on Solara's origin. */
export const MICROSOFT_REDIRECT_PATH = '/auth/microsoft/'

/** The BroadcastChannel the redirect page answers on is this followed by the flow's state. */
export const MICROSOFT_AUTH_CHANNEL_PREFIX = 'solara-microsoft-auth:'

/**
 * Give up on a sign-in after this long (as TOKEN_TIMEOUT_MS in lib/gcal.ts): long enough
 * to sign in and read the consent page.
 */
export const MICROSOFT_TOKEN_TIMEOUT_MS = 3 * 60_000

/** How often the popup is checked for having been closed. */
const POLL_MS = 500
/**
 * The redirect page posts its answer and then closes itself, so a popup seen closed may
 * still have an answer on its way; it counts as closed by the person only after this.
 */
const CLOSED_GRACE_MS = 1_500
/** Treat a token as expired this long before Microsoft does. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * Why no token is available:
 * - `no_token`: none yet, expired, refused by Graph, or an unusable answer.
 * - `popup_closed`: the person closed the popup or cancelled the sign-in.
 * - `popup_failed_to_open`: the browser blocked the popup.
 * - `timeout`: no answer within MICROSOFT_TOKEN_TIMEOUT_MS.
 * - `admin_approval`: the person's organization must approve Solara first.
 * - `state_mismatch`: the answer was not for this sign-in.
 * - Any other value is Microsoft's OAuth error code, such as `access_denied`.
 */
export type MicrosoftAuthReason =
  | 'no_token'
  | 'popup_closed'
  | 'popup_failed_to_open'
  | 'timeout'
  | 'admin_approval'
  | 'state_mismatch'
  | (string & {})

/**
 * Microsoft did not give Solara a token, or Graph refused it. Named like Google's
 * CalendarAuthError (lib/gcal.ts), so the events panels handle both alike.
 */
export class MicrosoftAuthError extends Error {
  readonly reason: MicrosoftAuthReason
  constructor(reason: MicrosoftAuthReason = 'no_token') {
    super(
      reason === 'no_token'
        ? 'Outlook needs to be connected again'
        : `Outlook was not connected (${reason})`,
    )
    this.name = 'CalendarAuthError'
    this.reason = reason
  }
}

/** What the redirect page posts: the query Microsoft sent the popup back with. */
export interface RedirectResult {
  state: string
  code: string
  error: string
  errorDescription: string
  errorSubcode: string
}

/**
 * Microsoft's AADSTS codes for a sign-in that needs an administrator's consent: 65001 (no
 * consent was given, and the person cannot give it), 90094 (the grant requires admin
 * permission) and 90095 (admin consent is required; an approval request may have been sent).
 */
const ADMIN_APPROVAL = /\bAADSTS(65001|90094|90095)\b/

/** PURE. The reason a redirect or token answer with an error stands for. */
export function reasonFor(
  result: Pick<RedirectResult, 'error' | 'errorDescription' | 'errorSubcode'>,
): MicrosoftAuthReason {
  if (!result.error) return 'no_token'
  // "Cancel" on Microsoft's page: the person chose not to go on, like closing the popup.
  if (result.error === 'access_denied' && result.errorSubcode === 'cancel') return 'popup_closed'
  if (
    result.error === 'consent_required' ||
    result.error === 'admin_consent_required' ||
    ADMIN_APPROVAL.test(result.errorDescription)
  ) {
    return 'admin_approval'
  }
  return result.error
}

// ---- PKCE ------------------------------------------------------------------------------

/** PURE. Bytes as base64url without padding (RFC 4648 section 5, RFC 7636 appendix A). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random base64url string of `size` bytes. */
function randomString(size: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(size)))
}

/** The S256 code challenge of a code verifier: base64url(SHA-256(verifier)). */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

/** PURE. The authorize page for one sign-in. */
export function authorizeUrl({
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
}: {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Someone with a personal and a work account picks one each time.
    prompt: 'select_account',
  })
  return `${MICROSOFT_AUTHORIZE_URL}?${params}`
}

// ---- The popup flow --------------------------------------------------------------------

/** The part of a popup window the flow uses. */
export interface AuthPopup {
  readonly closed: boolean
  location: { replace(url: string): void }
  close(): void
}

/** The part of a BroadcastChannel the flow uses. */
export interface AuthChannel {
  onmessage: ((event: MessageEvent) => void) | null
  close(): void
}

/** What the flow needs from the browser, swappable in tests. */
export interface MicrosoftAuthDeps {
  clientId: string
  redirectUri: string
  open: (url: string) => AuthPopup | null
  channel: (name: string) => AuthChannel
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
}

export interface MicrosoftAuth {
  /** True when an unexpired token for `scope` is in memory (no popup needed). */
  hasToken(scope: string): boolean
  /** A token for `scope`; `interactive` opens the sign-in popup, which needs a click. */
  requestToken(scope: string, options: { interactive: boolean }): Promise<string>
  /** Drops every token (sign-out, account switch, a disconnect, or Graph refusing it). */
  forget(): void
}

function isRedirectResult(data: unknown): data is RedirectResult {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return ['state', 'code', 'error', 'errorDescription', 'errorSubcode'].every(
    key => typeof record[key] === 'string',
  )
}

interface TokenAnswer {
  token_type?: unknown
  access_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

export function createMicrosoftAuth(deps: MicrosoftAuthDeps): MicrosoftAuth {
  const tokens = new Map<string, { token: string; expiresAt: number }>()
  const pending = new Map<string, Promise<string>>()

  function cached(scope: string): string | null {
    const entry = tokens.get(scope)
    if (!entry) return null
    if (entry.expiresAt - EXPIRY_MARGIN_MS <= deps.now()) {
      tokens.delete(scope)
      return null
    }
    return entry.token
  }

  /** Waits for the redirect page's answer for `state`, the popup closing, or the timeout. */
  function answer(popup: AuthPopup, state: string): Promise<RedirectResult> {
    return new Promise((resolve, reject) => {
      const channel = deps.channel(`${MICROSOFT_AUTH_CHANNEL_PREFIX}${state}`)
      let closedSince: number | null = null
      const done = () => {
        clearInterval(poll)
        clearTimeout(timeout)
        channel.onmessage = null
        channel.close()
      }
      const fail = (reason: MicrosoftAuthReason) => {
        done()
        if (!popup.closed) popup.close()
        reject(new MicrosoftAuthError(reason))
      }
      channel.onmessage = event => {
        if (!isRedirectResult(event.data)) return
        done()
        if (event.data.state !== state) reject(new MicrosoftAuthError('state_mismatch'))
        else resolve(event.data)
      }
      const poll = setInterval(() => {
        if (!popup.closed) return
        closedSince ??= deps.now()
        if (deps.now() - closedSince >= CLOSED_GRACE_MS) fail('popup_closed')
      }, POLL_MS)
      const timeout = setTimeout(() => fail('timeout'), MICROSOFT_TOKEN_TIMEOUT_MS)
    })
  }

  /** Redeems the code at the token endpoint (a network failure is thrown as it is). */
  async function redeem(scope: string, code: string, verifier: string): Promise<string> {
    const response = await deps.fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: deps.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: deps.redirectUri,
        code_verifier: verifier,
        scope,
      }).toString(),
    })
    const body = (await response.json().catch(() => ({}))) as TokenAnswer
    if (!response.ok || typeof body.error === 'string') {
      throw new MicrosoftAuthError(
        reasonFor({
          error: typeof body.error === 'string' ? body.error : 'no_token',
          errorDescription:
            typeof body.error_description === 'string' ? body.error_description : '',
          errorSubcode: '',
        }),
      )
    }
    const token = body.access_token
    if (
      typeof token !== 'string' ||
      !token ||
      typeof body.token_type !== 'string' ||
      body.token_type.toLowerCase() !== 'bearer'
    ) {
      throw new MicrosoftAuthError('no_token')
    }
    const seconds = Number(body.expires_in)
    // Only the access token is kept, in memory; anything else in the answer is dropped.
    tokens.set(scope, {
      token,
      expiresAt: deps.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
    })
    return token
  }

  async function signIn(scope: string, popup: AuthPopup): Promise<string> {
    const verifier = randomString(32)
    const state = randomString(16)
    const waiting = answer(popup, state)
    try {
      const codeChallenge = await codeChallengeFor(verifier)
      popup.location.replace(
        authorizeUrl({
          clientId: deps.clientId,
          redirectUri: deps.redirectUri,
          scope,
          state,
          codeChallenge,
        }),
      )
    } catch (error) {
      popup.close()
      throw error
    }
    const result = await waiting
    if (result.error || !result.code) throw new MicrosoftAuthError(reasonFor(result))
    return redeem(scope, result.code, verifier)
  }

  return {
    hasToken: scope => cached(scope) !== null,
    async requestToken(scope, { interactive }) {
      const token = cached(scope)
      if (token) return token
      const inFlight = pending.get(scope)
      if (inFlight) return inFlight
      if (!interactive) throw new MicrosoftAuthError('no_token')
      if (!deps.clientId) throw new Error('Outlook is not configured')
      // Opened now, before anything is awaited, so the click still allows a popup.
      const popup = deps.open('about:blank')
      if (!popup) throw new MicrosoftAuthError('popup_failed_to_open')
      const flow = signIn(scope, popup).finally(() => pending.delete(scope))
      pending.set(scope, flow)
      return flow
    },
    forget() {
      tokens.clear()
    },
  }
}

/** A popup centred over the app, sized for Microsoft's sign-in page. */
function openPopup(url: string): AuthPopup | null {
  const width = 480
  const height = 640
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
  return window.open(
    url,
    'solara-microsoft-sign-in',
    `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  )
}

let browserAuth: MicrosoftAuth | null = null

/** Forgets the browser's Microsoft token, if a sign-in ever ran in this page. */
export function forgetMicrosoftToken(): void {
  browserAuth?.forget()
}

/** The browser's Microsoft sign-in, with the build's client ID and this origin's redirect page. */
export function microsoftAuth(): MicrosoftAuth {
  browserAuth ??= createMicrosoftAuth({
    clientId: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID ?? '',
    redirectUri: `${window.location.origin}${MICROSOFT_REDIRECT_PATH}`,
    open: openPopup,
    channel: name => new BroadcastChannel(name),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  })
  return browserAuth
}

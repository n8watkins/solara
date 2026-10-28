// In-test stand-ins for Microsoft's identity platform (the authorize page and the token
// endpoint) and Microsoft Graph's calendar API, so the signed-in suite can connect
// Outlook with the real sign-in code (lib/microsoft-auth.ts), the real redirect page
// (/auth/microsoft/) and the real rules, without a Microsoft account or an Azure app.
//
// The fakes check the protocol the way Microsoft documents it
// (https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow):
// the authorize request must carry PKCE with S256, the token request must redeem that
// code once, from the registered redirect URI, with the verifier whose challenge was
// sent, and Graph accepts only the tokens it issued. Graph answers follow List
// calendarView and List calendars (UTC dateTimeTimeZone, `value`, `@odata.nextLink`).
import { createHash } from 'node:crypto'
import type { Route } from '@playwright/test'

export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com'
export const GRAPH = 'https://graph.microsoft.com'

/** How the fake sign-in page answers: as a person who agrees, cancels or is refused. */
export type SignInOutcome = 'consent' | 'cancel' | 'admin'

export interface FakeOutlookEvent {
  id: string
  subject: string
  /** UTC instants ("2026-06-16T19:00:00Z"); Graph sends them without the Z. */
  start: string
  end: string
  calendarId?: string
  location?: {
    displayName: string
    locationType?: string
    coordinates?: { latitude: number; longitude: number }
  }
  isAllDay?: boolean
  isCancelled?: boolean
  isOnlineMeeting?: boolean
  response?: 'organizer' | 'accepted' | 'declined' | 'none'
  /** Fields Solara must never ask for; served only if it did. */
  body?: string
  onlineMeetingUrl?: string
}

export interface MicrosoftCall {
  method: string
  url: URL
  body?: URLSearchParams
}

const base64Url = (bytes: Buffer) =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export class FakeMicrosoft {
  /** The person's calendars after the default one ('default' in Solara). */
  readonly calendars: { id: string; name: string; owner?: string }[] = []
  readonly events = new Map<string, FakeOutlookEvent>()
  readonly calls: MicrosoftCall[] = []
  /** What the next sign-in does. */
  outcome: SignInOutcome = 'consent'
  /** Tokens Graph accepts. */
  private readonly tokens = new Set<string>()
  /** Codes issued and not yet redeemed, with what they were issued for. */
  private readonly codes = new Map<
    string,
    { clientId: string; redirectUri: string; challenge: string; scope: string }
  >()
  private serial = 1

  addEvent(event: FakeOutlookEvent) {
    this.events.set(event.id, event)
  }

  /** Every token stops working, as when it expires. */
  expireTokens() {
    this.tokens.clear()
  }

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postData() ? new URLSearchParams(request.postData()!) : undefined
    this.calls.push({ method: request.method(), url, body })
    if (url.origin === MICROSOFT_LOGIN) return this.login(route, url, body)
    return this.graph(route, url)
  }

  // ---- The identity platform ---------------------------------------------------------

  private async login(route: Route, url: URL, body?: URLSearchParams) {
    const request = route.request()
    const cors = { 'Access-Control-Allow-Origin': (await request.allHeaders()).origin ?? '*' }
    if (url.pathname === '/common/oauth2/v2.0/authorize' && request.method() === 'GET') {
      const params = url.searchParams
      const ok =
        params.get('response_type') === 'code' &&
        params.get('response_mode') === 'query' &&
        params.get('code_challenge_method') === 'S256' &&
        !!params.get('code_challenge') &&
        !!params.get('state') &&
        !!params.get('client_id') &&
        !!params.get('redirect_uri')
      const back = new URL(params.get('redirect_uri') ?? 'about:blank')
      back.searchParams.set('state', params.get('state') ?? '')
      if (!ok) {
        back.searchParams.set('error', 'invalid_request')
      } else if (this.outcome === 'cancel') {
        back.searchParams.set('error', 'access_denied')
        back.searchParams.set('error_subcode', 'cancel')
        back.searchParams.set('error_description', 'AADSTS65004: User declined to consent.')
      } else if (this.outcome === 'admin') {
        back.searchParams.set('error', 'access_denied')
        back.searchParams.set(
          'error_description',
          'AADSTS90094: The grant requires admin permission.',
        )
      } else {
        const code = `test-code-${this.serial++}`
        this.codes.set(code, {
          clientId: params.get('client_id')!,
          redirectUri: params.get('redirect_uri')!,
          challenge: params.get('code_challenge')!,
          scope: params.get('scope') ?? '',
        })
        back.searchParams.set('code', code)
        back.searchParams.set('session_state', 'fake-session')
      }
      // Microsoft's pages redirect with a 302; a document that replaces itself is the
      // same for the popup.
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Sign in to your account</title><p>Fake Microsoft sign-in</p><script>location.replace(${JSON.stringify(back.href)})</script>`,
      })
      return
    }
    if (url.pathname === '/common/oauth2/v2.0/token' && route.request().method() === 'POST') {
      const code = body?.get('code') ?? ''
      const issued = this.codes.get(code)
      this.codes.delete(code)
      const verifier = body?.get('code_verifier') ?? ''
      const challenge = base64Url(createHash('sha256').update(verifier).digest())
      if (
        !issued ||
        body?.get('grant_type') !== 'authorization_code' ||
        body.get('client_id') !== issued.clientId ||
        body.get('redirect_uri') !== issued.redirectUri ||
        body.get('scope') !== issued.scope ||
        challenge !== issued.challenge
      ) {
        await route.fulfill({
          status: 400,
          headers: cors,
          json: { error: 'invalid_grant', error_description: 'AADSTS70000: invalid grant' },
        })
        return
      }
      const token = `test-graph-token-${this.serial++}`
      this.tokens.add(token)
      await route.fulfill({
        headers: cors,
        json: { token_type: 'Bearer', scope: issued.scope, expires_in: 3599, access_token: token },
      })
      return
    }
    await route.fulfill({ status: 404, headers: cors, json: { error: 'not_found' } })
  }

  // ---- Microsoft Graph ---------------------------------------------------------------

  private async graph(route: Route, url: URL) {
    const token = /^Bearer (.+)$/.exec(
      (await route.request().allHeaders()).authorization ?? '',
    )?.[1]
    if (!token || !this.tokens.has(token)) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } },
      })
      return
    }
    if (url.pathname === '/v1.0/me/calendars') {
      const owner = { name: 'Person', address: 'person@outlook.com' }
      await route.fulfill({
        json: {
          value: [
            { id: 'AAMkAGI2default=', name: 'Calendar', isDefaultCalendar: true, owner },
            ...this.calendars.map(c => ({
              id: c.id,
              name: c.name,
              isDefaultCalendar: false,
              owner: { name: '', address: c.owner ?? owner.address },
            })),
          ],
        },
      })
      return
    }
    const view =
      url.pathname === '/v1.0/me/calendar/calendarView'
        ? 'default'
        : /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname)?.[1]
    if (view) {
      const calendarId = decodeURIComponent(view)
      if (calendarId !== 'default' && !this.calendars.some(c => c.id === calendarId)) {
        await route.fulfill({ status: 404, json: { error: { code: 'ErrorItemNotFound' } } })
        return
      }
      const from = Date.parse(url.searchParams.get('startDateTime') ?? '')
      const to = Date.parse(url.searchParams.get('endDateTime') ?? '')
      const top = Number(url.searchParams.get('$top') ?? 10)
      const skip = Number(url.searchParams.get('$skip') ?? 0)
      const select = (url.searchParams.get('$select') ?? '').split(',')
      const all = [...this.events.values()].filter(
        e =>
          (e.calendarId ?? 'default') === calendarId &&
          Date.parse(e.end) > from &&
          Date.parse(e.start) < to,
      )
      const page = all.slice(skip, skip + top)
      const next = new URL(url)
      next.searchParams.set('$skip', String(skip + top))
      await route.fulfill({
        json: {
          '@odata.context': `${GRAPH}/v1.0/$metadata#users('person')/calendarView`,
          value: page.map(e => this.resource(e, select)),
          ...(skip + top < all.length ? { '@odata.nextLink': next.href } : {}),
        },
      })
      return
    }
    await route.fulfill({
      status: 400,
      json: { error: { code: 'BadRequest', message: url.pathname } },
    })
  }

  /** An event resource as Graph returns it for `$select` (the id and etag always). */
  private resource(e: FakeOutlookEvent, select: string[]) {
    const utc = (iso: string) => ({
      dateTime: `${new Date(iso).toISOString().slice(0, 19)}.0000000`,
      timeZone: 'UTC',
    })
    const full: Record<string, unknown> = {
      subject: e.subject,
      body: { contentType: 'html', content: e.body ?? '' },
      bodyPreview: e.body ?? '',
      start: utc(e.start),
      end: utc(e.end),
      isAllDay: e.isAllDay ?? false,
      isCancelled: e.isCancelled ?? false,
      isOnlineMeeting: e.isOnlineMeeting ?? false,
      onlineMeetingUrl: e.onlineMeetingUrl ?? null,
      responseStatus: { response: e.response ?? 'organizer', time: '0001-01-01T00:00:00Z' },
      iCalUId: `040000008200E00074C5B7101A82E008${e.id}`,
      type: 'singleInstance',
      originalStartTimeZone: 'Pacific Standard Time',
      location: {
        displayName: e.location?.displayName ?? '',
        locationType: e.location?.locationType ?? 'default',
        uniqueIdType: 'unknown',
        address: {},
        coordinates: e.location?.coordinates ?? {},
      },
      attendees: [{ emailAddress: { address: 'aunt@example.com' }, type: 'required' }],
    }
    return {
      '@odata.etag': 'W/"DwAAABYAAAA"',
      id: `AAMkAGI2${e.id}`,
      ...Object.fromEntries(select.filter(key => key in full).map(key => [key, full[key]])),
    }
  }
}

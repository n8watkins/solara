// In-test stand-ins for Google Identity Services (the OAuth token client) and the
// Google Calendar REST API, so the signed-in suite can schedule, move and remove events
// without a real Google account or OAuth client.
//
// The fake Calendar keeps events in memory per test, records every call, and applies
// `privateExtendedProperty` filtering the way Google does, so a test can prove Solara
// only ever asks for, and only ever receives, the events it created.
import type { Route } from '@playwright/test'

/**
 * Replaces https://accounts.google.com/gsi/client. `initTokenClient` answers each
 * `requestAccessToken` with a fresh token at once, as Google does after consent.
 * Set `window.__solaraDenyCalendar = true` to simulate the person closing the popup.
 */
export const FAKE_GIS = `;(function () {
  'use strict'
  window.google = window.google || {}
  window.google.accounts = window.google.accounts || {}
  window.google.accounts.oauth2 = {
    initTokenClient: function (config) {
      return {
        requestAccessToken: function () {
          setTimeout(function () {
            if (window.__solaraDenyCalendar) {
              config.callback({ error: 'access_denied' })
              return
            }
            var token = 'fake-token-' + Math.random().toString(36).slice(2)
            config.callback({ access_token: token, expires_in: 3599, scope: config.scope })
          }, 0)
        },
      }
    },
  }
})()
`

interface EventTime {
  dateTime: string
  timeZone?: string
}

export interface FakeEvent {
  id: string
  status: 'confirmed' | 'cancelled'
  htmlLink: string
  summary: string
  description?: string
  start: EventTime
  end: EventTime
  extendedProperties?: { private?: Record<string, string> }
}

export interface CalendarCall {
  method: string
  path: string
  query: Record<string, string>
  body?: unknown
}

/** Google returns times with the zone's offset; the fixtures are Los Angeles in June. */
function withOffset(time: EventTime): EventTime {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(time.dateTime)) return time
  if (time.timeZone !== 'America/Los_Angeles') {
    throw new Error(`The fake calendar only knows America/Los_Angeles, got ${time.timeZone}`)
  }
  return { ...time, dateTime: `${time.dateTime}-07:00` }
}

const EVENTS_PATH = '/calendar/v3/calendars/primary/events'

export class FakeGoogleCalendar {
  readonly events = new Map<string, FakeEvent>()
  readonly calls: CalendarCall[] = []
  /** Tokens Google no longer accepts (see expireTokens). */
  private readonly expired = new Set<string>()
  private readonly seen = new Set<string>()
  private nextId = 1

  /** Adds an event as if made in Google (by Solara when `solara` is true). */
  addEvent(event: Omit<FakeEvent, 'id' | 'status' | 'htmlLink'> & { id?: string }): FakeEvent {
    const id = event.id ?? `evt${this.nextId++}`
    const stored: FakeEvent = {
      ...event,
      id,
      status: 'confirmed',
      htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      start: withOffset(event.start),
      end: withOffset(event.end),
    }
    this.events.set(id, stored)
    return stored
  }

  /** Moves an event in Google, as the person would in Google Calendar. */
  moveEvent(id: string, start: string, end: string) {
    const event = this.events.get(id)
    if (!event) throw new Error(`No event ${id}`)
    event.start = { ...event.start, dateTime: start }
    event.end = { ...event.end, dateTime: end }
  }

  /** Deletes an event in Google: listed as cancelled for a while, then gone. */
  deleteEvent(id: string, { purge = false } = {}) {
    const event = this.events.get(id)
    if (!event) throw new Error(`No event ${id}`)
    if (purge) this.events.delete(id)
    else event.status = 'cancelled'
  }

  /** Every token used so far stops working, as when it expires or is revoked. */
  expireTokens() {
    for (const token of this.seen) this.expired.add(token)
  }

  solaraEvents(): FakeEvent[] {
    return [...this.events.values()].filter(e => e.extendedProperties?.private?.solara === '1')
  }

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : undefined
    this.calls.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    })

    const token = /^Bearer (.+)$/.exec((await request.allHeaders()).authorization ?? '')?.[1]
    if (!token?.startsWith('fake-token-') || this.expired.has(token)) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 401, message: 'Invalid Credentials' } },
      })
      return
    }
    this.seen.add(token)

    if (url.pathname === '/calendar/v3/freeBusy' && method === 'POST') {
      await route.fulfill({ json: { calendars: { primary: { busy: [] } } } })
      return
    }
    if (url.pathname === EVENTS_PATH && method === 'POST') {
      const event = this.addEvent(body as FakeEvent)
      await route.fulfill({ json: event })
      return
    }
    if (url.pathname === EVENTS_PATH && method === 'GET') {
      await route.fulfill({ json: { items: this.list(url.searchParams) } })
      return
    }
    const match = new RegExp(`^${EVENTS_PATH}/([^/]+)$`).exec(url.pathname)
    const id = match?.[1] ? decodeURIComponent(match[1]) : null
    const event = id ? this.events.get(id) : undefined
    if (id && method === 'GET') {
      if (!event) await route.fulfill({ status: 404, json: { error: { code: 404 } } })
      else await route.fulfill({ json: event })
      return
    }
    if (id && method === 'PATCH') {
      if (!event) {
        await route.fulfill({ status: 404, json: { error: { code: 404 } } })
        return
      }
      const patch = body as Partial<FakeEvent>
      if (patch.start) event.start = withOffset(patch.start)
      if (patch.end) event.end = withOffset(patch.end)
      await route.fulfill({ json: event })
      return
    }
    if (id && method === 'DELETE') {
      if (!event || event.status === 'cancelled') {
        await route.fulfill({ status: 410, json: { error: { code: 410 } } })
        return
      }
      event.status = 'cancelled'
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.fulfill({
      status: 400,
      json: { error: { message: `fake: ${method} ${url.pathname}` } },
    })
  }

  /** events.list with the filters Solara uses. */
  private list(params: URLSearchParams): FakeEvent[] {
    const filters = params.getAll('privateExtendedProperty').map(f => f.split('='))
    const timeMin = params.get('timeMin') ? Date.parse(params.get('timeMin')!) : -Infinity
    const timeMax = params.get('timeMax') ? Date.parse(params.get('timeMax')!) : Infinity
    const showDeleted = params.get('showDeleted') === 'true'
    return [...this.events.values()].filter(
      e =>
        filters.every(([key, value]) => key && e.extendedProperties?.private?.[key] === value) &&
        (showDeleted || e.status !== 'cancelled') &&
        Date.parse(e.end.dateTime) > timeMin &&
        Date.parse(e.start.dateTime) < timeMax,
    )
  }
}

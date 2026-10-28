// The `eventSubscriptions` endpoint: one POST that adds, refreshes or removes a linked
// calendar for the signed-in account (docs/integrations/EVENTS.md, phase 2).

import type { FunctionResponse } from '#core'
import {
  EVENT_SUBSCRIPTION_LIMITS,
  SUBSCRIPTION_ACTIONS,
  type SubscriptionAction,
  type SubscriptionSummary,
} from '#core/event-import'
import type { Auth } from 'firebase-admin/auth'
import type { Request } from 'firebase-functions/v2/https'

import { authenticate, uidLimiter } from '../shared/auth'
import { HttpError } from '../shared/errors'
import { FixedWindowLimiter } from '../shared/rate-limit'
import {
  type SubscriptionDeps,
  addSubscription,
  refreshSubscriptionNow,
  removeSubscription,
} from './subscriptions'

/** Calls one account may make a minute (each add or refresh fetches a link). */
export const SUBSCRIPTION_CALLS_PER_MINUTE = 6
/** Adds and refreshes one account may make an hour, so the endpoint is no fetch proxy. */
export const SUBSCRIPTION_FETCHES_PER_HOUR = 20

const perMinute = uidLimiter(SUBSCRIPTION_CALLS_PER_MINUTE)
const fetchesPerHour = new FixedWindowLimiter({
  limit: SUBSCRIPTION_FETCHES_PER_HOUR,
  windowMs: 60 * 60_000,
})

/** Empties the hourly fetch budget (tests). */
export function clearSubscriptionLimits(): void {
  fetchesPerHour.clear()
}

interface ParsedBody {
  action: SubscriptionAction
  url: string
  label: string
  id: string
}

/** The request body, or a 400. */
export function parseSubscriptionRequest(body: unknown): ParsedBody {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const action = raw.action
  if (typeof action !== 'string' || !(SUBSCRIPTION_ACTIONS as readonly string[]).includes(action)) {
    throw new HttpError('invalid-argument', 'Invalid request')
  }
  const text = (value: unknown, max: number) => {
    if (value === undefined) return ''
    if (typeof value !== 'string' || value.length > max) {
      throw new HttpError('invalid-argument', 'Invalid request')
    }
    return value
  }
  const parsed = {
    action: action as SubscriptionAction,
    url: text(raw.url, EVENT_SUBSCRIPTION_LIMITS.urlLength),
    label: text(raw.label, EVENT_SUBSCRIPTION_LIMITS.labelLength * 4),
    id: text(raw.id, 32),
  }
  if (parsed.action === 'add' ? !parsed.url : !/^[0-9a-f]{32}$/.test(parsed.id)) {
    throw new HttpError('invalid-argument', 'Invalid request')
  }
  return parsed
}

export interface SubscriptionHandlerDeps extends SubscriptionDeps {
  auth: Auth
  /** Whether linked calendars are switched on (EVENTS_SUBSCRIPTIONS_ENABLED). */
  enabled: () => boolean
}

/** Handles one call. */
export async function handleSubscriptionRequest(
  deps: SubscriptionHandlerDeps,
  req: Request,
): Promise<FunctionResponse<'eventSubscriptions'>> {
  if (!deps.enabled()) throw new HttpError('not-found', 'Linked calendars are not available.')
  const identity = await authenticate(deps.auth, req.headers.authorization, { limiter: perMinute })
  const body = parseSubscriptionRequest(req.body)
  if (body.action !== 'remove' && !fetchesPerHour.take(identity.uid).allowed) {
    throw new HttpError('rate-limited', 'Too many calendar checks. Try again later.')
  }
  let subscription: SubscriptionSummary | null = null
  if (body.action === 'add') {
    subscription = await addSubscription(deps, identity.uid, body.url, body.label)
  } else if (body.action === 'refresh') {
    subscription = await refreshSubscriptionNow(deps, identity.uid, body.id)
  } else {
    await removeSubscription(deps, identity.uid, body.id)
  }
  return { action: body.action, subscription }
}

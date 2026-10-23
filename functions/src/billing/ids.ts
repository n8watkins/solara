// Identifier checks shared by the billing and account-deletion paths.

import type Stripe from 'stripe'

export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<unknown> = new Set(['active', 'trialing'])
export const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<unknown> = new Set([
  'canceled',
  'incomplete_expired',
])

/** A Firebase Auth uid as this app issues them. */
export function validUid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

/** A client-generated checkout attempt id. */
export function validAttemptId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value)
}

/** The id of a Stripe reference that may be expanded (an object) or not (a string). */
export function stringId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const object = value as { id?: unknown } | null | undefined
  return object && typeof object.id === 'string' ? object.id : null
}

/** The cursor for the next page of a Stripe list, or null on the last page. */
export function stripePageCursor(page: { has_more: boolean; data: unknown[] }): string | null {
  const cursor = page.has_more ? stringId(page.data.at(-1)) : null
  if (page.has_more && !cursor) throw new Error('Stripe pagination was incomplete')
  return cursor
}

export async function listCustomerSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const subscriptions: Stripe.Subscription[] = []
  let startingAfter: string | null = null
  do {
    const page: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    subscriptions.push(...page.data)
    startingAfter = page.has_more ? stringId(page.data.at(-1)) : null
    if (page.has_more && !startingAfter)
      throw new Error('Stripe subscription pagination was incomplete')
  } while (startingAfter)
  return subscriptions
}

// Runtime sizing for every deployed function, in one place.
//
// Each function declares its own ceiling instead of inheriting the platform defaults
// (up to 100 instances of 256 MiB, 60 s each), so a burst of traffic or a stuck loop
// can only ever run a bounded number of small instances. The numbers are chosen for
// Solara's real load (a few requests a minute) with headroom; the budget kill switch
// (functions/src/ops) is the second line when even these bounds are exceeded.
//
// functions/test/runtime-options.test.js loads the deploy entry point and fails when any
// exported function lacks a maxInstances, memory or timeout ceiling.

import type { SecretParam } from 'firebase-functions/params'
import type { HttpsOptions } from 'firebase-functions/v2/https'
import type { PubSubOptions } from 'firebase-functions/v2/pubsub'
import type { ScheduleOptions } from 'firebase-functions/v2/scheduler'

/** The platform's default region, which NEXT_PUBLIC_FUNCTIONS_URL names; pinned here. */
export const REGION = 'us-central1'

/** The smallest memory size that runs the Admin SDK and Stripe comfortably. */
const MEMORY = '256MiB' as const

/**
 * The most instances each HTTP function may ever run at once, sized for launch traffic
 * (a few requests a minute) with headroom, not for a flood (finding H1). Each instance
 * serves 20-40 requests at once, so even one instance handles far more than launch
 * traffic. The sum (15) bounds what a flood can bill: Cloud Run does not bill requests it
 * turns away because every instance is busy. Raise a cap here when real traffic needs it
 * (docs/COSTS.md, "Worst case under a flood").
 */
export const INSTANCE_CAPS = Object.freeze({
  forecast: 3,
  calendarFeed: 2,
  stripeWebhook: 1,
  createCheckoutSession: 1,
  createBillingPortalSession: 1,
  exportAccountData: 1,
  deleteAccount: 1,
  registerNotificationDevice: 1,
  removeNotificationDevice: 1,
  rotateCalendarFeed: 1,
  revokeCalendarFeed: 1,
  placeSearch: 1,
})

export type HttpFunctionName = keyof typeof INSTANCE_CAPS

export interface HttpBudget {
  /** The exported function name, which picks its instance cap from INSTANCE_CAPS. */
  name: HttpFunctionName
  /**
   * Requests one instance serves at once. These endpoints wait on Firestore and
   * Stripe, so sharing an instance is cheaper than starting another.
   */
  concurrency?: number
  timeoutSeconds: number
  secrets?: SecretParam[]
}

/** Options for an HTTP function: one vCPU (needed for concurrency), 256 MiB. */
export function httpOptions({
  name,
  concurrency = 20,
  timeoutSeconds,
  secrets,
}: HttpBudget): HttpsOptions {
  return {
    region: REGION,
    memory: MEMORY,
    cpu: 1,
    concurrency,
    maxInstances: INSTANCE_CAPS[name],
    timeoutSeconds,
    ...(secrets ? { secrets } : {}),
  }
}

/**
 * Options for a background function (schedules, Pub/Sub): one instance with a
 * fractional CPU (`gcf_gen1`, the cheapest size), one event at a time.
 */
function backgroundOptions(timeoutSeconds: number, secrets?: SecretParam[]) {
  return {
    region: REGION,
    memory: MEMORY,
    cpu: 'gcf_gen1' as const,
    concurrency: 1,
    maxInstances: 1,
    timeoutSeconds,
    ...(secrets ? { secrets } : {}),
  }
}

/**
 * Options for a scheduled job. A failed run is not retried by Cloud Scheduler: the next
 * run resumes from Firestore state, so a retry would only add cost.
 */
export function scheduleOptions(
  schedule: string,
  { timeoutSeconds, secrets }: { timeoutSeconds: number; secrets?: SecretParam[] },
): ScheduleOptions {
  return { schedule, retryCount: 0, ...backgroundOptions(timeoutSeconds, secrets) }
}

/** Options for a Pub/Sub function. Failures are not retried; the publisher sends again. */
export function pubSubOptions(
  topic: PubSubOptions['topic'],
  { timeoutSeconds }: { timeoutSeconds: number },
): PubSubOptions {
  return { topic, retry: false, ...backgroundOptions(timeoutSeconds) }
}

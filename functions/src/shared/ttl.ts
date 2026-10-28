// Time-to-live for server-owned records.
//
// Firestore deletes a document some time after the timestamp in its `expireAt` field
// passes, once a TTL policy for that collection group is on (infra/firestore-ttl.sh;
// TTL deletes need the Blaze plan). Every record the server keeps only for bookkeeping
// carries `expireAt`, so nothing piles up forever; docs/RUNBOOK.md lists the policies.

/** The field every TTL policy uses. */
export const TTL_FIELD = 'expireAt'

/** How long each kind of server-owned record is kept, in days. */
export const RETENTION_DAYS = Object.freeze({
  /** Stripe retries an event for up to 3 days; 90 days of dedupe covers any replay. */
  stripeWebhookEvents: 90,
  /** A finished checkout cleanup is kept a month for investigation. */
  stripeCheckoutCleanupTasks: 30,
  /**
   * A finished deletion's tombstone, its cleanup records and its subscription-owner
   * entries keep late Stripe events for the deleted account from being applied.
   */
  completedDeletion: 90,
  /** A registration rate-limit window is useless a minute later. */
  notificationRegistrationLimits: 1,
  /** An account's alert state names one local day; a week covers every time zone. */
  alertState: 7,
  /** A cached forecast is replaced every hour; a day covers the last-good fallback. */
  forecastCache: 1,
  /** The forecast upstream budget's counters name one hour or day; two days covers both. */
  forecastUpstream: 2,
  /**
   * A trial-use record (billing/trial-history.ts) keeps the free trial once per person
   * for two years after the trial, even after the account is deleted.
   */
  trialHistory: 730,
})

const DAY_MS = 24 * 60 * 60 * 1000

/** The `expireAt` value for a record kept `days` from `from`. */
export function expiresAfter(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * DAY_MS)
}

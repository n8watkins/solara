# Solara runbook

_Last reviewed: 2026-10-27_

What to do when something goes wrong in production, once the Functions run on the Blaze plan.
How deploys work is in [DEPLOYMENT.md](DEPLOYMENT.md); what each thing costs is in [COSTS.md](COSTS.md); the owner's one-time setup steps are in the [owner checklist](OWNER_CHECKLIST.md#at-pro-launch-blaze).

## Cost guard

The cost guard is one server-owned switch, the Firestore document `systemFlags/costGuard`, that turns off the paths whose cost grows with traffic, without a deploy (`functions/src/shared/cost-guard.ts`).
Each Function instance reads it at most once a minute, so a change takes effect within a minute.

While it is engaged:

| Path | Behavior |
| --- | --- |
| Calendar feed (`calendarFeed`) | 503 with `Retry-After: 3600`; calendar apps keep their last copy |
| New feed links (`rotateCalendarFeed`) | 503 `unavailable`; revoking a link still works |
| Notification device registration (`registerNotificationDevice`) | 503 `unavailable`; removal still works |
| Checkout, billing portal, Stripe webhook | Unchanged: they bring in money and keep subscriptions correct |
| Account export and deletion, the `maintenance` job | Unchanged: people are owed these |

The document's fields:

- `engaged` (boolean): set by the budget kill switch.
- `override` (string): set only by the owner. `engaged` keeps the guarded paths off whatever the budget says; `released` keeps them on (for example after raising the budget); `auto` or no value follows `engaged`.
- `reason`, `engagedAt`, `releasedAt`, `costAmount`, `budgetAmount`, `ratio`, `costIntervalStart`: what the kill switch last saw.

To force it on or off, open https://console.firebase.google.com/project/uv-activity-planner/firestore/data/~2FsystemFlags~2FcostGuard and set `override` to `engaged` or `released` (create the document and the field if missing).
Set `override` back to `auto` when the incident is over.

## Budget kill switch

The Cloud Billing budget (created by `infra/budget.sh`) publishes its state to the `budget-alerts` Pub/Sub topic several times a day.
The `budgetAlert` Function (`functions/src/ops/budget.ts`) reads each notification:

1. When the month's cost reaches `COST_GUARD_THRESHOLD_PERCENT` (default 100) percent of the budget, it engages the cost guard and logs the ERROR `cost guard engaged by the budget`.
2. Later notifications in the same budget period change nothing, even a lower figure.
3. The first notification of a new budget period below the threshold releases a guard the budget engaged (WARNING `cost guard released for a new budget period`); a guard engaged by hand (`override`) stays as the owner set it.
4. Only when the `COST_GUARD_DETACH_BILLING` repository variable is `true` (off by default), a cost of `COST_GUARD_DETACH_THRESHOLD_PERCENT` (default 200) percent of the budget detaches the project from its billing account (ERROR `billing detached by the budget kill switch`).
   The runtime service account then needs the role `infra/budget.sh` grants with `DETACH_BILLING=true`.

Budget data reaches Cloud Billing hours after the usage, so the switch caps a runaway bill instead of preventing every cent; the per-function instance caps (`functions/src/shared/options.ts`) and rate limits are the first line.

When the cost guard engages:

1. Look at **Billing**, **Reports** for the project, grouped by SKU, to see what is costing money.
2. Look at the Functions' request counts in Cloud Run, and at Firestore usage, for a spike; a single client address or account in the logs usually explains it.
3. Fix the cause (for example block an abusive account in Firebase Authentication, or lower a function's `maxInstances` where it is defined, in a `functions.ts` under `functions/src/`).
4. If the spend was legitimate growth, raise the budget in Cloud Billing, then set `override` to `released`; set it back to `auto` at the start of the next month.

When billing was detached:

- The project is back on no-cost usage only: the Functions stop (checkout, the webhook, deletion and the feed with them), and Firestore and Hosting serve only within the free quotas.
- Google warns that resources which need billing can be deleted if billing stays off; re-attach the same day.
- Re-attach at https://console.cloud.google.com/billing/linkedaccount?project=uv-activity-planner (**Link a billing account**), then redeploy the Functions (`firebase deploy --only functions --project uv-activity-planner`) and check that `maintenance` and `stripeWebhook` run again.
- Stripe retries webhook deliveries for up to three days, so subscription changes made while the webhook was down are applied once it is back.

## Account deletion alerts

Account deletion never stalls on Stripe ([Account export and deletion](DEPLOYMENT.md#account-export-and-deletion)), but two ERROR logs ask for a person.

`account deletion gave up on a Stripe resource` (fields `uid`, `resource`, `type`):

1. Open `accountDeletionTombstones/<uid>/billingCleanupResources/<resource>` in the Firestore console; `lastError` says what Stripe answered.
2. In the Stripe dashboard, search the customer by the `firebaseUid` metadata or the session or subscription id in the record, and cancel the subscription or expire the session by hand.
   The account's data is already deleted; only Stripe needs fixing.
3. Set the record's `needsAttention` to `false` so the next review knows it is handled.

`account deletion is stalled` (fields `uid`, `attemptCount`):

1. The tombstone `accountDeletionTombstones/<uid>` shows `cleanupLastError`.
2. Fix the cause (for example a revoked Stripe key, or the Auth user that cannot be deleted), then set `cleanupNextAttemptAt` to now; the next `maintenance` run resumes.
3. Never delete a tombstone or set `cleanupStatus` to `completed` by hand while a cleanup resource is `pending`.

## Record retention

Firestore deletes these records some time after their `expireAt` passes, once `infra/firestore-ttl.sh` has turned the policies on (after Blaze):

| Collection group | Kept for |
| --- | --- |
| `stripeWebhookEvents` | 90 days after processing, longer than any Stripe retry |
| `stripeCheckoutCleanupTasks` | 30 days after the cleanup finished |
| `accountDeletionTombstones`, `billingCleanupResources`, `stripeSubscriptionOwners` | 90 days after the account's deletion finished |
| `notificationRegistrationLimits` | 1 day after the rate-limit window |
| `users/{uid}/scheduled` | 30 days after the scheduled event ends |

Check the policies with `gcloud firestore fields ttls list --project uv-activity-planner`.
A finished tombstone that has expired no longer blocks a new account with the same Google sign-in, which is intended.

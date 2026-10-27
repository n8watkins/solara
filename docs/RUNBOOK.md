# Solara runbook

_Last reviewed: 2026-10-27_

What to do when something goes wrong in production, once the Functions run on the Blaze plan.
How deploys work is in [DEPLOYMENT.md](DEPLOYMENT.md); what each thing costs is in [COSTS.md](COSTS.md); the owner's one-time setup steps are in the [owner checklist](OWNER_CHECKLIST.md#at-pro-launch-blaze).

## Alerts

`infra/monitoring.sh` sets these up; each email names the policy.

| Alert | Fires when | First look |
| --- | --- | --- |
| Solara: errors in Functions or scheduled jobs | Any ERROR log from a Function or Cloud Scheduler, at most one email per 5 minutes | The log entry's message, then the matching section below |
| Solara: site or Functions down | An uptime check fails from more than one region for 10 minutes | [Rollback](#rollback) |
| Cloud Billing budget emails | 50%, 90% and 100% of the monthly budget, and 100% forecast | [Budget kill switch](#budget-kill-switch) |

ERROR messages and where they are handled:

| Message | Section |
| --- | --- |
| `cost guard engaged by the budget`, `billing detached by the budget kill switch` | [Budget kill switch](#budget-kill-switch) |
| `account deletion gave up on a Stripe resource`, `account deletion is stalled` | [Account deletion alerts](#account-deletion-alerts) |
| `maintenance task <name> failed` | The task's own errors are in the same log entry; the next run (5 minutes) retries; if it keeps failing, see [Rollback](#rollback) |
| `stripeWebhook failed` | Stripe retries for 3 days; fix the cause, then resend the event from the Stripe dashboard (**Developers**, **Webhooks**, the event, **Resend**) |
| `<function> failed` (a 5xx answer) | The function's recent logs in Cloud Run; roll the Function back if a deploy caused it |

## Cost guard

The cost guard is one server-owned switch, the Firestore document `systemFlags/costGuard`, that turns off the paths whose cost grows with traffic, without a deploy (`functions/src/shared/cost-guard.ts`).
Each Function instance reads it at most once a minute, so a change takes effect within a minute.

While it is engaged:

| Path | Behavior |
| --- | --- |
| Calendar feed (`calendarFeed`) | 503 with `Retry-After: 3600`; calendar apps keep their last copy |
| New feed links (`rotateCalendarFeed`) | 503 `unavailable`; revoking a link still works |
| Notification device registration (`registerNotificationDevice`) | 503 `unavailable`; removal still works |
| Forecast proxy (`forecast`, when switched on) | Serves cached forecasts (up to 6 hours old) and makes no upstream call; a place with no cached forecast gets 503 |
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
| `forecastCache` | 1 day after the forecast was fetched (each place is refreshed hourly while in use) |

Check the policies with `gcloud firestore fields ttls list --project uv-activity-planner`.
A finished tombstone that has expired no longer blocks a new account with the same Google sign-in, which is intended.

## Rollback

Every component can be put back to its last good state without a new build.

| Component | How to roll back |
| --- | --- |
| Hosting (the site) | Firebase console, **Hosting**, the `solara-uv` release history, **Roll back** on the last good release; or redeploy an older commit's artifact by reverting the change on `main` |
| Functions | Each function is a Cloud Run service: Cloud Run console, the service (its name is the function's in lower case), **Revisions**, **Manage traffic**, send 100% to the previous revision; or `gcloud run services update-traffic <service> --to-revisions <revision>=100 --region us-central1 --project uv-activity-planner`. Then revert the change on `main`, because the next deploy rolls forward again |
| A single paid path | Without a deploy: the cost guard (`systemFlags/costGuard`, `override: engaged`) pauses the feed, feed links, notification registration and the forecast proxy within a minute |
| Pro checkout | Set the `BILLING_ENABLED` repository variable to `false` and rerun the deploy: the plans dialog goes back to the waitlist and checkout refuses; subscriptions, the webhook and the portal keep working |
| Forecast proxy | Set `FORECAST_PROXY_ENABLED` to `false` and rerun the deploy: the app calls Open-Meteo directly again |
| Firestore rules | Firebase console, **Firestore**, **Rules**, the history, restore the previous version; then revert on `main` |
| Firestore indexes | Revert the change on `main`; a removed index is not deleted by the deploy (it would need `--force`) |
| Stripe webhook | In Stripe, **Developers**, **Webhooks**, disable the endpoint; Stripe keeps the events and retries them for 3 days once it is enabled again |

## Backups and restore

`infra/backups.sh` turns on point-in-time recovery (any minute of the last 7 days), delete protection and a daily backup kept for 14 days for the `(default)` database.

To recover documents changed or deleted by mistake (for example a bad deploy that wrote wrong data):

1. Pick the last good minute (UTC), before the incident.
2. Export the database as it was then into a bucket: `gcloud firestore export gs://<bucket>/restore-<date> --snapshot-time=<YYYY-MM-DDTHH:MM:00Z> --project uv-activity-planner` (create the bucket once in the same location as Firestore).
3. Import only what is needed into a scratch database first (`gcloud firestore databases create --database restore-check --location <location>`, then `gcloud firestore import gs://<bucket>/restore-<date> --database restore-check`), compare, then import into `(default)` with `--collection-ids` limited to the affected collections.
4. To restore a whole daily backup instead: `gcloud firestore backups list --project uv-activity-planner`, then `gcloud firestore databases restore --source-backup <backup name> --destination-database restore-<date>`; a restore always creates a new database, so copy from it as in step 3.

Restore drills (run one in the staging project after setup, then yearly, and record it here):

| Date | Project | What was restored | Time taken | Notes |
| --- | --- | --- | --- | --- |
| - | - | - | - | No drill yet; due at the Pro launch (roadmap item 11) |

## Secret rotation

Rotate a secret at once when it may have leaked, and otherwise as listed.
Never paste a secret into an issue, pull request, chat or repository file.

| Secret | Where it lives | How to rotate | Then |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Firebase Secret Manager | Stripe, **Developers**, **API keys**, **Roll key** (keep the old one for 1 hour); `npx firebase functions:secrets:set STRIPE_SECRET_KEY --project uv-activity-planner` | Redeploy the Functions (rerun the deploy); check a portal session opens |
| `STRIPE_WEBHOOK_SECRET` | Firebase Secret Manager | Stripe, **Webhooks**, the endpoint, **Roll secret** (keep the old one for 24 hours); set the new value as above | Redeploy the Functions; check the next event is accepted |
| `OPEN_METEO_API_KEY` | Firebase Secret Manager | Open-Meteo dashboard, new key; set it as above | Redeploy the Functions; delete the old key at Open-Meteo |
| `FIREBASE_SERVICE_ACCOUNT` (until Workload Identity Federation) | GitHub secret | Google Cloud, **IAM**, the service account, **Keys**, add a key, update the secret, delete the old key | Better: finish [WIF_SETUP.md](WIF_SETUP.md) and delete the key for good |
| `SENTRY_AUTH_TOKEN` | GitHub secret | Sentry, **Organization Tokens**, create a new one, update the secret, revoke the old one | The next deploy uploads source maps with it |
| reCAPTCHA secret key (App Check) | Firebase console, App Check | reCAPTCHA admin, the key's settings; or a new key, registered in App Check, with the site key variable updated | The next deploy ships the new site key |
| Calendar feed links | `calendarFeeds` (hashes only) | Each person rotates their own link in Settings; a leaked link stops working when rotated | Nothing else |
| Web Push VAPID key | Firebase console, Cloud Messaging | Generate a new key pair and update `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Devices register again on their next visit |

The Google OAuth client ID, the Firebase web config and the Sentry DSN are public identifiers, not secrets.

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
| Cloud Billing budget emails | 50%, 90%, 100% and 300% of the monthly budget, and 100% forecast | [Budget kill switch](#budget-kill-switch) |

ERROR messages and where they are handled:

| Message | Section |
| --- | --- |
| `cost guard engaged by the budget`, `billing detached by the budget kill switch`, `billing could not be detached by the budget kill switch`, `budgetAlert ignored a notification from another budget` | [Budget kill switch](#budget-kill-switch) |
| `account deletion gave up on a Stripe resource`, `account deletion is stalled` | [Account deletion alerts](#account-deletion-alerts) |
| `alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)`, `alert delivery outcome unknown`, `alert for an account failed` | [Pro alerts](#pro-alerts) |
| `client address is a proxy address: check TRUSTED_PROXY_HOPS` | Per-address limits are keying on a Google proxy, so people share one budget; set `TRUSTED_PROXY_HOPS` as in [Check the client address](DEPLOYMENT.md#check-the-client-address-at-the-first-deploy) and redeploy the Functions |
| `maintenance task <name> failed` | The task's own errors are in the same log entry; the next run (5 minutes) retries; if it keeps failing, see [Rollback](#rollback) |
| `stripeWebhook failed` | Stripe retries for 3 days; fix the cause, then resend the event from the Stripe dashboard (**Developers**, **Webhooks**, the event, **Resend**) |
| `<function> failed` (a 5xx answer) | The function's recent logs in Cloud Run; roll the Function back if a deploy caused it. Logged at most once a minute per instance; `suppressed` counts the failures held back since the previous line |

## Cost guard

The cost guard is one server-owned switch, the Firestore document `systemFlags/costGuard`, that turns off the paths whose cost an outsider's traffic drives, without a deploy (`functions/src/shared/cost-guard.ts`).
Each Function instance reads it at most once a minute, so a change takes effect within a minute.

While it is engaged:

| Path | Behavior |
| --- | --- |
| Calendar feed (`calendarFeed`) | 503 with `Retry-After: 3600`; calendar apps keep their last copy |
| New feed links (`rotateCalendarFeed`) | 503 `unavailable`; revoking a link still works |
| Notification device registration (`registerNotificationDevice`) | 503 `unavailable`; removal still works |
| Forecast proxy (`forecast`, when switched on) | Serves cached forecasts (up to 6 hours old) and makes no upstream call; a place with no cached forecast gets 503 |
| Pro alerts (the `alerts` job) | Unchanged while the budget engaged it: their cost is bounded by the number of Pro accounts and the per-run caps, not by anyone's traffic, so paying customers keep them during an attack. The owner's pin (`override: engaged`) pauses them too (WARNING `alerts paused by the owner (cost guard override)`) |
| Checkout, billing portal, Stripe webhook | Unchanged: they bring in money and keep subscriptions correct |
| Account export and deletion, the `maintenance` job | Unchanged: people are owed these |

The document's fields:

- `engaged` (boolean) and `engagedUntil` (time): set by the budget kill switch. A guard the budget engaged ends by itself at `engagedUntil`, about the start of the next budget period, even if no budget notification arrives then.
- `override` (string): set only by the owner. `engaged` keeps the guarded paths off whatever the budget says; `released` keeps them on; `auto` or no value follows the budget.
- `reason`, `engagedAt`, `releasedAt`, `costAmount`, `budgetAmount`, `ratio`, `costIntervalStart`, `warnedIntervalStart`: what the kill switch last saw.

To force it off or on, from a shell signed in as the owner (`gcloud auth login`):

```bash
infra/cost-guard.sh released --apply   # guarded paths back on now
infra/cost-guard.sh engaged --apply    # guarded paths off
infra/cost-guard.sh auto --apply       # follow the budget again
```

Without `--apply` the script prints the request instead of sending it.
Or in the console: https://console.firebase.google.com/project/uv-activity-planner/firestore/data/~2FsystemFlags~2FcostGuard, set `override` (create the document and the field if missing).
Set `override` back to `auto` when the incident is over.

## Budget kill switch

The Cloud Billing budget (created by `infra/budget.sh`; $25 a month by default) publishes its state to the `budget-alerts` Pub/Sub topic several times a day.
The `budgetAlert` Function (`functions/src/ops/budget.ts`) runs as its own service account, `solara-budget`, which alone may detach billing, and acts only on notifications whose `budgetId` is the `BUDGET_ID` repository variable (an ERROR `budgetAlert ignored a notification from another budget` otherwise).
It has three tiers, each a percentage of the budget set in `functions/.env` (defaults, owner may change):

1. At `COST_GUARD_WARN_PERCENT` (50), it logs the WARNING `budget passed its warning level`, once per budget period.
2. At `COST_GUARD_THRESHOLD_PERCENT` (100), it engages the cost guard until the next budget period and logs the ERROR `cost guard engaged by the budget`.
   Later notifications in the same period change nothing, even a lower figure.
   The guard ends at the start of the next period by itself; the first notification of the new period below the threshold also releases it (WARNING `cost guard released for a new budget period`).
   A guard engaged by hand (`override`) stays as the owner set it.
3. At `COST_GUARD_DETACH_THRESHOLD_PERCENT` (300), when `COST_GUARD_DETACH_BILLING` is on (the default; set the repository variable to `false` to switch it off), it detaches the project from its billing account and logs the ERROR `billing detached by the budget kill switch`.
   This is the hard stop: nothing more can be billed.
   It needs the role `infra/budget.sh` grants `solara-budget` and the `BUDGET_SERVICE_ACCOUNT` repository variable; without them it logs the ERROR `billing could not be detached by the budget kill switch`.

Budget data reaches Cloud Billing hours after the usage, so the switch caps a runaway bill instead of preventing every cent ([COSTS.md](COSTS.md#worst-case-under-a-flood)); the instance caps and rate limits are the first line.

When the cost guard engages:

1. Look at **Billing**, **Reports** for the project, grouped by SKU, to see what is costing money.
2. Look at the Functions' request counts in Cloud Run, and at Firestore usage, for a spike; the throttled `<function> rejected` lines show which rejections dominate (`suppressed` is the count held back).
3. Fix the cause (for example block an abusive account in Firebase Authentication, or lower a function's cap in `INSTANCE_CAPS` in `functions/src/shared/options.ts`).
4. Once the traffic has stopped, or if the spend was legitimate growth (then raise the budget in Cloud Billing first), run `infra/cost-guard.sh released --apply`, and `infra/cost-guard.sh auto --apply` at the start of the next month.

When billing was detached:

- The Functions stop: checkout, the webhook, account export and deletion, the feed, the forecast proxy and the alerts.
- Hosting keeps serving the site, and sign-in and Firestore keep working, within the no-cost (Spark) quotas; the app falls back to what it can do without Functions, as before the Pro launch.
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

## Pro alerts

The `alerts` job sends Pro's morning and UV alerts every 15 minutes ([Pro alerts](DEPLOYMENT.md#pro-alerts)).
To stop it at once, pin the cost guard (`infra/cost-guard.sh engaged --apply`; a guard the budget engaged does not pause alerts); to switch it off, set the `ALERTS_ENABLED` repository variable to `false` and rerun the deploy.

- `alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)`: alerts are on but the secret still holds `unset`; set the key ([owner checklist](OWNER_CHECKLIST.md#at-pro-launch-blaze), step 17) or switch alerts off.
- `alert delivery outcome unknown` (field `kind`, and `codes` or `error`): FCM answered with something other than a success or a definite failure, or did not answer.
  The alert is not sent again that day, so nobody gets it twice; if it repeats for many accounts, check the FCM status page and the Functions' service account roles.
- `alert for an account failed`: an unexpected error for one account; the run carries on with the others and the next run tries that account again.
- The WARNING `alerts run stopped before the last account` means a run reached its account cap or time budget; the next run carries on from where it stopped.
  If it appears in every run, Pro has outgrown the per-run caps in `functions/src/notifications/alerts.ts`.

An account's alert state is `users/<uid>/alertState/daily`: `morning` and `uv` each hold the local `day`, the `status` (`claimed`, `delivered`, `failed` or `unknown`), the `attempts` and how many devices it reached.

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
| `alertState` | 7 days after the account's last alert was claimed |

Check the policies with `gcloud firestore fields ttls list --project uv-activity-planner`.
A finished tombstone that has expired no longer blocks a new account with the same Google sign-in, which is intended.

## Rollback

Every component can be put back to its last good state without a new build.

| Component | How to roll back |
| --- | --- |
| Hosting (the site) | Firebase console, **Hosting**, the `solara-uv` release history, **Roll back** on the last good release; or redeploy an older commit's artifact by reverting the change on `main` |
| Functions | Each function is a Cloud Run service: Cloud Run console, the service (its name is the function's in lower case), **Revisions**, **Manage traffic**, send 100% to the previous revision; or `gcloud run services update-traffic <service> --to-revisions <revision>=100 --region us-central1 --project uv-activity-planner`. Then revert the change on `main`, because the next deploy rolls forward again |
| A single paid path | Without a deploy: `infra/cost-guard.sh engaged --apply` pins the cost guard, which pauses the feed, feed links, notification registration, Pro alerts and the forecast proxy's upstream calls within a minute |
| Pro checkout | Set the `BILLING_ENABLED` repository variable to `false` and rerun the deploy: the plans dialog goes back to the waitlist and checkout refuses; subscriptions, the webhook and the portal keep working |
| Forecast proxy | Set `FORECAST_PROXY_ENABLED` to `false` and rerun the deploy: the app calls Open-Meteo directly again |
| Pro alerts | Set `ALERTS_ENABLED` to `false` and rerun the deploy: the `alerts` job sends nothing and Settings says alerts are coming; registered devices stay registered |
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

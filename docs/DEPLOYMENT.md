# Solara Deployment Guide

_Last reviewed: 2026-10-23_

Solara exports a static Next.js site to `out/` and hosts it on Firebase Hosting.
Firebase Functions provide trusted server behavior for billing, account data, notification registration, scheduled cleanup, and calendar feeds.
The notification dispatcher is a manual GitHub Actions workflow until notifications are relaunched on a scheduled Function (roadmap W3-B).

This guide explains how deploys work and how to configure them.
What is actually deployed and configured today is in [status.md](status.md), and the owner's steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Plan requirements

Firebase Hosting, Authentication, Firestore, and Cloud Messaging can operate on the Spark plan within their quotas.
Deploying Firebase Functions requires the Blaze plan and an attached billing account.
Set a budget alert before enabling Blaze.

## Local environment

Copy `.env.local.example` to `.env.local` and populate the features you need.

Required for account access:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Required for every Function-backed surface (checkout, billing portal, export, deletion, calendar feed links and push registration):

- `NEXT_PUBLIC_FUNCTIONS_URL`
- `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`

Optional App Check settings:

- `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` selects `recaptcha-enterprise` or `recaptcha-v3` (the default).
- `NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN` registers an App Check debug token for local or staging builds; never set it for production.

Required in addition for push registration:

- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`

Every browser-called Function verifies a Firebase ID token and an App Check token before doing any work.
Checkout and account deletion require a limited-use App Check token, which the server consumes so a captured request cannot be replayed.
App Check, and with it reCAPTCHA, starts only after someone signs in, so signed-out visitors never load it.
Errors reach the browser only as `{ error, code }` with a code from the allowlist in `functions/src/shared/errors.ts`.
The notification registration endpoints also require paid entitlement.

Optional feature activation:

- `NEXT_PUBLIC_SITE_URL` sets the canonical deployed origin used by route metadata, `robots.txt`, and `sitemap.xml`.
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` enables Google Calendar access.
- The Pro price is not configurable: `lib/plans.ts` holds it ($2.99 a month or $19.99 a year, 7-day trial), shared by the landing page and the pricing dialog. The old `NEXT_PUBLIC_PRO_PRICE` value is ignored.
- `NEXT_PUBLIC_FUNCTIONS_URL` enables Function-backed product surfaces.
- `NEXT_PUBLIC_BILLING_ENABLED=1` replaces the Pro waitlist with Stripe Checkout; the deploy sets it from the `BILLING_ENABLED` repository variable, and only together with the Functions ([Pro billing](#pro-billing)).
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` offers an explicit analytics choice and loads GA4 only after the visitor opts in.
- `NEXT_PUBLIC_SENTRY_DSN` turns on error reporting to Sentry ([Error reporting](#error-reporting-sentry)); without it the build contains no Sentry code.
  The deploy also sets `NEXT_PUBLIC_SENTRY_RELEASE` to the commit SHA.

All `NEXT_PUBLIC_*` variables are public and compiled into the browser bundle.
Never put a Stripe secret, Firebase service-account JSON, webhook secret, or OAuth client secret in a `NEXT_PUBLIC_*` variable.

## GitHub Actions configuration

The build reads every `NEXT_PUBLIC_*` value from a repository variable first and falls back to a repository secret of the same name.
These values are public, so they belong in variables; [WIF_SETUP.md](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables) shows how to move them.
`.github/scripts/check-public-env.mjs` fails the build when a required value is missing, points at another project, is not https where a URL is expected, looks like a real secret, or did not make it into `out/`.
After the build it also fails when `out/` contains a source map, or Sentry code although `NEXT_PUBLIC_SENTRY_DSN` is empty.

Repository variables:

- `ENABLE_BLAZE_FUNCTIONS`: `true` makes `main` deploy Functions and compile `NEXT_PUBLIC_FUNCTIONS_URL` into the client; anything else keeps Function-backed surfaces off.
- `BILLING_ENABLED`: `true` opens Pro checkout: the build compiles `NEXT_PUBLIC_BILLING_ENABLED=1` and the Functions deploy writes `BILLING_ENABLED=true`; anything else keeps the waitlist and makes `createCheckoutSession` refuse with `unavailable`.
- `STRIPE_PRICE_ID` and `STRIPE_YEARLY_PRICE_ID`: the monthly ($2.99) and yearly ($19.99) Stripe prices of the Pro product, written into `functions/.env.<project-id>` by the Functions deploy job, which fails without them while `BILLING_ENABLED` is `true`.
- `COST_GUARD_DETACH_BILLING` (optional): `true` lets the budget kill switch detach billing as a last resort ([Cost guard and budget kill switch](#cost-guard-and-budget-kill-switch)); anything else keeps it off.
- `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` and `GCP_NOTIFIER_SERVICE_ACCOUNT`: Workload Identity Federation ([WIF_SETUP.md](WIF_SETUP.md)).
- `FIREBASE_PROJECT_ID` (optional): the deploy target, `uv-activity-planner` by default.
- `NEXT_PUBLIC_SENTRY_DSN` (optional): the Sentry public DSN; read from variables only.
- `SENTRY_ORG` and `SENTRY_PROJECT` (optional): the Sentry organization and project slugs for the source map upload.

Repository secrets:

- `FIREBASE_SERVICE_ACCOUNT`: a service-account JSON key, used only while the WIF variables are unset.
  `.github/actions/firebase-cli` logs a warning whenever it falls back to the key.
  The key's identity needs `roles/datastore.indexAdmin` for the Firestore indexes job.
- `SENTRY_AUTH_TOKEN` (optional): a Sentry organization auth token, passed only to the deploy step that uploads source maps.

Server configuration for Functions:

- `functions/.env` holds the non-secret params (`APP_URL`, an empty `STRIPE_PRICE_ID` default, and the kill switch thresholds), because non-interactive deploys resolve params only from `functions/.env*` files.
  `.github/scripts/check-functions-params.js` resolves them exactly as a deploy does, and runs in CI.
- Firebase Secret Manager stores `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

## Firebase console setup

1. Enable Google Authentication.
2. Add the production and preview domains to Authentication Authorized domains.
3. Create Firestore and deploy the repository rules.
4. Enable Cloud Messaging and generate a Web Push VAPID key.
5. Register the web app for App Check with reCAPTCHA v3 (decision D11), set the site key, monitor the metrics, and then enforce Firestore (see [App Check](#app-check)).
6. Enable Hosting.
7. Upgrade to Blaze only when Functions are ready to deploy.
8. Set a billing budget alert before the first Functions deployment.

For local Firebase CLI use, select the intended project explicitly.

```bash
npx firebase-tools use <project-id>
```

## How a deploy runs

Every push to `main` runs `.github/workflows/deploy.yml`:

1. The reusable quality workflow (`.github/workflows/quality.yml`) runs the README's [quality checks](../README.md#quality-checks) plus workflow and secret scanning.
2. One job builds the static export with the checked public configuration, uploads its source maps to Sentry and deletes them when that is configured, smoke-tests that `out/` on the Hosting emulator, and packages it with its SHA-256 digest, CycloneDX SBOMs and a provenance record.
3. Firestore rules and Firestore indexes deploy as separate jobs, so an index failure is visible on its own and does not hide whether Hosting published.
4. When `ENABLE_BLAZE_FUNCTIONS` is `true`, the Functions job writes the project's prices and switches (`STRIPE_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `BILLING_ENABLED`, `COST_GUARD_DETACH_BILLING`), builds `@solara/core` and the Functions, re-runs the params and payload checks, and deploys after rules and indexes.
5. Hosting verifies the digest and deploys exactly the tested artifact, after rules and, when they deploy, Functions.

Pull requests run the same quality workflow without deploying.
The "Protect main" ruleset requires a pull request and the required checks for every change to `main`.
A manual run of `deploy.yml` or `notify.yml` (`workflow_dispatch`) may pick any branch, so every job that receives credentials or a deploy token runs only when the ref is `main`; from another branch only the quality checks run.
Until Workload Identity Federation replaces the key secret, that job condition is the only thing keeping other branches away from production credentials; a `production` environment limited to `main` would add a second guard ([owner checklist](OWNER_CHECKLIST.md#repository)).

### Manual deploy

For a controlled manual deployment, use the locked Firebase CLI, an explicit project ID and the same order as the workflow.

```bash
set -euo pipefail

PROJECT_ID=<project-id>
FIREBASE=functions/node_modules/.bin/firebase

"$FIREBASE" deploy --only firestore:indexes --project "$PROJECT_ID"
# Wait for every required index to report READY before continuing.
"$FIREBASE" deploy --only firestore:rules --project "$PROJECT_ID"
"$FIREBASE" deploy --only functions --project "$PROJECT_ID"
"$FIREBASE" deploy --only hosting --project "$PROJECT_ID"
```

For a manual Functions deploy, put `STRIPE_PRICE_ID=<monthly price id>`, `STRIPE_YEARLY_PRICE_ID=<yearly price id>` and `BILLING_ENABLED=true` in `functions/.env.<project-id>`; `APP_URL` comes from `functions/.env`.
Deploy Hosting only from the `out/` of a production build (`npm run build`), because the CSP and public configuration are baked in at build time.

## Service workers

Both workers are generated, ignored artifacts; do not commit or hand-edit them.
`npm run build` ends with `scripts/build-sw.mjs` (after `scripts/csp.mjs`, so the pages are final), which writes two workers into `out/`:

- `/sw.js`, the app shell (`scripts/sw/shell.ts`, rules in `lib/sw-shell.mts`).
  It precaches `/` and `/app/` and every file they load, listed from the exported pages, their stylesheets and the web app manifest, and checked against `.next/build-manifest.json`, so the build fails rather than ship a shell that misses a script.
  Its version is a hash of every precached file: any change to the site installs a new worker, which takes over at once and deletes the previous version's caches, and an unchanged rebuild does not.
  Pages are fetched network first (the precached copy answers only when the network fails or takes over 4 seconds), so an old worker never pins anyone to an old page.
  It handles nothing cross-origin, nothing under `/__/` and no account data; the forecast offline comes from the app's own cache in localStorage (`lib/cache.ts`).
- `/firebase-messaging-sw.js`, the push worker (`scripts/sw/firebase-messaging-sw.ts`), bundled with the app's npm Firebase SDK and the Firebase values that Next itself resolves: the deployment environment first, then the `.env*` files (for example `.env.local`).
  Firebase Messaging registers it under its own scope when someone turns on notifications.
  It loads no script from a CDN, and notification clicks open only same-origin links, focusing an open Solara window when there is one.
  `npm run dev` bundles it into `public/` instead, for `next dev`; the shell worker exists only in production builds.

`firebase.json` serves both workers with `Cache-Control: no-cache`, so browsers check for a new one on every visit; never give them a long cache lifetime.
Re-run `npm run build` after changing Firebase client configuration.

## Content Security Policy

`npm run build` ends with `scripts/csp.mjs`, which writes a `<meta http-equiv="Content-Security-Policy">` tag into every HTML file in `out/`.
Each page's policy lists the SHA-256 hash of every inline script on that page, so scripts never need `'unsafe-inline'`.
The policy itself is defined in `lib/csp.mts`; add a host there, with a comment saying what needs it, when a new third-party service is introduced, and list the service in the privacy policy.
The Functions origin, Firebase auth domain and Sentry ingest host come from `NEXT_PUBLIC_FUNCTIONS_URL`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` and `NEXT_PUBLIC_SENTRY_DSN` at build time, so deploy the `out/` directory produced by the same build.
Without a DSN the policy names no Sentry host.
`firebase.json` adds the directives a meta tag cannot carry (`frame-ancestors`) as a header.
Only an emulator build for the signed-in e2e suite (`NEXT_PUBLIC_FIREBASE_EMULATORS=1`) also frames `'self'`, where the Auth emulator serves its sign-in helper; production builds refuse that flag (`scripts/check-no-emulators.mjs`).
Because the meta policy cannot send reports, violations show only in the browser console; check the console on the deployed site after a release.
Unknown paths are served the exported `404.html` with a 404 status; there is no catch-all rewrite.

## Notification activation

The notification workflow (`.github/workflows/notify.yml`) runs `functions/scripts/send-notifications.js` from the committed dependency graph and prevents overlapping dispatch runs.
It authenticates as `GCP_NOTIFIER_SERVICE_ACCOUNT` through WIF when that variable is set, and with the `FIREBASE_SERVICE_ACCOUNT` key otherwise.
The workflow has no schedule: pull request #13 removed the daily cron on 2026-07-15.
Do not add one; roadmap lane W3-B replaces this workflow with a scheduled Function.
Device registration goes through the `registerNotificationDevice` Function, so notifications also need deployed Functions.

Each run is bounded by page and time budgets and checkpoints its device and legacy-registration cursors in `notificationDispatchState/morning` or `notificationDispatchState/morning-dry-run`.
Later runs resume from those cursors and alternate between current device registrations and legacy registrations so a large or repeatedly interrupted scan cannot starve either source.

Use `workflow_dispatch` for controlled verification.
The workflow defaults to `dry_run = true`.
Use `force_send = true` only when you intentionally need to bypass local-time eligibility during a manual test.
Application idempotency should still prevent the same delivery from being sent twice.

The dispatcher creates a transactional claim on the device before it calls FCM.
`notificationDeliveryStatus` is `claimed` while the provider outcome is pending, `delivered` after a confirmed send, `failed` after a definite provider rejection, and `unknown` when delivery may have occurred.
Definite failures are retried for the same local date.
To preserve at-most-once delivery after an ambiguous interruption, a `claimed` attempt suppresses every later attempt for the same local date regardless of claim age.
Retries use the same platform notification tag or collapse identifier so the phone replaces an earlier delivery instead of displaying a duplicate.
Do not manually clear an `unknown` claim unless delivery has been reconciled with the user or provider evidence.
Use `notificationDeliveryKey`, `notificationDeliveryAttemptId`, `notificationDeliveryAttemptCount`, `notificationDeliveryClaimedAt`, and `notificationDeliveryRunId` to correlate the device record with workflow logs.
The dispatcher emits a structured `notification-delivery-unknown` log when it catches an ambiguous provider or transport result.

The real-device checks that must pass before any schedule is turned on are in the [owner checklist](OWNER_CHECKLIST.md#notifications).

## Firebase Functions and Stripe

Functions require a reproducible install in `functions/` and a Blaze-enabled Firebase project.
Configure Stripe secrets with the Firebase CLI instead of local files or GitHub build variables.
Keep the `ENABLE_BLAZE_FUNCTIONS` GitHub repository variable unset until the project is Blaze-enabled and the required Functions and Stripe configuration is ready.

```bash
npm ci
npm ci --prefix functions
cd functions
npx firebase functions:secrets:set STRIPE_SECRET_KEY --project <project-id>
npx firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project <project-id>
npx firebase deploy --only functions --project <project-id>
```

The `firebase.json` predeploy hook builds `@solara/core` and the TypeScript Functions before the upload.

The Functions deployment includes one scheduled job, `maintenance` (`functions/src/ops/functions.ts`), which runs every five minutes.
Cloud Scheduler gives each billing account three free jobs, so the background work shares one job and leaves room for the morning alerts job (roadmap item 10).
Each run does three tasks, each isolated so one failing never stops the others:

- `accountDeletions` resumes account deletion, Stripe cancellation, and data cleanup with bounded retries.
- `failedCheckouts` neutralizes Stripe Checkout Sessions that could not be cleaned up during the original request.
- `billingResourceBackfill` builds durable ownership records for existing Stripe resources; once complete it costs one read.

A failed task logs the ERROR `maintenance task <name> failed` and fails the run.
The tasks depend on the `accountDeletionTombstones`, `billingCleanupResources`, and `stripeCheckoutCleanupTasks` indexes in `firestore.indexes.json`.
Confirm those indexes are ready and `maintenance` runs successfully before enabling checkout or account deletion.
Allow the billing-resource backfill to complete before relying on deletion cleanup for legacy Stripe customers and subscriptions.

### Cost and abuse limits

Every Function declares its own ceiling in `functions/src/shared/options.ts` instead of the platform defaults: 256 MiB of memory, a timeout of 30-300 seconds, and at most 1-5 instances (`maxInstances`).
HTTP functions run on one vCPU and serve up to 20 requests per instance at once (40 for the calendar feed); `maintenance` and `budgetAlert` run one instance with a fractional CPU (`gcf_gen1`) and are not retried, because the next run or notification resumes the work.
`functions/test/hardening.test.js` loads the deploy entry point and fails when a function lacks a ceiling.

Every browser-called endpoint also:

- turns away more than 60 requests a minute from one client address before App Check is verified (`perAddressPerMinute` in `functions/src/shared/http.ts`);
- refuses a body over 8 KiB with `413 payload-too-large`;
- holds each account to a per-endpoint budget after verifying its ID token (`uidLimiter` in `functions/src/shared/auth.ts`): 5 a minute for checkout, the billing portal and feed links, 3 for export and deletion;
- verifies App Check; the same test fails when an HTTP function other than `stripeWebhook` (Stripe signature) and `calendarFeed` (feed token, rate limited) skips it.

The Stripe webhook refuses bodies over 256 KiB and more than 300 requests a minute from one address before checking the signature.
These limits live in instance memory, so each instance enforces its own; with the instance caps above they bound the total.

### Cost guard and budget kill switch

Paths whose cost grows with traffic (the calendar feed, new feed links, notification registration, and the forecast proxy when it is on) stop while the Firestore switch `systemFlags/costGuard` is engaged (`functions/src/shared/cost-guard.ts`).
The `budgetAlert` Function engages it when the Cloud Billing budget, which publishes to the `budget-alerts` Pub/Sub topic, passes `COST_GUARD_THRESHOLD_PERCENT` of its amount, and releases it when a new budget period starts.
Detaching billing is an opt-in last resort: set the `COST_GUARD_DETACH_BILLING` repository variable to `true` and grant the role in `infra/budget.sh`.
The budget, the topic and the role are created by `infra/budget.sh`; what to do when the switch fires is in the [runbook](RUNBOOK.md#budget-kill-switch).

### Pro billing

Pro is sold through Stripe Checkout once the owner switches billing on (`BILLING_ENABLED`); until then the plans dialog keeps the waitlist and `createCheckoutSession` refuses.

- The plans dialog (`components/PricingModal.tsx`) offers the monthly and yearly plans; `createCheckoutSession` (`functions/src/billing/checkout.ts`) maps the chosen plan to its price and binds the session to the signed-in account.
- An account that never had a trial gets `PRO_TRIAL_DAYS` (7, in `packages/core/src/plans.ts`) free: Checkout asks for a card up front (`payment_method_collection: always`), and a trial that ends without a payment method cancels itself. `stripeTrialUsed` on the account, and any earlier trial on the same Stripe customer, rule out a second trial.
- An open checkout for the other plan is expired before a new one is created, so only one can ever be paid.
- The webhook treats a subscription to either price as Pro and records a billing summary on the account (`subscriptionPlan`, `subscriptionCurrentPeriodEnd`, `subscriptionTrialEnd`, `subscriptionCancelAtPeriodEnd`), which the account page shows without any Stripe identifier.
- The customer portal (`createBillingPortalSession`) changes plans, payment methods and cancels; configure it in Stripe as in the [owner checklist](OWNER_CHECKLIST.md#functions-and-stripe).

The signed-in e2e suite runs all of this against a local fake Stripe (`tests/e2e/signed-in/fake-stripe.mjs`) that delivers signed webhook events: checkout with the trial, the webhook, the return to the app, the account page, the portal and a cancellation (`tests/e2e/signed-in/billing.e2e.ts`).
The Functions emulator alone may point Stripe at that fake (`STRIPE_API_BASE`); a deployed function always calls api.stripe.com.

### Refunds, disputes and failed payments

- **Server-initiated cancellations are refunded in full** (`functions/src/billing/refunds.ts`): a losing duplicate checkout, a checkout that completed while its account was being deleted, and a checkout the server could not record are canceled and every paid payment on them refunded, idempotently per payment.
- **Deleting your own account cancels without a refund**, as an immediate cancellation in the portal would; this is the default until the owner decides otherwise, and the account page says so.
- **A full refund issued in Stripe, or a dispute, ends the subscription it paid for** (`charge.refunded`, `charge.dispute.created`); the `customer.subscription.deleted` event that follows takes Pro away. Partial refunds change nothing.
- **A failed renewal keeps Pro for 7 days** (`PAST_DUE_GRACE_DAYS` in `functions/src/billing/grace.ts`) from the first `past_due` event, while Stripe retries the card; the account page asks for a new payment method. After the grace period the `maintenance` job moves the account to Free, and a successful retry restores Pro.

Register the deployed Stripe webhook URL in Stripe test mode first.
Subscribe the endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, and `charge.dispute.created`.
Create the endpoint with API version `2026-09-30.endive`, the version pinned as `STRIPE_API_VERSION` in `functions/src/billing/config.ts`, so event payloads match the types the Functions were built against.
When a Stripe SDK upgrade moves that pin, update the endpoint's API version in the same release.
Run the Stripe checks in the [owner checklist](OWNER_CHECKLIST.md#functions-and-stripe) in test mode before using live mode; no local test can replace these Stripe-signed integration checks.

## App Check

Solara uses App Check with reCAPTCHA v3 (decision D11), which is free up to 10,000 assessments a month ([COSTS.md](COSTS.md)).
Setting the `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` variable is the only code-side step; `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` stays unset for v3.
App Check, and with it reCAPTCHA, starts only after someone signs in, so signed-out visitors never load reCAPTCHA, and assessments track signed-in session-hours rather than page views.
The CSP allows exactly what reCAPTCHA v3 uses: scripts from `www.google.com/recaptcha/` and `www.gstatic.com/recaptcha/`, its invisible frame from `www.google.com/recaptcha/` (and Google's fallback `recaptcha.google.com/recaptcha/`), and its client reports to `www.google.com/recaptcha/`.

The integrations browser suite (`npm run test:e2e:integrations`) builds the production export with a fake site key and checks all of this: signed-out pages make no reCAPTCHA or App Check request, restoring a session loads reCAPTCHA after Auth, the reCAPTCHA token is exchanged for an App Check token, Firestore sends that token from its first request, and nothing violates the CSP.

The Functions enforce App Check in code, so they reject requests without a valid token as soon as they are deployed; the site key must be configured before Function-backed surfaces are enabled.
Firestore enforcement is a separate console switch.
To turn it on:

1. Create a reCAPTCHA v3 key for `solara-uv.web.app` and register it for the web app under App Check in the Firebase console (steps in the [owner checklist](OWNER_CHECKLIST.md#next-steps-in-order), step 5).
2. Set the `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` repository variable to the site key and deploy.
3. Watch the App Check metrics for Cloud Firestore until verified requests dominate and unverified ones are only old clients and bots.
4. Enforce App Check for Cloud Firestore in the console.

Because App Check starts after sign-in, enforcing Firestore never affects signed-out visitors, who make no Firestore requests.
For local development against a real project, use an App Check debug token (`NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN`, registered under **Manage debug tokens**) instead of adding `localhost` to the production key.

## Error reporting (Sentry)

Solara reports website errors to Sentry (decision D10) once the `NEXT_PUBLIC_SENTRY_DSN` repository variable holds a Sentry public DSN.
Until then the build contains no Sentry code and makes no request to Sentry; `check-public-env.mjs --built` and the e2e suite verify both.

How it works:

- `instrumentation-client.ts` starts `lib/error-reporting.ts`, which loads the `@sentry/nextjs` browser SDK as its own chunk once the page is idle, and keeps up to ten errors from before that.
- The SDK reports uncaught errors and unhandled promise rejections; `components/ErrorBoundary.tsx` and `app/global-error.tsx` report the errors they catch.
- `lib/sentry-scrub.ts` scrubs every event and breadcrumb before it leaves the browser: email addresses, Firebase uids, ID and App Check tokens and other long tokens, coordinates, and every URL query string and fragment, with the same rules the Functions use for their logs.
- `lib/sentry-options.ts` collects no user fields or IP address, no cookies, no headers except the user agent, no request bodies and no local variables.
  There is no session replay, no performance tracing (`tracesSampleRate` is 0: tracing would send page timings and URLs from a share of all page loads, which Solara does not need and which would use the free quota) and no per-page-load session tracking, so a request is made only when an error happens.
- Error reporting relies on legitimate interest (keeping the service working), so it does not wait for the analytics choice; the privacy policy says so and lists Sentry with what it receives and how long it is kept.
- The CSP allows the DSN's ingest host in `connect-src` only; the SDK itself is served from Solara's origin.

Source maps are uploaded only when the deploy can send them to Sentry: the DSN variable, the `SENTRY_ORG` and `SENTRY_PROJECT` variables and the `SENTRY_AUTH_TOKEN` secret.
Then the deploy builds with `BROWSER_SOURCE_MAPS=1`, runs `sentry-cli sourcemaps inject` and `sourcemaps upload` for the commit's release, and deletes every source map file and `sourceMappingURL` comment (`.github/scripts/remove-source-maps.mjs`) before the artifact is checked, smoke-tested and packaged.
The published site never serves a source map; a `@smoke` test checks the deployed artifact for that.
Use an organization auth token (Sentry **Settings**, **Developer Settings**, **Organization Tokens**): it carries only the `org:ci` scope, which covers releases and source map uploads.

## Calendar feed tokens

Calendar feed links are capability URLs, so the server mints their tokens (32 random bytes, base64url) through `rotateCalendarFeed` and revokes them through `revokeCalendarFeed`.
Each live token is indexed by its SHA-256 hash in the server-only `calendarFeeds/{hash}` collection, and the feed resolves a token with one document read.
The owner reads the current link from `users/{uid}/private/calendarFeed`, which clients cannot write.
A feed covers the forecast days the account's plan shows in the app: today and tomorrow on Free, 10 days on Pro (`PLAN_FORECAST_DAYS` in `packages/core/src/plans.ts`, which `lib/tiers.ts` also reads).
The plan is read from the server-owned `tier` field on every request, so a feed grows when an account upgrades and shrinks when it returns to Free.
Feed responses are `Cache-Control: private, max-age=900` with a weak `ETag`, and both a single feed and an address that keeps requesting unknown tokens are rate limited.
The per-address limit keys on the `X-Forwarded-For` entry that Google's front end appends, never on the entries a client can send (`TRUSTED_PROXY_HOPS` in `functions/src/shared/http.ts`).
That count is 1 while the Functions are called on their own URLs; putting an external HTTPS load balancer in front adds a second Google entry, so the count must change to 2 with it.
Account deletion removes the account's `calendarFeeds` entries along with the user document.

### Keep feed tokens out of request logs

Calendar apps fetch a bare URL, so the token travels in the query string, and Cloud Run's request log (`run.googleapis.com/requests`) stores the full `httpRequest.requestUrl`.
Without an exclusion, every feed poll writes a working feed link to Cloud Logging, where anyone with log read access could use it until it is rotated.
Solara's own code never logs the token (`functions/src/shared/logging.ts`).
At the Pro launch, before the feed is offered, add an exclusion to the `_Default` sink (Cloud Logging, **Log Router**, `_Default`, **Edit sink**, **Add exclusion**) named `calendar-feed-requests` with this filter:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="calendarfeed"
log_id("run.googleapis.com/requests")
```

Or with the CLI:

```bash
gcloud logging sinks update _Default --project <project-id> \
  --add-exclusion='name=calendar-feed-requests,filter=resource.type="cloud_run_revision" AND resource.labels.service_name="calendarfeed" AND log_id("run.googleapis.com/requests")'
```

Check the service name in Cloud Run first (Functions v2 lowercases it).
The exclusion drops only the feed's request log; its application logs (`calendarFeed failed`) and every other service's request logs are kept.
Excluded entries are never stored, so they are neither billed nor readable later; existing entries age out with the bucket's retention (30 days by default).

### Check the feed's address limit at the first deploy

The per-address limit assumes exactly one Google-appended `X-Forwarded-For` entry (`TRUSTED_PROXY_HOPS` is 1).
The app calls the feed on its `https://<region>-<project>.cloudfunctions.net/calendarFeed` URL, which may reach Cloud Run through another Google front end and add a second entry.
If it does, the limit would key on a Google address shared by many calendar apps, and one guesser could get them all answered with 429.
On the first Blaze deploy (or a staging project), log only the number of `X-Forwarded-For` entries for a few feed requests made through that URL, then remove the log line, and set `TRUSTED_PROXY_HOPS` and the comment in `functions/src/shared/http.ts` to match.

### Migration from client-minted tokens

Earlier builds let the browser write `users.calendarFeedToken`, and the feed looked it up with a query.
After the first deployment of these Functions and rules, run the one-time migration with credentials that can write Firestore:

```bash
cd functions
npm run migrate:feed-tokens -- --project <project-id> --dry-run
npm run migrate:feed-tokens -- --project <project-id>
```

The migration keeps a legacy token working only when it is well formed and held by exactly one account.
A token shared by several accounts is revoked for every holder, because sharing is exactly how a copied link could hijack a feed.
It removes the legacy field from every account and is safe to run again.
Until it runs, legacy links return 404, which is harmless while Functions are not deployed.

## Account export and deletion

Account export and deletion require `NEXT_PUBLIC_FUNCTIONS_URL`, an App Check site key and an authenticated account.
Deletion additionally requires a recent Google reauthentication and the exact `DELETE` confirmation.

Deletion may return HTTP 202 and sign the user out while cleanup continues.
The backend creates `accountDeletionTombstones/{uid}`, blocks further account access, revokes Firebase sessions, expires open checkouts and cancels subscriptions, deletes the Stripe customer once its sessions and subscriptions are done (unless a live subscription of another account shares it), removes notification ownership records and calendar feed index entries, recursively deletes the user document, and deletes the Firebase Authentication user.
The `maintenance` job resumes incomplete work with leases and retry backoff until `cleanupStatus` becomes `completed`.

Deletion never stalls:

- a Stripe object that no longer exists counts as done;
- a Stripe resource that keeps failing is given up after `MAX_RESOURCE_ATTEMPTS` (9, about a day of backoff) with `status: failed` and `needsAttention: true`, and the ERROR `account deletion gave up on a Stripe resource`; the deletion then finishes with `cleanupNeedsAttention: true` on the tombstone;
- a whole-account run that keeps failing retries daily and logs the ERROR `account deletion is stalled` from its sixth failure on.

The [runbook](RUNBOOK.md#account-deletion-alerts) says what to do with either alert.
Monitor `cleanupStatus`, `cleanupLastError`, `cleanupNextAttemptAt`, and the `maintenance` logs for pending deletions.
Do not manually remove a tombstone or mark it complete while billing cleanup resources remain pending.

The export (`exportAccountData`) holds the portable preferences, a billing summary (plan, interval, status, Pro since, trial end, current period end, cancellation, payment failed since, trial used), scheduled activities and device metadata, never a Stripe identifier or a token.

### Record retention

Every server-owned bookkeeping record carries an `expireAt` timestamp (`functions/src/shared/ttl.ts`), and every scheduled activity carries one 30 days after its event ends (required by `firestore.rules`), so nothing piles up, even for accounts that never come back.
Firestore deletes them once the TTL policies are on; `infra/firestore-ttl.sh` lists the policies and turns them on after Blaze (TTL deletes need billing), and `firestore.indexes.json` exempts `expireAt` from indexing without touching the TTL setting.
The account lifecycle checks to run before production activation are in the [owner checklist](OWNER_CHECKLIST.md#functions-and-stripe).

## Google Calendar activation

Create a Google OAuth Web client, enable the Calendar API, configure its consent screen, and add each deployed origin as an Authorized JavaScript origin.
Set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and deploy again.
Add only these two scopes to the consent screen's data access list: `https://www.googleapis.com/auth/calendar.freebusy` and `https://www.googleapis.com/auth/calendar.events.owned`.
Connecting a calendar requests `calendar.freebusy`, which can read busy times and nothing else.
Creating an event requests `calendar.events.owned` at booking time.
Solara uses that scope only on events it created: each one carries the private extended property `solara=1`, the app lists events with `privateExtendedProperty=solara=1`, and it reads, moves or deletes single events only by the ids it stored.
Scheduled activities are stored at `users/{uid}/scheduled/{eventId}` (event id, time, time zone, title, link and activity) under the owner-only rules in `firestore.rules`, are included in the account export, and are removed with the account.
The token stays in browser memory; when it has expired, saved items still show and the calendar offers "Reconnect to sync".
The consent and booking checks are in the [owner checklist](OWNER_CHECKLIST.md#google-sign-in-and-calendar).

## Operational rollback

Use the Firebase Hosting release history to roll Hosting back.
Disable the notification workflow before investigating any duplicate or incorrectly timed delivery incident.
Rotate a compromised service account, calendar-feed token, FCM token, or Stripe webhook secret immediately.
Do not log full notification tokens, calendar tokens, service-account JSON, or Stripe secrets.

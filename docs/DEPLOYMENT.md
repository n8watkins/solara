# Solara Deployment Guide

_Last reviewed: 2026-10-27_

Solara exports a static Next.js site to `out/` and hosts it on Firebase Hosting.
Firebase Functions provide trusted server behavior for billing, account data, notification registration, Pro alerts, scheduled cleanup, and calendar feeds.

This guide explains how deploys work and how to configure them.
What is actually deployed and configured today is in [status.md](status.md), and the owner's steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Plan requirements

Firebase Hosting, Authentication, Firestore, and Cloud Messaging can operate on the Spark plan within their quotas.
Deploying Firebase Functions requires the Blaze plan and an attached billing account.
Set up the budget and its kill switch (`infra/budget.sh`) the day Blaze is enabled; the `infra/` scripts print their gcloud commands and change nothing without `--apply` ([owner checklist steps 12-15](OWNER_CHECKLIST.md#at-pro-launch-blaze)).

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
- `NEXT_PUBLIC_FORECAST_PROXY=1` sends forecasts through the forecast proxy Function instead of straight to Open-Meteo; the deploy sets it from the `FORECAST_PROXY_ENABLED` repository variable, only together with the Functions ([Forecast proxy](#forecast-proxy)).
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
- `FORECAST_PROXY_ENABLED`: `true` turns the forecast proxy on in both the build and the Functions; anything else keeps the browser calling Open-Meteo directly and makes the `forecast` Function answer `unavailable`.
- `ALERTS_ENABLED`: `true` turns on Pro's morning and UV alerts: the build compiles `NEXT_PUBLIC_ALERTS_ENABLED=1` (Settings offers them) and the Functions deploy writes `ALERTS_ENABLED=true` (the `alerts` job sends them); anything else keeps Settings saying they are coming and makes each `alerts` run return at once ([Pro alerts](#pro-alerts)).
- `ALERTS_SERVICE_ACCOUNT` (optional): the service account the `alerts` Function runs as, created by `infra/alerts-identity.sh`; empty keeps the project's default runtime identity.
- `COST_GUARD_DETACH_BILLING` (optional): `true` lets the budget kill switch detach billing as a last resort ([Cost guard and budget kill switch](#cost-guard-and-budget-kill-switch)); anything else keeps it off.
- `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`: Workload Identity Federation ([WIF_SETUP.md](WIF_SETUP.md)).
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
- Firebase Secret Manager stores `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `OPEN_METEO_API_KEY` (the value `unset` until the commercial plan is bought); a Functions deploy fails while any of them is missing.

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
4. When `ENABLE_BLAZE_FUNCTIONS` is `true`, the Functions job (which deploys with `--force`, so functions removed from the source are deleted and the Artifact Registry cleanup policy is set when missing) writes the project's prices and switches (`STRIPE_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `BILLING_ENABLED`, `FORECAST_PROXY_ENABLED`, `ALERTS_ENABLED`, `ALERTS_SERVICE_ACCOUNT`, `COST_GUARD_DETACH_BILLING`), builds `@solara/core` and the Functions, re-runs the params and payload checks, and deploys after rules and indexes.
5. Hosting verifies the digest and deploys exactly the tested artifact, after rules and, when they deploy, Functions.

Pull requests run the same quality workflow without deploying.
The "Protect main" ruleset requires a pull request and the required checks for every change to `main`.
A manual run of `deploy.yml` (`workflow_dispatch`) may pick any branch, so every job that receives credentials or a deploy token runs only when the ref is `main`; from another branch only the quality checks run.
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

## Pro alerts

Pro's morning and UV alerts are sent by the scheduled `alerts` Function (`functions/src/notifications/`), every 15 minutes for every time zone (decision D6).
The timing and wording rules are shared in `packages/core/src/alerts.ts`.
It deploys with the other Functions and sends nothing until the `ALERTS_ENABLED` repository variable is `true`; the cost guard pauses it, and without the Open-Meteo commercial key it logs the ERROR `alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)` and sends nothing (decision D5).

- **Who:** accounts with `tier: 'paid'` whose subscription is `active` or `trialing`, or `past_due` within the 7-day grace period, or that have no subscription (Pro granted by hand); never an account being deleted (`functions/src/billing/entitlement.ts`).
- **Morning alert:** once per local day, in the two hours from the account's `notificationHour` (5-10) in the time zone of its place; quiet hours do not apply, because the person picks the hour.
- **UV alert:** once per local day, when the day's forecast UV index reaches the account's `uvAlertThreshold` (0 is off): from an hour before the first such hour until the last one ends, never in the account's `quietHours` (default 9pm-7am).
- **Devices:** every enabled device the account registered (`registerNotificationDevice`, at most five), whose token the `notificationTokenOwners` index still assigns to it.
  A token FCM rejects as unregistered or invalid is removed with its device.
- **At most once:** each alert is claimed for its local day in `users/{uid}/alertState/daily` before it is sent; `claimed`, `delivered` and `unknown` stop any later send that day, and only a send that failed for certain on every device (`failed`) is retried, up to three times.
  Each account gets at most one alert per run, so a morning and a UV alert that are due together go out 15 minutes apart.
  Do not clear an `unknown` state unless the delivery has been reconciled.
- **Bounds:** at most 2,000 accounts and 400 forecast lookups per run, 10 at a time, within 240 seconds; a run that stops early saves its place in `alertDispatch/state` and logs a WARNING, and the next run carries on from there.
  Forecasts come from the shared `forecastCache`, so a place costs at most one upstream call an hour across the app and the alerts.
- **Identity:** set `ALERTS_SERVICE_ACCOUNT` to the account `infra/alerts-identity.sh` creates (Firestore, Cloud Messaging and log writing only) to run the alerts with least privilege (BE-11); empty keeps the default runtime identity.
- **Delivery:** data-only messages; the push worker shows each one once per account and key (`morning-v1:<date>`, `uv-v1:<date>`), and a tap opens `/app/`.

The real-device checks that must pass before `ALERTS_ENABLED` is switched on are in the [owner checklist](OWNER_CHECKLIST.md#notifications).
It replaces the manual GitHub Actions notifier, which was retired.

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

The Functions deployment includes two scheduled jobs: `maintenance` (`functions/src/ops/functions.ts`), which runs every five minutes, and `alerts` ([Pro alerts](#pro-alerts)), every 15 minutes.
Cloud Scheduler gives each billing account three free jobs, so the background work shares one job and the alerts take the second.
Each run does three tasks, each isolated so one failing never stops the others:

- `accountDeletions` resumes account deletion, Stripe cancellation, and data cleanup with bounded retries.
- `failedCheckouts` neutralizes Stripe Checkout Sessions that could not be cleaned up during the original request.
- `billingResourceBackfill` builds durable ownership records for existing Stripe resources; once complete it costs one read.

A failed task logs the ERROR `maintenance task <name> failed` and fails the run.
The tasks depend on the `accountDeletionTombstones`, `billingCleanupResources`, and `stripeCheckoutCleanupTasks` indexes in `firestore.indexes.json`.
Confirm those indexes are ready and `maintenance` runs successfully before enabling checkout or account deletion.
Allow the billing-resource backfill to complete before relying on deletion cleanup for legacy Stripe customers and subscriptions.

### Cost and abuse limits

Every Function declares its own ceiling in `functions/src/shared/options.ts` instead of the platform defaults: 256 MiB of memory, a timeout of 30-300 seconds, and an instance cap.
The HTTP functions' caps are one table, `INSTANCE_CAPS`, sized for launch traffic (a few requests a minute) rather than for a flood: 3 instances for `forecast`, 2 for `calendarFeed` and `stripeWebhook`, and 1 for each of the other eight, 15 in all.
HTTP functions run on one vCPU and serve up to 20 requests per instance at once (40 for the forecast proxy and the calendar feed); `maintenance`, `alerts` and `budgetAlert` run one instance with a fractional CPU (`gcf_gen1`) and are not retried, because the next run or notification resumes the work.
`functions/test/hardening.test.js` loads the deploy entry point and fails when a function lacks a ceiling or the HTTP caps add up to more than 15.
Raise a cap in `INSTANCE_CAPS` when real traffic needs it, and update the worst case in [COSTS.md](COSTS.md#worst-case-under-a-flood) with it.

Every browser-called endpoint also, in this order, so a rejected request costs as little as possible (`createApiHandler` in `functions/src/shared/http.ts`):

1. refuses a foreign origin or another method;
2. turns away more than 60 requests a minute from one client address (`perAddressPerMinute`; 120 for the forecast proxy);
3. refuses a body over 8 KiB with `413 payload-too-large`;
4. refuses a request without an App Check token;
5. answers `503 unavailable` while the cost guard is engaged, for the endpoints it guards, before verifying the token (the guard is read from Firestore at most once a minute per instance);
6. verifies App Check; `functions/test/hardening.test.js` fails when an HTTP function other than `stripeWebhook` (Stripe signature) and `calendarFeed` (feed token, rate limited) skips it;
7. holds each account to a per-endpoint budget after verifying its ID token (`uidLimiter` in `functions/src/shared/auth.ts`): 5 a minute for checkout, the billing portal and feed links, 3 for export and deletion.

None of steps 1-4 reads Firestore or calls another service.
Rejections are logged once a minute per endpoint and kind of rejection, with the number held back since the last line (`functions/src/shared/log-throttle.ts`), so a flood writes a few lines a minute instead of one per request.
`infra/logging.sh` also drops 99% of Cloud Run's own request logs for 4xx answers, and every feed request log ([Keep feed tokens out of request logs](#keep-feed-tokens-out-of-request-logs)).

The Stripe webhook refuses bodies over 256 KiB and more than 300 requests a minute from one address before checking the signature.

The client address is the `X-Forwarded-For` entry Google's front end appends (`clientAddress` in `functions/src/shared/client-address.ts`).
IPv6 addresses are counted by their /64 prefix, because one ordinary connection is given a whole /64 and could otherwise use a new address for every request; an IPv4-mapped IPv6 address counts as its IPv4 address.
These limits live in instance memory, so each instance enforces its own: the effective limit for one address is the per-minute limit times the function's instance cap (for example 60 x 1 for checkout, 120 x 3 for the forecast proxy).
That is the right shape for a first line against one noisy client; the costs that must be bounded globally use shared counters instead (the forecast proxy's upstream budget).

### Cost guard and budget kill switch

Paths whose cost grows with traffic (the calendar feed, new feed links, notification registration, Pro alerts, and the forecast proxy when it is on) stop while the Firestore switch `systemFlags/costGuard` is engaged (`functions/src/shared/cost-guard.ts`).
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

## Forecast proxy

Open-Meteo's free API is for non-commercial use, so once Pro is sold, forecasts come from its commercial API (decision D5) through the `forecast` Function, which keeps the API key on the server (`functions/src/forecast/`).

- **One provider adapter**: `packages/core/src/forecast.ts` defines the providers (`openMeteoFree`, `openMeteoCommercial`, `solaraForecastProxy`), and every caller, the browser, the proxy and the calendar feed, reads the answer with the same validated parser (`fetchProviderForecast`).
- **Cache**: one forecast per place, rounded to 0.01 degree (about 1 km), and UTC hour; each instance keeps a copy in memory and all instances share `forecastCache/{place}` in Firestore, so a place costs at most one upstream call an hour. Concurrent requests for a place share one call.
- **Timeout and fallback**: the upstream call times out after 5 seconds; then the last good forecast for the place, at most 6 hours old, is served instead.
- **Limits**: App Check (standard), 120 requests a minute per address, five instances, and only the app's own request (the coordinates are the only input); while the cost guard is engaged, only cached forecasts are served.
- **Switch**: the `FORECAST_PROXY_ENABLED` repository variable turns it on in the build and the Functions together; until then the browser calls Open-Meteo directly, as today. The calendar feed uses the commercial API as soon as `OPEN_METEO_API_KEY` holds a real key.

With the proxy on, a guest's first forecast also loads App Check (Firebase and reCAPTCHA) on demand, because the proxy requires App Check; that adds reCAPTCHA assessments for guests ([COSTS.md](COSTS.md)) and some start-up time on a first visit without a cached forecast.

The signed-in e2e suite runs the Function against a local stand-in for the commercial API (`tests/e2e/signed-in/forecast-proxy.e2e.ts`).

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
The per-address limit keys on the `X-Forwarded-For` entry that Google's front end appends, never on the entries a client can send (`TRUSTED_PROXY_HOPS` in `functions/src/shared/client-address.ts`).
That count is 1 while the Functions are called on their own URLs; putting an external HTTPS load balancer in front adds a second Google entry, so the count must change to 2 with it ([Check the client address at the first deploy](#check-the-client-address-at-the-first-deploy)).
Account deletion removes the account's `calendarFeeds` entries along with the user document.

### Keep feed tokens out of request logs

Calendar apps fetch a bare URL, so the token travels in the query string, and Cloud Run's request log (`run.googleapis.com/requests`) stores the full `httpRequest.requestUrl`.
Without an exclusion, every feed poll writes a working feed link to Cloud Logging, where anyone with log read access could use it until it is rotated.
Solara's own code never logs the token (`functions/src/shared/logging.ts`).
At the Pro launch, before the feed is offered, run `infra/logging.sh` (print, read, then `--apply`), which adds this exclusion and the one for rejected requests to the `_Default` sink.
By hand: Cloud Logging, **Log Router**, `_Default`, **Edit sink**, **Add exclusion**, named `calendar-feed-requests`, with this filter:

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

### Check the client address at the first deploy

Every per-address limit, not only the feed's, assumes exactly one Google-appended `X-Forwarded-For` entry (`TRUSTED_PROXY_HOPS` is 1).
If calls through the `https://<region>-<project>.cloudfunctions.net` URLs reached Cloud Run with a second Google entry, every limit would key on a Google address shared by many people, and one busy client would get everyone 429s for forecasts, checkout and deletion.
Two checks guard against that:

- **At deploy:** after the first Blaze deploy (staging first), run `infra/check-client-address.sh`.
  It sends three requests without an App Check token to the forecast proxy and reads the `client address check` line each new instance logs for its first request (the entry count and whether the address is a real client's, never the address).
  It fails when any function keys on a Google front-end, private or link-local address; then set `TRUSTED_PROXY_HOPS` and its comment to match and deploy again.
- **At run time:** each browser endpoint looks at the first 50 requests per instance that carry the header, and when at least half would be keyed on such an address it logs the ERROR `client address is a proxy address: check TRUSTED_PROXY_HOPS` once (`ProxyHopMonitor`), which the error-log alert emails to the owner ([runbook](RUNBOOK.md#alerts)).

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

Rollback per component, restores, alerts and secret rotation are in the [runbook](RUNBOOK.md).
Use the Firebase Hosting release history to roll Hosting back.
Set the `ALERTS_ENABLED` repository variable to `false` and redeploy, or engage the cost guard for an immediate stop, before investigating any duplicate or incorrectly timed alert.
Rotate a compromised service account, calendar-feed token, FCM token, or Stripe webhook secret immediately.
Do not log full notification tokens, calendar tokens, service-account JSON, or Stripe secrets.

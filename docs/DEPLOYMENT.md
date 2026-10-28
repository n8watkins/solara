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
- `EVENTS_SUBSCRIPTIONS_ENABLED`: `true` turns on linked calendars and Pro event heads-ups: the build compiles `NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED=1` (the Events section offers linked calendars and Settings the event heads-up) and the Functions deploy writes `EVENTS_SUBSCRIPTIONS_ENABLED=true`; anything else hides them, makes `eventSubscriptions` answer `404 not-found` and each `eventSubscriptionsRefresh` run return at once ([Linked calendars and event heads-ups](#linked-calendars-and-event-heads-ups)).
- `GOOGLE_CALENDAR_EVENTS_ENABLED`: `true` makes the build compile `NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED=1`, so the Events section offers events already in Google Calendar; it also needs `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (the env check fails the build without it); the Functions deploy writes `GOOGLE_CALENDAR_EVENTS_ENABLED=true`, so the `alerts` job (with `ALERTS_ENABLED`) sends Pro event heads-ups even while linked calendars stay off ([Events from Google Calendar](#events-from-google-calendar)).
- `COST_GUARD_DETACH_BILLING` (optional): the budget kill switch detaches billing at 300% of the budget unless this is `false` ([Cost guard and budget kill switch](#cost-guard-and-budget-kill-switch)).
- `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT` (set after `infra/budget.sh`, which prints both): the budget the kill switch acts on, and the identity `budgetAlert` runs as, the only one allowed to detach billing.
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
- Firebase Secret Manager stores `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TRIAL_HISTORY_KEY` (the HMAC key of the [trial history](#trial-history)) and `OPEN_METEO_API_KEY` (the value `unset` until the commercial plan is bought); a Functions deploy fails while any of them is missing.

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
4. When `ENABLE_BLAZE_FUNCTIONS` is `true`, the Functions job (which deploys with `--force`, so functions removed from the source are deleted and the Artifact Registry cleanup policy is set when missing) writes the project's prices and switches (`STRIPE_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `BILLING_ENABLED`, `FORECAST_PROXY_ENABLED`, `ALERTS_ENABLED`, `ALERTS_SERVICE_ACCOUNT`, `COST_GUARD_DETACH_BILLING`, `BUDGET_ID`, `BUDGET_SERVICE_ACCOUNT`), builds `@solara/core` and the Functions, re-runs the params and payload checks, and deploys after rules and indexes.
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
It deploys with the other Functions and sends nothing until the `ALERTS_ENABLED` repository variable is `true`; a budget-engaged cost guard does not pause it (only the owner's pin does), and without the Open-Meteo commercial key it logs the ERROR `alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)` and sends nothing (decision D5).

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

## Linked calendars and event heads-ups

Phase 2 of [integrations/EVENTS.md](integrations/EVENTS.md#phase-2-as-built): a signed-in account links an https or webcal calendar address, Solara's servers fetch it now and every 6 hours, and Pro accounts get a heads-up before an imported or linked event with high UV.
Both deploy with the other Functions; linked calendars stay off until the `EVENTS_SUBSCRIPTIONS_ENABLED` repository variable is `true`, and heads-ups until it or `GOOGLE_CALENDAR_EVENTS_ENABLED` is (REVIEW6 L1); heads-ups also need `ALERTS_ENABLED`, because the `alerts` job sends them.

- **Endpoint:** `eventSubscriptions` (POST, `functions/src/events/endpoint.ts`) adds, refreshes or removes a link for the signed-in account, behind App Check, 20 requests a minute per address, 6 a minute and 20 fetches an hour per account, and the cost guard (`eventSubscriptions` feature).
- **Fetcher** (`functions/src/events/safe-fetch.ts`): https on port 443 only (webcal is rewritten), no user name or password in the address; every host name is resolved by the Function and the connection goes to the checked address, so DNS cannot change between the check and the connection; every address must be public (no loopback, private, carrier-grade NAT, link-local or metadata, multicast, reserved or documentation ranges; IPv6 only global unicast outside its special blocks, so IPv4-mapped, NAT64 and 6to4 addresses are refused); at most 3 redirects, each checked the same way; 10 seconds for the whole fetch, decompression included, after which it settles whatever the site does; 1 MB of body on the wire and after decompression, read as one stream pipeline so a corrupt or oversized compressed body fails only that fetch (REVIEW5 H1); an allowlisted content type and a body that starts with `BEGIN:VCALENDAR`.
  No cookies or credentials are sent, conditional requests use the stored `ETag` and `Last-Modified`, and the address is never logged.
- **Parsing:** the same bounded parser as the file import (`packages/core/src/ics-parse.ts`, REVIEW4 M2), at most 200 events per link.
- **Storage:** the address is a credential, so it lives only in `eventSubscriptions/{id}` (top level, server-only in `firestore.rules`); the app reads `users/{uid}/private/eventSubscriptions` (host, label, refresh state).
  Events go in `users/{uid}/events` with `source: 'feed'` and `feedId`; the rules let the app change only their place and activity.
  The Function keeps the per-account key list (`users/{uid}/meta/events`, at most 1,000 keys) in the same transaction as the events, and counts events that did not fit.
- **Limits:** at most 5 links per account; the scheduled `eventSubscriptionsRefresh` job (every 30 minutes, the third free Cloud Scheduler job) refreshes every due link, oldest due first, reading them a page at a time, 16 at a time, at most 3,000 a run, starting none after 200 seconds and giving each at most 90 seconds, and pauses while the cost guard is engaged (REVIEW5 M4).
  Each attempt claims its link before fetching, moving its next refresh time to its retry time, so no link can hold the queue; an attempt that never reports back counts as a `timeout` failure at the next one (REVIEW5 H1).
  A refresh writes only the events that are new or changed, and the same answer as last time is parsed again only once a day (REVIEW5 M2); the job logs the ERROR `linked calendar refresh is falling behind` when a link waits more than 6 hours past its time.
  A failing link waits 6, 12, 24, then 48 hours between attempts and is paused after 7 days of failures until the person presses Refresh (at most once per 10 minutes per link).
- **Places:** `GEO` is used as given; `LOCATION` text is searched at town level with the commercial place search, once per text per link, at most 10 a refresh, within a budget of its own, `EVENT_PLACE_LOOKUPS_PER_HOUR` (50) and `EVENT_PLACE_LOOKUPS_PER_DAY` (300) (defaults, owner may change; counters `forecastUpstream/event-places-*`), and 10 an hour per account, never place search's budget (REVIEW5 M1); otherwise the person's place, marked as guessed.
- **Heads-ups:** the `alerts` job looks at each Pro account's events when no morning or UV alert goes out for it; an event whose peak UV at its place (with the activity's shade and surface) reaches 6 gets a heads-up about 3 hours before it, moved to the evening before when that falls in quiet hours, never later than 15 minutes before the start, claimed in `users/{uid}/alertState/events` (delivery key `event-v1:<event key>`).
  Since REVIEW5 M3 (defaults, owner may change): only events that count as an outdoor activity get one (`countsAsOutdoorActivity` in `packages/core/src/event-heads-up.ts`: the event's activity is one of the person's, so meetings and "No activity" events get none); the same title starting within 30 minutes counts as one event across files, linked calendars and keys (the state keeps a hash of the title and the start, never the title); an account gets at most one heads-up every 3 hours, naming the soonest high-UV event and counting the others due, which it then covers; and a run reads every event whose heads-up can be due (the next 3 hours, or 20 in the last hour before quiet hours), not the soonest 5.
  The event's title comes from the calendar's publisher, so the push's title is Solara's own ("UV up to 8.0 during your 1pm event") and the body quotes the event's name, cleaned of links, domains, e-mail addresses, phone numbers and invisible formatting and cut to 40 characters (REVIEW5 L4).
  A push also covers every later high-UV outdoor event that could not get a heads-up of its own once the gap ends (its due window closes inside the gap or its quiet hours), and counts it in "N more" (REVIEW6 L2).
  Event places' forecasts go through the shared `forecastCache` within the global upstream budget and the account's share of it, at most 200 lookups a run (`ALERTS_MAX_EVENT_FORECASTS_PER_RUN`) and 10 per account (`ALERTS_MAX_EVENT_FORECASTS_PER_ACCOUNT`), soonest events first; the walk over the accounts only gathers their events, and the run then hands the lookups out one per account per round, the account whose next event starts soonest first, with places already looked up free (REVIEW6 M1; defaults, owner may change); the last minute of the run's 4 is kept for this; `eventHeadsUp: false` in the account turns them off.
- **Removal:** removing a link marks it `removing` (no refresh writes for it), deletes its events and their keys a page at a time, then its document and its summary entry, so a removal that stops halfway can be finished by removing again or by the scheduled run an hour later (REVIEW5 L2); account deletion deletes the account's links beside the calendar feed tokens, and a refresh of a link whose account is gone or being deleted removes the link and writes nothing under the account (REVIEW5 L3).

## Events from Google Calendar

Phase 2b of [integrations/EVENTS.md](integrations/EVENTS.md#phase-2b-as-built): the Events section reads the person's upcoming Google Calendar events in the browser and shows the UV at each.
It is hidden unless the build has both `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED=1` (from the `GOOGLE_CALENDAR_EVENTS_ENABLED` repository variable); turn it on only after Google verifies its scopes ([owner checklist](OWNER_CHECKLIST.md#events-from-google-calendar)).

- **Scopes:** `calendar.events.readonly`, requested by Google Identity Services when the person turns it on, and `calendar.calendarlist.readonly` only when they choose calendars; tokens stay in memory, as for Scheduled.
- **Reads:** `events.list` on each chosen calendar (at most 10) for the next 30 days, recurring events expanded, at most 4 pages of 250 per calendar, with `fields` limited to what the card needs; Solara's own scheduled windows are skipped.
- **Storage:** `users/{uid}/events` with `source: 'google'`, written by the app within the 1,000-event key list (at most 200 per refresh, the soonest), and `users/{uid}/meta/googleCalendar` (the chosen calendars and the last refresh), both checked by `firestore.rules`; unchanged events are not rewritten.
- **Refresh:** while Solara is open, every 30 minutes as long as this session holds a token (about an hour after a consent), otherwise when the person presses Refresh; there is no server job and no stored refresh token.
- **Disconnect:** deletes the `google` events and the connection document, then revokes the grant with GIS (`oauth2.googleapis.com` is in the CSP's `connect-src` for that); account deletion removes both with the rest of `users/{uid}`.

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
openssl rand -base64 48 | npx firebase functions:secrets:set TRIAL_HISTORY_KEY --data-file=- --project <project-id>
npx firebase deploy --only functions --project <project-id>
```

The `firebase.json` predeploy hook builds `@solara/core` and the TypeScript Functions before the upload.

The Functions deployment includes three scheduled jobs: `maintenance` (`functions/src/ops/functions.ts`), which runs every five minutes, `alerts` ([Pro alerts](#pro-alerts)), every 15 minutes, and `eventSubscriptionsRefresh` ([Linked calendars and event heads-ups](#linked-calendars-and-event-heads-ups)), every 30 minutes.
Cloud Scheduler gives each billing account three free jobs, so the background work shares one job, the alerts take the second and the linked calendar refresh the third; a fourth job would cost $0.10 a month.
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
The HTTP functions' caps are one table, `INSTANCE_CAPS`, sized for launch traffic (a few requests a minute) rather than for a flood: 3 instances for `forecast`, 2 for `calendarFeed`, and 1 for each of the other eleven (`stripeWebhook`, `placeSearch` and `eventSubscriptions` included), 16 in all.
HTTP functions run on one vCPU and serve up to 20 requests per instance at once (40 for the forecast proxy and the calendar feed); `maintenance`, `alerts`, `eventSubscriptionsRefresh` and `budgetAlert` run one instance with a fractional CPU (`gcf_gen1`) and are not retried, because the next run or notification resumes the work.
`functions/test/hardening.test.js` loads the deploy entry point and fails when a function lacks a ceiling or the HTTP caps add up to more than 16.
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
Each IPv6 request also counts against its /48 at 4 times the limit (`IPV6_SITE_WEIGHT`, default, owner may change), because a /48 is one site (free from tunnel brokers, common on servers) and holds 65,536 /64s (REVIEW4 M1).
A request a prefix has already refused is turned away without opening a window for its /64, and the limiter never forgets a live window: it drops expired windows and keeps at most 10,000 exact ones.
When all 10,000 are live (a flood of new addresses), a new key is counted in a fixed-size count-min sketch for the rest of the minute instead (REVIEW5 M5): the sketch never under-counts, so a sprayed key is held to the same limit and keeps its count if it later gets an exact window, while a newcomer is still served.
The sketch takes 2 MB once used, its cells are chosen with a per-instance secret so collisions cannot be aimed at another client, and in a flood of 100,000 new keys a minute about 1 newcomer in 100 loses one request of its budget.
These limits live in instance memory, so each instance enforces its own: the effective limit for one address is the per-minute limit times the function's instance cap (for example 60 x 1 for checkout, 120 x 3 for the forecast proxy).
That is the right shape for a first line against one noisy client; the costs that must be bounded globally use shared counters instead (the forecast proxy's upstream budget and each caller's share of it).

### Cost guard and budget kill switch

Paths whose cost an outsider's traffic drives (the calendar feed, new feed links, notification registration, and the forecast proxy's upstream calls when it is on) stop while the Firestore switch `systemFlags/costGuard` is engaged (`functions/src/shared/cost-guard.ts`).
The scheduled Pro alerts are not among them: their cost is bounded by the number of Pro accounts, so only the owner's pin (`infra/cost-guard.sh engaged`) pauses them.
The `budgetAlert` Function, which runs as its own `solara-budget` service account and acts only on the budget named by `BUDGET_ID`, has three tiers (defaults, owner may change, in `functions/.env`): a warning at 50% of the budget, the cost guard at 100% until the next budget period starts, and detaching billing at 300%, which stops the Functions while Hosting keeps serving the site.
Detaching is on by default; set the `COST_GUARD_DETACH_BILLING` repository variable to `false` to switch it off.
The budget ($25 a month by default), the topic, the identity and its role are created by `infra/budget.sh`; what to do when the switch fires is in the [runbook](RUNBOOK.md#budget-kill-switch).

### Pro billing

Pro is sold through Stripe Checkout once the owner switches billing on (`BILLING_ENABLED`); until then the plans dialog keeps the waitlist and `createCheckoutSession` refuses.

- The plans dialog (`components/PricingModal.tsx`) offers the monthly and yearly plans; `createCheckoutSession` (`functions/src/billing/checkout.ts`) maps the chosen plan to its price and binds the session to the signed-in account.
- An account that never had a trial gets `PRO_TRIAL_DAYS` (7, in `packages/core/src/plans.ts`) free: Checkout asks for a card up front (`payment_method_collection: always`), and a trial that ends without a payment method cancels itself. `stripeTrialUsed` on the account, any earlier trial on the same Stripe customer, and the [trial history](#trial-history) rule out a second trial.
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

- **One provider adapter**: `packages/core/src/forecast.ts` defines the providers (`openMeteoFree`, `openMeteoCommercial`, `solaraForecastProxy`), and every caller, the browser (the dashboard and setup's current UV), the proxy, the calendar feed and the alerts, reads the answer with the same validated parser (`fetchProviderForecast`).
- **One shared cache**: one forecast per place and UTC hour (`ForecastCache` in `functions/src/forecast/proxy.ts`), which the proxy, the calendar feed and the Pro alerts all read through; each instance keeps a copy in memory and all instances share `forecastCache/{place}` in Firestore, so a place costs at most one upstream call an hour across the whole app.
  Concurrent requests for a place share one call.
- **Grid**: places snap to a 0.02 degree grid (`FORECAST_GRID_DEGREES`, at most about 1.1 km from the asked-for point).
  In a sample of 32 cities (2026-10-27, three days of hourly forecasts, comparing each city with the corner points the grid could snap it to), 0.02 degree changed the whole-number UV of 0.8% of daylight hours (99th percentile difference 0.25 UV), 0.05 degree 5.2% (1.55 UV) and 0.1 degree 8.4% (1.9 UV), with temperature differences up to 12 C in mountain cities.
  So 0.02 degree is as coarse as the grid can go without visibly changing forecasts; it has a quarter of the 0.01 degree grid's cells, and the upstream budget below, not the grid, is what bounds cost.
- **Upstream budget** (finding M1): the proxy and the feed together may call the paid API at most `FORECAST_UPSTREAM_PER_HOUR` (1,500) times an hour and `FORECAST_UPSTREAM_PER_DAY` (20,000) times a day (defaults, owner may change, in `functions/.env`), counted across instances in `forecastUpstream/hour-<hour>` and `day-<day>` (`functions/src/forecast/upstream-budget.ts`); each instance leases 10 calls at a time. 20,000 a day is 60% of the Standard plan's 1 million calls a month (about 33,000 a day; each app forecast is one call: 8 variables, 10 days), leaving the rest for the Pro alerts, which are bounded by their own per-run caps and not counted.
  When the budget is spent, or the counters cannot be read, it fails closed: cached forecasts (up to 12 hours old) are still served, a place with none gets 503, and the ERROR `forecast upstream budget exhausted` reaches the owner.
- **Fair shares** (REVIEW4 H1): on its own, the budget is first come, first served, so one caller with one App Check token could spend the hour on new places and leave everyone else with cached forecasts.
  So each caller may cause at most `UPSTREAM_SHARE_PER_CALLER` (20, default, owner may change) upstream calls per UTC hour, counted across instances in `forecastUpstream/caller-<budget>-<hour>-<hash>` (`functions/src/forecast/caller-share.ts`).
  A caller is keyed like the per-address limits: an IPv4 address with its /24 allowed 4 times the share (`IPV4_NETWORK_WEIGHT`, REVIEW5 L1), or an IPv6 /64 with its /48 allowed 4 times the share, so a /48 cannot hold 65,536 shares and 75 addresses of one hosting block cannot spend the hour (they get 80 calls).
  The counter ids hold a hash of the key, not the address, and expire with the budget's counters.
  Only a cache miss is charged, so looking at places someone else already fetched this hour costs nothing; an instance remembers callers whose share is spent, runs one caller's counter transactions one at a time, and skips the share entirely while it knows the global budget is spent.
  It fails closed like the budget.
  One person rarely looks at more than a few new places an hour; a page that shows many new places at once (the Events section with many venues) gets cached forecasts or 503 for the places past the share.
- **A reserve for signed-in and Pro work** (REVIEW5 L1): no per-address scheme stops an attacker with addresses in many networks (a rotating residential proxy), so the browser's forecasts through the proxy may spend only two thirds of the global budget (`BROWSER_SHARE_OF_UPSTREAM`, default, owner may change: 1,000 an hour and 13,333 a day of the defaults), counted on the same counters; the last third stays for the calendar feed and event heads-ups.
  A flood from many networks can then leave guests with cached forecasts for new places for the rest of the hour, but not stop the feed or Pro heads-ups; App Check (enforced at launch) and the cost guard remain the defenses against the flood itself.
  Not done, for later if real traffic needs it: serving the nearest cached cell before a 503, and limited-use App Check tokens for cache misses.
- **Stale copies while the budget is spent** (REVIEW4 H1): when Solara itself declines the upstream call (the cost guard, the budget or the caller's share), the last good forecast for the place is served up to 12 hours old (`BUDGET_LAST_GOOD_MAX_AGE_MS`, default, owner may change) instead of a 503, and the proxy's answer then carries `stale: true` and the copy's `fetchedAt`.
  The app reads both through `ServedForecastSchema` in `packages/core/src/forecast.ts`, dates the forecast by `fetchedAt`, and shows a note on the dashboard saying when it was updated (`components/ForecastNotice.tsx`).
  A 12-hour-old forecast still holds the day's hourly UV curve; the reading for "now" falls back to the forecast for the current hour once the copy is over 90 minutes old.
- **Timeout and fallback**: the upstream call times out after 5 seconds; then the last good forecast for the place, at most 6 hours old, is served instead.
  A fallback is remembered in memory for 5 minutes, so repeated requests cost no Firestore read, and fallbacks are logged once a minute per reason.
- **Limits**: App Check (standard), 120 requests a minute per address, three instances, and only the app's own request (the coordinates are the only input); while the cost guard is engaged, only cached forecasts are served.
- **Calendar feed** (finding M3): reads through the same cache and budget, and each feed may cause at most `FEED_UPSTREAM_PER_HOUR` (4) upstream calls an hour per instance, so an account that keeps moving its location cannot make every feed request a paid call; past that it gets the cached forecast or a 503 with `Retry-After: 900`, and calendar apps keep their last copy.
- **Switch**: the `FORECAST_PROXY_ENABLED` repository variable turns it on in the build and the Functions together; until then the browser calls Open-Meteo directly, as today, and setup's current-UV check goes through the proxy too once it is on.
- **Place search** (finding L3): Open-Meteo's terms make its free API non-commercial for every API, geocoding included, and its paid plans include the Geocoding API on the customer host.
  So once the proxy is on, the app's place search (setup, the location panel, Settings) calls the `placeSearch` Function instead of `geocoding-api.open-meteo.com` (`functions/src/forecast/place-search.ts`, `lib/geocoding.ts`).
  It checks the search (2-80 characters, at most 10 results), asks `customer-geocoding-api.open-meteo.com` with the key, returns only the validated fields, caches answers in memory for a day, and counts misses against its own budget, `PLACE_SEARCH_UPSTREAM_PER_HOUR` (200) and `PLACE_SEARCH_UPSTREAM_PER_DAY` (2,000) (defaults, owner may change; counters `forecastUpstream/places-hour-<hour>` and `places-day-<day>`), and the caller's share of it (REVIEW4 H1), so searches cannot spend the forecasts' calls or the other way round; App Check, 60 requests a minute per address, one instance.
  When it is spent, the ERROR `place search upstream budget exhausted` reaches the owner.
  "Use my location" names still come from Nominatim, whose usage policy allows that use.
- **The feed's provider** (finding L3): the commercial API as soon as `OPEN_METEO_API_KEY` holds a real key; before that, Open-Meteo's free API only while billing is off (no Pro is sold, so the use is non-commercial).
  Once `BILLING_ENABLED` is on without a key, the feed serves what is cached and otherwise answers 503 instead of using the free API commercially.
  Forecasts from the free API stay in the feed instance's memory and are never written to the shared cache, and every cached entry records its source, so the proxy and the alerts never serve a free-API (or untagged) forecast (REVIEW4 L7).

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

Deletion keeps one record on purpose: the [trial history](#trial-history) of an account that had the free trial, for 2 years, so the trial stays once per person.

The export (`exportAccountData`) holds the portable preferences, a billing summary (plan, interval, status, Pro since, trial end, current period end, cancellation, payment failed since, trial used), scheduled activities, device metadata and the Pro alert history (`alerts`: for the morning and the UV alert, the last day sent, its status, attempts, devices reached, times and any FCM error code, from `alertState/daily`, which is kept 7 days) and the imported events, never a Stripe identifier, a token or an internal attempt id.
It reads everything in one read-only transaction, so every part comes from the same moment, and reads the collections in pages of 200 documents, turning each page into plain records before the next, so the single 256 MiB instance never holds a whole collection of Firestore snapshots (REVIEW4 M4).
Each collection is capped at 5,000 documents (`EXPORT_COLLECTION_LIMIT`, well above what the app lets an account keep); a section cut short is named in the export's `truncated` list, and the account page says so.

### Trial history

The free trial is once per person, not once per account (`functions/src/billing/trial-history.ts`; default decision, see [ROADMAP](ROADMAP.md#decisions)).
When a trial starts, the webhook records keyed hashes (HMAC-SHA256 with the `TRIAL_HISTORY_KEY` secret) of each sign-in provider's stable user id (the Google account's id), the verified email address (trimmed and lowercased) and the card's Stripe fingerprint in the server-only `trialHistory` collection.
Each record holds only its kind, a keyed hash of the subscription, and `expireAt` 2 years on; the rules deny every client access, and account deletion leaves it in place.

- Checkout offers no trial when the signed-in identity or verified email is on record.
- The webhook (`checkout.session.completed` and `customer.subscription.updated`) ends a trial at once (`trial_end: 'now'`, so billing starts) when the card, or an identity, already had a trial from another subscription, and logs `a free trial already used by this person or card was ended`.
- The card is read from the subscription's `default_payment_method`, which Checkout sets.

`TRIAL_HISTORY_KEY` is random (48 bytes from `openssl rand`), and rotating it forgets every recorded trial, so it is rotated only if it leaks ([RUNBOOK](RUNBOOK.md#secret-rotation)).

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
Set the `ALERTS_ENABLED` repository variable to `false` and redeploy, or pin the cost guard (`infra/cost-guard.sh engaged --apply`) for an immediate stop, before investigating any duplicate or incorrectly timed alert.
Rotate a compromised service account, calendar-feed token, FCM token, or Stripe webhook secret immediately.
Do not log full notification tokens, calendar tokens, service-account JSON, or Stripe secrets.

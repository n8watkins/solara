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
- `NEXT_PUBLIC_PRO_PRICE` controls the displayed Pro price.
- `NEXT_PUBLIC_FUNCTIONS_URL` enables Function-backed product surfaces.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` offers an explicit analytics choice and loads GA4 only after the visitor opts in.

All `NEXT_PUBLIC_*` variables are public and compiled into the browser bundle.
Never put a Stripe secret, Firebase service-account JSON, webhook secret, or OAuth client secret in a `NEXT_PUBLIC_*` variable.

## GitHub Actions configuration

The build reads every `NEXT_PUBLIC_*` value from a repository variable first and falls back to a repository secret of the same name.
These values are public, so they belong in variables; [WIF_SETUP.md](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables) shows how to move them.
`.github/scripts/check-public-env.mjs` fails the build when a required value is missing, points at another project, is not https where a URL is expected, looks like a real secret, or did not make it into `out/`.

Repository variables:

- `ENABLE_BLAZE_FUNCTIONS`: `true` makes `main` deploy Functions and compile `NEXT_PUBLIC_FUNCTIONS_URL` into the client; anything else keeps Function-backed surfaces off.
- `STRIPE_PRICE_ID`: the Stripe Pro price, written into `functions/.env.<project-id>` by the Functions deploy job, which fails without it.
- `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` and `GCP_NOTIFIER_SERVICE_ACCOUNT`: Workload Identity Federation ([WIF_SETUP.md](WIF_SETUP.md)).
- `FIREBASE_PROJECT_ID` (optional): the deploy target, `uv-activity-planner` by default.

Repository secrets:

- `FIREBASE_SERVICE_ACCOUNT`: a service-account JSON key, used only while the WIF variables are unset.
  `.github/actions/firebase-cli` logs a warning whenever it falls back to the key.
  The key's identity needs `roles/datastore.indexAdmin` for the Firestore indexes job.

Server configuration for Functions:

- `functions/.env` holds the non-secret params (`APP_URL`, and an empty `STRIPE_PRICE_ID` default), because non-interactive deploys resolve `defineString` params only from `functions/.env*` files.
  `.github/scripts/check-functions-params.js` resolves them exactly as a deploy does, and runs in CI.
- Firebase Secret Manager stores `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

## Firebase console setup

1. Enable Google Authentication.
2. Add the production and preview domains to Authentication Authorized domains.
3. Create Firestore and deploy the repository rules.
4. Enable Cloud Messaging and generate a Web Push VAPID key.
5. Register the web app for App Check with reCAPTCHA Enterprise (preferred) or reCAPTCHA v3, set the site key and matching `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER`, monitor enforcement metrics, and then enforce supported Firebase products (see [App Check](#app-check)).
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
2. One job builds the static export with the checked public configuration, smoke-tests that `out/` on the Hosting emulator, and packages it with its SHA-256 digest, CycloneDX SBOMs and a provenance record.
3. Firestore rules and Firestore indexes deploy as separate jobs, so an index failure is visible on its own and does not hide whether Hosting published.
4. When `ENABLE_BLAZE_FUNCTIONS` is `true`, the Functions job writes the project's `STRIPE_PRICE_ID`, builds `@solara/core` and the Functions, re-runs the params and payload checks, and deploys after rules and indexes.
5. Hosting verifies the digest and deploys exactly the tested artifact, after rules and, when they deploy, Functions.

Pull requests run the same quality workflow without deploying.
The repository has no branch protection yet, so nothing enforces review; do not push directly to `main`.

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

For a manual Functions deploy, put `STRIPE_PRICE_ID=<price-id>` in `functions/.env.<project-id>`; `APP_URL` comes from `functions/.env`.
Deploy Hosting only from the `out/` of a production build (`npm run build`), because the CSP and public configuration are baked in at build time.

## Service worker generation

`public/firebase-messaging-sw.js` is a generated, ignored artifact.
Both `npm run dev` and `npm run build` run `scripts/generate-sw.js` first, which bundles `scripts/sw/firebase-messaging-sw.ts` with the app's npm Firebase SDK and the Firebase values in `.env.local` or the deployment environment.
The worker loads no script from a CDN, and notification clicks open only same-origin links, focusing an open Solara window when there is one.
Do not commit or hand-edit the generated worker.
Re-run the generator through either command after changing Firebase client configuration.

## Content Security Policy

`npm run build` ends with `scripts/csp.mjs`, which writes a `<meta http-equiv="Content-Security-Policy">` tag into every HTML file in `out/`.
Each page's policy lists the SHA-256 hash of every inline script on that page, so scripts never need `'unsafe-inline'`.
The policy itself is defined in `lib/csp.mts`; add a host there, with a comment saying what needs it, when a new third-party service is introduced, and list the service in the privacy policy.
The Functions origin and Firebase auth domain come from `NEXT_PUBLIC_FUNCTIONS_URL` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` at build time, so deploy the `out/` directory produced by the same build.
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

The Functions deployment includes three scheduled maintenance jobs:

- `backfillStripeBillingResources` runs hourly and builds durable ownership records for existing Stripe resources.
- `cleanupDeletedAccountBilling` runs every five minutes and resumes account deletion, Stripe cancellation, and data cleanup with bounded retries.
- `cleanupFailedCheckouts` runs every five minutes and neutralizes Stripe Checkout Sessions that could not be cleaned up during the original request.

The scheduled jobs depend on the `accountDeletionTombstones`, `billingCleanupResources`, and `stripeCheckoutCleanupTasks` indexes in `firestore.indexes.json`.
Confirm those indexes are ready and all three jobs run successfully before enabling checkout or account deletion.
Allow the billing-resource backfill to complete before relying on deletion cleanup for legacy Stripe customers and subscriptions.

Register the deployed Stripe webhook URL in Stripe test mode first.
Subscribe the endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
Run the Stripe checks in the [owner checklist](OWNER_CHECKLIST.md#functions-and-stripe) in test mode before using live mode; no local test can replace these Stripe-signed integration checks.

## App Check

The Functions enforce App Check in code, so they reject requests without a valid token as soon as they are deployed; the site key must be configured before Function-backed surfaces are enabled.
Firestore enforcement is a separate console switch.
To turn it on:

1. Create a reCAPTCHA Enterprise key for the production domains (or reuse the existing v3 key) and register it for the web app under App Check in the Firebase console.
2. Set `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` and, for Enterprise, `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER=recaptcha-enterprise` for the production build.
3. Deploy, then watch the App Check metrics for Firestore until verified requests dominate.
4. Enforce App Check for Cloud Firestore in the console.

Because App Check starts after sign-in, enforcing Firestore never affects signed-out visitors, who make no Firestore requests.

## Calendar feed tokens

Calendar feed links are capability URLs, so the server mints their tokens (32 random bytes, base64url) through `rotateCalendarFeed` and revokes them through `revokeCalendarFeed`.
Each live token is indexed by its SHA-256 hash in the server-only `calendarFeeds/{hash}` collection, and the feed resolves a token with one document read.
The owner reads the current link from `users/{uid}/private/calendarFeed`, which clients cannot write.
Feed responses are `Cache-Control: private, max-age=900` with a weak `ETag`, and both a single feed and an address that keeps requesting unknown tokens are rate limited.
Account deletion removes the account's `calendarFeeds` entries along with the user document.

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
The backend creates `accountDeletionTombstones/{uid}`, blocks further account access, revokes Firebase sessions, cancels owned Stripe resources, removes notification ownership records and calendar feed index entries, recursively deletes the user document, and deletes the Firebase Authentication user.
The scheduled cleanup job resumes incomplete work with leases and retry backoff until `cleanupStatus` becomes `completed`.

Monitor `cleanupStatus`, `cleanupLastError`, `cleanupNextAttemptAt`, and the `cleanupDeletedAccountBilling` logs for pending deletions.
Do not manually remove a tombstone or mark it complete while billing cleanup resources remain pending.
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

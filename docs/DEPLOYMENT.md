# Solara Deployment Guide

_Last reviewed: 2026-07-15_

Solara exports a static Next.js site to `out/` and hosts it on Firebase Hosting.
Firebase Functions provide trusted server behavior for billing, account data, notification registration, scheduled cleanup, and calendar feeds.
The notification dispatcher is available as a manual GitHub Actions workflow until live scheduled delivery is approved.

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

Required for push registration:

- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
- `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`
- `NEXT_PUBLIC_FUNCTIONS_URL`

The notification registration endpoints require a valid App Check token and paid entitlement.

Optional feature activation:

- `NEXT_PUBLIC_SITE_URL` sets the canonical deployed origin.
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` enables Google Calendar access.
- `NEXT_PUBLIC_PRO_PRICE` controls the displayed Pro price.
- `NEXT_PUBLIC_FUNCTIONS_URL` enables Function-backed product surfaces.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` offers an explicit analytics choice and loads GA4 only after the visitor opts in.

All `NEXT_PUBLIC_*` variables are public and compiled into the browser bundle.
Never put a Stripe secret, Firebase service-account JSON, webhook secret, or OAuth client secret in a `NEXT_PUBLIC_*` variable.

## GitHub Actions secrets

Add the required client variables above as repository secrets.
Also add `FIREBASE_SERVICE_ACCOUNT` as the complete JSON for a narrowly scoped deployment and notification service account.
The deployment workflow uses that credential to publish Hosting, Firestore rules, and Firestore indexes.
It also publishes Functions when `ENABLE_BLAZE_FUNCTIONS` is `true`.
The notification workflow uses it to access notification data and send through Firebase Cloud Messaging.

Server configuration is split across these locations:

- Firebase Secret Manager stores `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- GitHub Actions provides `NEXT_PUBLIC_SITE_URL` to Functions as `APP_URL` and provides `STRIPE_PRICE_ID` as a deploy-time Functions parameter.
- The `ENABLE_BLAZE_FUNCTIONS` GitHub repository variable controls whether the deployment publishes Functions and exposes `NEXT_PUBLIC_FUNCTIONS_URL` in the client build.
- GitHub repository secrets store `NEXT_PUBLIC_FUNCTIONS_URL`, `FIREBASE_SERVICE_ACCOUNT`, and the public client configuration used during the static build.

Before enabling the backend deployment, put the project on Blaze, configure both Stripe secrets in Firebase Secret Manager, and configure `STRIPE_PRICE_ID`, `NEXT_PUBLIC_FUNCTIONS_URL`, and `NEXT_PUBLIC_SITE_URL` in GitHub.
When `ENABLE_BLAZE_FUNCTIONS` is `true`, the main deployment passes `NEXT_PUBLIC_SITE_URL` as `APP_URL` and `STRIPE_PRICE_ID` to the Functions deployment before it deploys Hosting.

The `main` deployment is blocked until lint, typecheck, app and Functions unit tests, Firestore emulator rules tests, production build, and browser smoke tests pass.
Pull requests and non-main pushes run the same quality checks without deploying.

## Firebase console setup

1. Enable Google Authentication.
2. Add the production and preview domains to Authentication Authorized domains.
3. Create Firestore and deploy the repository rules.
4. Enable Cloud Messaging and generate a Web Push VAPID key.
5. Register the web app for App Check with reCAPTCHA v3, set the site key, monitor enforcement metrics, and then enforce supported Firebase products.
6. Enable Hosting.
7. Upgrade to Blaze only when Functions are ready to deploy.
8. Set a billing budget alert before the first Functions deployment.

For local Firebase CLI use, select the intended project explicitly.

```bash
npx firebase-tools use <project-id>
```

## First deployment

Verify the same gates used by CI.

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
npm ci --prefix functions
npm audit --prefix functions --audit-level=high
npm test --prefix functions
npm run test:rules --prefix functions
npx playwright install chromium
npm run test:e2e
```

Merge a reviewed pull request into `main` after the required GitHub secrets exist.
The deployment workflow deploys Firestore indexes on every release so manual notification dry-runs have the required collection-group index even while Functions remain disabled.
When `ENABLE_BLAZE_FUNCTIONS` is `true`, the workflow builds with those values, deploys transitional Firestore rules, deploys Functions, deploys Hosting, and then restores the final rules.
When the variable is not `true`, the workflow keeps Function-backed client surfaces disabled, deploys indexes and Hosting, and restores the final Firestore rules.

## Service worker generation

`public/firebase-messaging-sw.js` is a generated, ignored artifact.
Both `npm run dev` and `npm run build` run `scripts/generate-sw.js` first and create it from the Firebase values in `.env.local` or the deployment environment.
Do not commit or hand-edit the generated worker.
Re-run the generator through either command after changing Firebase client configuration.

For a controlled manual deployment, use an explicit project ID.

```bash
npx firebase-tools deploy --only firestore --config firebase.pre-functions.json --project <project-id>
npx firebase-tools deploy --only functions --project <project-id>
npx firebase-tools deploy --only hosting --project <project-id>
npx firebase-tools deploy --only firestore:rules --project <project-id>
```

Supply `APP_URL` and `STRIPE_PRICE_ID` when manually deploying Functions.
Wait for every index in `firestore.indexes.json` to report `READY` before enabling Function-backed account or billing surfaces.

## Notification activation

The notification workflow installs the committed dependency graph with `npm ci` and prevents overlapping dispatch runs.
Scheduled delivery remains disabled until the real-device verification below is complete and live activation is approved.

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

Before adding a schedule, verify all of the following on a real phone:

1. The account is eligible for notifications.
2. The deployed Functions URL is configured so the authenticated registration endpoint can store the device.
3. The device registration is stored for the correct signed-in paid account.
4. Registering the same phone under another account transfers ownership instead of retaining two deliveries.
5. Legacy notification fields are cleared after the first successful device migration.
6. A dry run selects the expected user, activity, and local date.
7. One manual real send creates exactly one system notification.
8. Tapping the notification opens the intended Solara route.
9. Disabling notifications or signing out stops delivery to that device.

## Firebase Functions and Stripe

Functions require a reproducible install in `functions/` and a Blaze-enabled Firebase project.
Configure Stripe secrets with the Firebase CLI instead of local files or GitHub build variables.
Keep the `ENABLE_BLAZE_FUNCTIONS` GitHub repository variable unset until the project is Blaze-enabled and the required Functions and Stripe configuration is ready.
Set it to `true` only when the transitional rules, Functions, and final rules deployment sequence should run on `main`.
The deployment always restores the final rules after the Functions and Hosting deployment attempt, including when either deployment fails, so transitional rules are never left active.

```bash
cd functions
npm ci
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET
npx firebase-tools deploy --only functions --project <project-id>
```

The Functions deployment includes three scheduled maintenance jobs:

- `backfillStripeBillingResources` runs hourly and builds durable ownership records for existing Stripe resources.
- `cleanupDeletedAccountBilling` runs every five minutes and resumes account deletion, Stripe cancellation, and data cleanup with bounded retries.
- `cleanupFailedCheckouts` runs every five minutes and neutralizes Stripe Checkout Sessions that could not be cleaned up during the original request.

The scheduled jobs depend on the `accountDeletionTombstones`, `billingCleanupResources`, and `stripeCheckoutCleanupTasks` indexes in `firestore.indexes.json`.
Confirm those indexes are ready and all three jobs run successfully before enabling checkout or account deletion.
Allow the billing-resource backfill to complete before relying on deletion cleanup for legacy Stripe customers and subscriptions.

Register the deployed Stripe webhook URL in Stripe test mode first.
Subscribe the endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
Verify a successful checkout, duplicate webhook delivery, cancellation, payment failure, and entitlement revocation before using live mode.
Also verify repeated checkout is rejected, out-of-order events cannot restore canceled access, and changing away from the configured Pro price revokes the entitlement.
Open the account page and verify the Stripe customer portal can update payment details, display invoices, and cancel the subscription.
No local test can replace these Stripe-signed integration checks when keys and a test account are unavailable.

## Account export and deletion

Account export and deletion require `NEXT_PUBLIC_FUNCTIONS_URL` and an authenticated account.
Deletion additionally requires a recent Google reauthentication and the exact `DELETE` confirmation.

Deletion may return HTTP 202 and sign the user out while cleanup continues.
The backend creates `accountDeletionTombstones/{uid}`, blocks further account access, revokes Firebase sessions, cancels owned Stripe resources, removes notification ownership records, recursively deletes the user document, and deletes the Firebase Authentication user.
The scheduled cleanup job resumes incomplete work with leases and retry backoff until `cleanupStatus` becomes `completed`.

Monitor `cleanupStatus`, `cleanupLastError`, `cleanupNextAttemptAt`, and the `cleanupDeletedAccountBilling` logs for pending deletions.
Do not manually remove a tombstone or mark it complete while billing cleanup resources remain pending.
Before production activation, verify that export excludes capability tokens and payment-provider identifiers and that deletion eventually removes the user data, notification registration, owned subscription, and Authentication account.

## Google Calendar activation

Create a Google OAuth Web client, enable the Calendar API, configure its consent screen, and add each deployed origin as an Authorized JavaScript origin.
Set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and deploy again.
Verify that Solara reads only free/busy data and that creating an event produces the expected time and description.

## Operational rollback

Use the Firebase Hosting release history to roll Hosting back.
Disable the notification workflow before investigating any duplicate or incorrectly timed delivery incident.
Rotate a compromised service account, calendar-feed token, FCM token, or Stripe webhook secret immediately.
Do not log full notification tokens, calendar tokens, service-account JSON, or Stripe secrets.

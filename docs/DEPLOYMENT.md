# Solara Deployment Guide

_Last reviewed: 2026-07-14_

Solara exports a static Next.js site to `out/` and hosts it on Firebase Hosting.
Firebase Functions provide trusted server behavior for Stripe fulfillment and the live calendar feed.
The notification dispatcher runs in GitHub Actions every 15 minutes and decides which users are due based on application logic.

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

Recommended after registering the production web app with Firebase App Check:

- `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`

Optional feature activation:

- `NEXT_PUBLIC_SITE_URL` sets the canonical deployed origin.
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` enables Google Calendar access.
- `NEXT_PUBLIC_PRO_PRICE` controls the displayed Pro price.
- `NEXT_PUBLIC_FUNCTIONS_URL` enables Function-backed product surfaces.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` enables GA4 when it matches a valid `G-*` measurement ID.

All `NEXT_PUBLIC_*` variables are public and compiled into the browser bundle.
Never put a Stripe secret, Firebase service-account JSON, webhook secret, or OAuth client secret in a `NEXT_PUBLIC_*` variable.

## GitHub Actions secrets

Add the required client variables above as repository secrets.
Also add `FIREBASE_SERVICE_ACCOUNT` as the complete JSON for a narrowly scoped deployment and notification service account.
The workflows currently use that credential to deploy Hosting and Firestore rules and to access notification data.

The `main` deployment is blocked until lint, typecheck, unit tests, production build, and browser smoke tests pass.
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
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Push to `main` after the required GitHub secrets exist.
The deployment workflow builds with those values, deploys Hosting, and then deploys Firestore rules.

For a controlled manual deployment, use an explicit project ID.

```bash
npx firebase-tools deploy --only hosting,firestore:rules --project <project-id>
```

## Notification activation

The notification workflow installs the committed dependency graph with `npm ci` and prevents overlapping dispatch runs.
The scheduled run occurs every 15 minutes so the sender can honor per-user local-time eligibility.

Use `workflow_dispatch` for controlled verification.
Start with `dry_run = true`.
Use `force_send = true` only when you intentionally need to bypass local-time eligibility during a manual test.
Application idempotency should still prevent the same delivery from being sent twice.

Before enabling scheduled sends, verify all of the following on a real phone:

1. The account is eligible for notifications.
2. The device registration is stored for the correct signed-in account.
3. A dry run selects the expected user, activity, and local date.
4. One manual real send creates exactly one system notification.
5. Tapping the notification opens the intended Solara route.
6. Disabling notifications or signing out stops delivery to that device.

## Firebase Functions and Stripe

Functions require a reproducible install in `functions/` and a Blaze-enabled Firebase project.
Configure Stripe secrets with the Firebase CLI instead of local files or GitHub build variables.

```bash
cd functions
npm ci
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET
npx firebase-tools deploy --only functions --project <project-id>
```

Register the deployed Stripe webhook URL in Stripe test mode first.
Verify a successful checkout, duplicate webhook delivery, cancellation, payment failure, and entitlement revocation before using live mode.
No local test can replace these Stripe-signed integration checks when keys and a test account are unavailable.

## Google Calendar activation

Create a Google OAuth Web client, enable the Calendar API, configure its consent screen, and add each deployed origin as an Authorized JavaScript origin.
Set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and deploy again.
Verify that Solara reads only free/busy data and that creating an event produces the expected time and description.

## Operational rollback

Use the Firebase Hosting release history to roll Hosting back.
Disable the notification workflow before investigating any duplicate or incorrectly timed delivery incident.
Rotate a compromised service account, calendar-feed token, FCM token, or Stripe webhook secret immediately.
Do not log full notification tokens, calendar tokens, service-account JSON, or Stripe secrets.

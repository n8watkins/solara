# Solara Project Status

_Last reviewed: 2026-10-23_

Claims marked "owner to confirm" could not be checked from the repository, GitHub or the Firebase CLI and need console access.

## Current source baseline

Solara is a Next.js 16 and React 19 static application deployed through Firebase Hosting.
Google sign-in is required before users can reach the personalized dashboard.
Firestore stores account preferences, and trusted backend paths are responsible for billing entitlements and notification delivery state.
The backend maintains durable Stripe ownership indexes, retries failed checkout cleanup, and completes account deletion through tombstone-owned scheduled cleanup.
Firebase Functions target the Node.js 24 runtime with `firebase-functions` 7, `firebase-admin` 14 and `stripe` 22; the local and CI Node.js version comes from `.nvmrc` (24).

The repository includes unit coverage for the core planning modules and credential-free Playwright coverage for the welcome, onboarding and analytics-consent flows on desktop and mobile Chromium.
CI blocks on production dependency audits (`npm audit --omit=dev --audit-level=high`) for the app and Functions, lint, typecheck, app and Functions tests, Firestore emulator rules tests, production build, and browser smoke tests before a production deploy can begin.
The full audit, including development dependencies, runs as a non-blocking step; accepted development advisories are recorded in [DEPENDENCY_RISK.md](./DEPENDENCY_RISK.md).

## Production state

Checked on 2026-10-23.

- **Hosting:** the static app is served at `https://uv-activity-planner.web.app` (Firebase project `uv-activity-planner`).
  Any custom domain is owner to confirm.
  The latest Hosting release is from commit `82294e8`, published on 2026-10-23.
- **Firestore rules:** the final rules in `firestore.rules` are deployed by every `main` deployment.
- **Firestore indexes:** every deployment since 2026-07-15 has failed at the index step because the deployment service account lacks `roles/datastore.indexAdmin`.
  Hosting and rules still publish, but the workflow run is reported as failed.
- **Firebase Functions:** not deployed.
  The Cloud Functions API is not enabled on `uv-activity-planner` (`firebase functions:list` returns 403), and the `ENABLE_BLAZE_FUNCTIONS` repository variable is not set, so deployments skip Functions and build the client with an empty `NEXT_PUBLIC_FUNCTIONS_URL`.
  Checkout, the billing portal, account export and deletion, notification device registration, the calendar feed and the three scheduled billing and deletion jobs are therefore unavailable in production, and the client hides or disables their controls.
- **Firebase billing plan (Spark or Blaze):** owner to confirm.
- **Morning notifications:** not sent since 2026-07-15.
  Pull request #13 removed the daily `notify.yml` schedule; the last scheduled run was on 2026-07-14 and the only later run, a manual dry run on 2026-07-15, failed on the missing `notificationDevices.enabled` collection-group index.
  The workflow can now only be started manually, and new device registrations need the undeployed `registerNotificationDevice` Function.
  The pricing modal and `PRO_FEATURES` in `lib/billing.ts` still advertise "morning sun-window alerts" as a Pro feature.
- **Repository:** private on GitHub Free, with no branch protection, rulesets or environments.
  Any push to `main`, reviewed or not, runs the production deployment.

## Feature activation state

| Area | Source state | Production state and remaining activation |
| --- | --- | --- |
| Forecast and activity planning | Built | Live. Verify Open-Meteo behavior and recommendation consistency |
| Google sign-in and Firestore sync | Built | Live. Preference persistence still needs a controlled signed-in account check |
| Push notifications | Built; manual dispatcher only, no schedule | Not delivering. Needs deployed Functions, the collection-group index, VAPID, an eligible test account, real-device verification, and approval before any schedule is added |
| Google Calendar | Built behind `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Whether the client ID is configured is owner to confirm. Needs live consent testing |
| Stripe Pro fulfillment | Built behind authenticated Functions | Not live. Needs Blaze, deployed Functions, Stripe test keys, webhook registration, and signed event tests |
| Account export and deletion | Built behind authenticated Functions | Not live. Needs deployed Functions, live reauthentication testing, Stripe cancellation verification, and cleanup-job monitoring |
| Billing backfill and cleanup | Built as scheduled Functions with durable indexes and retries | Not live. Needs deployed Functions, ready indexes, Stripe credentials, and monitoring |
| Live calendar feed | Built as a Function | Not live. Needs deployed Functions and a real calendar client |
| Analytics | Built with explicit opt-in consent | Whether a GA4 measurement ID is configured is owner to confirm |
| App Check | Client activation built (reCAPTCHA v3 provider) | Registration and enforcement status are owner to confirm |
| Hosting and Firestore rules | Automated on every push to `main` | Live |
| Firestore indexes | Deployed by every `main` deployment, independent of the Functions gate | Failing until the deployment service account has `roles/datastore.indexAdmin` |
| Firebase Functions | Built and deployment-gated by `ENABLE_BLAZE_FUNCTIONS` | Not deployed. The CI Functions step also cannot yet supply the `STRIPE_PRICE_ID` and `APP_URL` params (see [DEPLOYMENT.md](./DEPLOYMENT.md#github-actions-secrets)) |

## Quality baseline

- `npm run lint` passes with the Next.js 16 flat ESLint configuration.
- `npm run typecheck` passes with React 19 types.
- The unit suite passes.
- The Functions and Firestore security-rule suites pass.
- The static production build passes.
- The Playwright desktop and mobile smoke suite passes without credentials.
- Production dependency audits for both packages report no advisories.
- CI blocks deployment when any required gate fails.

## Required follow-up outside the repository

1. Complete the owner-only decisions and provider configuration in [OWNER_ACTIONS.md](./OWNER_ACTIONS.md).
2. Use controlled test accounts and, where practical, a preview deployment before enabling credential-backed features.
3. Verify Google sign-in and preference persistence with a real account.
4. Verify exactly one push notification on a real phone, then verify disable and sign-out cleanup.
5. Exercise Stripe checkout, signed webhook lifecycle behavior, billing backfill, and durable cleanup in test mode when keys are available.
6. Verify account export redaction and the complete asynchronous deletion lifecycle with an active Stripe test subscription.
7. Exercise Google Calendar OAuth, event creation, access revocation, and calendar-feed rotation with real services.
8. Run the full [GO_LIVE.md](./GO_LIVE.md) checklist before promoting the release.

## Current production blocker

Hosting and final Firestore rules are deployed from commit `82294e8` (pull request #17), published by deployment run 39943429394 on 2026-10-23.
That run is red because the Firestore index step returned HTTP 403 ("The caller does not have permission").
The deployment service account cannot create Firestore indexes without `roles/datastore.indexAdmin`, so every deployment run ends red even though Hosting and rules publish.
The same missing index blocks the notification dry run.
The project owner must grant the role (decision D3 in [OWNER_ACTIONS.md](./OWNER_ACTIONS.md)); the repository agent can then rerun the deployment, wait for every index to report `READY`, and rerun the notification dry run.

## Known test boundary

Credential-free CI cannot prove OAuth consent, Firebase token delivery, APNs or Android notification presentation, Stripe signatures, cross-device Firestore behavior, or third-party calendar refresh timing.
Those checks remain explicit release requirements rather than silent assumptions.

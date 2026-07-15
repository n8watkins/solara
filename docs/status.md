# Solara Project Status

_Last reviewed: 2026-07-15_

## Current source baseline

Solara is a Next.js 16 and React 19 static application deployed through Firebase Hosting.
Google sign-in is required before users can reach the personalized dashboard.
Firestore stores account preferences, and trusted backend paths are responsible for billing entitlements and notification delivery state.
The backend maintains durable Stripe ownership indexes, retries failed checkout cleanup, and completes account deletion through tombstone-owned scheduled cleanup.

The repository includes unit coverage for the core planning modules and credential-free Playwright coverage for the welcome and onboarding flow on desktop and mobile Chromium.
CI runs frontend and backend dependency audits, lint, typecheck, app and Functions tests, Firestore emulator rules tests, production build, and browser smoke tests before a production deploy can begin.

## Feature activation state

| Area                                    | Source state                                                  | External activation or verification                                                                              |
| --------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Forecast and activity planning          | Built                                                         | Verify live Open-Meteo behavior and recommendation consistency                                                   |
| Google sign-in and Firestore sync       | Built                                                         | Requires Firebase configuration and authorized domains                                                           |
| Push notifications                      | Built with manual dry-run dispatcher                          | Requires VAPID, service account, eligible test account, real-device verification, and approval before scheduling |
| Google Calendar                         | Built behind configuration                                    | Requires OAuth client provisioning and live consent testing                                                      |
| Stripe Pro fulfillment                  | Built behind authenticated Functions                          | Requires Blaze, Stripe test keys, webhook registration, and signed event tests                                   |
| Account export and deletion             | Built behind authenticated Functions                          | Requires Blaze, live reauthentication testing, Stripe cancellation verification, and cleanup-job monitoring      |
| Billing backfill and cleanup            | Built as scheduled Functions with durable indexes and retries | Requires Blaze, ready Firestore indexes, Stripe credentials, and production monitoring                           |
| Live calendar feed                      | Function-backed                                               | Requires Blaze, Functions deployment, and a real calendar client                                                 |
| Analytics                               | Built with explicit opt-in consent                            | Requires a GA4 measurement ID and production consent verification                                                |
| App Check                               | Client activation built                                       | Requires reCAPTCHA registration, monitoring, and gradual enforcement in Firebase                                 |
| Hosting, Firestore rules, and Functions | Automated on `main`                                           | Functions deploy only when `ENABLE_BLAZE_FUNCTIONS` is `true`                                                    |

## Quality baseline

- `npm run lint` passes with the Next.js 16 flat ESLint configuration.
- `npm run typecheck` passes with React 19 types.
- The unit suite passes.
- The Functions and Firestore security-rule suites pass.
- The static production build passes.
- The Playwright desktop and mobile smoke suite passes without credentials.
- CI blocks deployment when any required gate fails.

## Required follow-up outside the repository

1. Configure or verify the Firebase, App Check, VAPID, OAuth, Stripe, Functions, and analytics values described in `DEPLOYMENT.md`.
2. Deploy a controlled staging or preview build before production.
3. Verify Google sign-in and preference persistence with a real account.
4. Verify exactly one push notification on a real phone, then verify disable and sign-out cleanup.
5. Exercise Stripe checkout, signed webhook lifecycle behavior, billing backfill, and durable cleanup in test mode when keys are available.
6. Verify account export redaction and the complete asynchronous deletion lifecycle with an active Stripe test subscription.
7. Exercise Google Calendar OAuth, event creation, access revocation, and calendar-feed rotation with real services.
8. Run the full `GO_LIVE.md` checklist before promoting the release.

## Known test boundary

Credential-free CI cannot prove OAuth consent, Firebase token delivery, APNs or Android notification presentation, Stripe signatures, cross-device Firestore behavior, or third-party calendar refresh timing.
Those checks remain explicit release requirements rather than silent assumptions.

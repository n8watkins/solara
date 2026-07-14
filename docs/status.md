# Solara Project Status

_Last reviewed: 2026-07-14_

## Current source baseline

Solara is a Next.js 16 and React 19 static application deployed through Firebase Hosting.
Google sign-in is required before users can reach the personalized dashboard.
Firestore stores account preferences, and trusted backend paths are responsible for billing entitlements and notification delivery state.

The repository includes unit coverage for the core planning modules and credential-free Playwright coverage for the welcome and onboarding flow on desktop and mobile Chromium.
CI runs dependency audit, lint, typecheck, unit tests, production build, and browser smoke tests before a production deploy can begin.

## Feature activation state

| Area | Source state | External activation or verification |
|---|---|---|
| Forecast and activity planning | Built | Verify live Open-Meteo behavior and recommendation consistency |
| Google sign-in and Firestore sync | Built | Requires Firebase configuration and authorized domains |
| Push notifications | Built with scheduled dispatcher | Requires VAPID, service account, eligible test account, and real-device verification |
| Google Calendar | Built behind configuration | Requires OAuth client provisioning and live consent testing |
| Stripe Pro fulfillment | Backend integration required at deploy time | Requires Blaze, Stripe test keys, webhook registration, and signed event tests |
| Live calendar feed | Function-backed | Requires Blaze, Functions deployment, and a real calendar client |
| Hosting and Firestore rules | Automated on `main` | Requires GitHub Actions secrets and a valid Firebase service account |

## Quality baseline

- `npm run lint` passes with the Next.js 16 flat ESLint configuration.
- `npm run typecheck` passes with React 19 types.
- The unit suite passes.
- The static production build passes.
- The Playwright desktop and mobile smoke suite passes without credentials.
- CI blocks deployment when any required gate fails.

## Required follow-up outside the repository

1. Configure or verify the Firebase, VAPID, OAuth, Stripe, and Functions secrets described in `DEPLOYMENT.md`.
2. Deploy a controlled staging or preview build before production.
3. Verify Google sign-in and preference persistence with a real account.
4. Verify exactly one push notification on a real phone, then verify disable and sign-out cleanup.
5. Exercise Stripe checkout and webhook lifecycle behavior in test mode when keys are available.
6. Exercise Google Calendar OAuth, event creation, access revocation, and calendar-feed rotation with real services.
7. Run the full `GO_LIVE.md` checklist before promoting the release.

## Known test boundary

Credential-free CI cannot prove OAuth consent, Firebase token delivery, APNs or Android notification presentation, Stripe signatures, cross-device Firestore behavior, or third-party calendar refresh timing.
Those checks remain explicit release requirements rather than silent assumptions.

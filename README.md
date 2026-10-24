# Solara

Solara is a personalized UV and outdoor-activity planner, live at https://solara-uv.web.app.
It combines Open-Meteo forecasts with a user's location, skin profile, sunscreen settings and activities to suggest lower-UV windows for each activity, on a dashboard and in a week calendar.
Anyone can try it without an account: a guest plan (today's forecast, one activity) stays in the browser.
Signing in with Google is free and syncs the plan through Firestore; Pro adds 10 days, 20 activities, calendar sync, family profiles and morning alerts, and is a waitlist until billing launches.
The plans are defined once, in `lib/tiers.ts`.
Billing (Stripe), the live calendar feed, account export and deletion, and push notifications are built as Firebase Functions but not deployed yet.

Solara is a planning aid, not medical advice or a guarantee that sun exposure is safe.
Conditions and individual sensitivity can change quickly.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/status.md](docs/status.md) | What is live today, what is not, the CI/CD shape, and which owner actions are done or open |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Open work in waves of parallel lanes, the owner decisions they need, and feature candidates |
| [docs/OWNER_CHECKLIST.md](docs/OWNER_CHECKLIST.md) | Steps only the owner can do, and the manual checks for a release |
| [docs/COSTS.md](docs/COSTS.md) | Running-cost estimates by user count, free-tier limits and forecast provider options |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, GitHub configuration, how a deploy runs, and Functions, App Check, feed, notification and Calendar setup |
| [docs/WIF_SETUP.md](docs/WIF_SETUP.md) | Replacing the deploy key with Workload Identity Federation, and moving public values to variables |
| [docs/DEPENDENCY_RISK.md](docs/DEPENDENCY_RISK.md) | Accepted development-dependency advisories and the audit policy |
| [docs/CONTRIBUTING-AGENTS.md](docs/CONTRIBUTING-AGENTS.md) | How roadmap lanes run in parallel: ownership, agent contract, merge protocol |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability and how the supply chain is protected |
| [docs/archive/](docs/archive/assessment-2026-10/REPORT.md) | The October 2026 assessment, with the status of every finding |

## Stack

- Next.js 16 App Router with static export, React 19 with the React Compiler, TypeScript 5.
- TanStack Query for forecast data, Zod (`zod/mini`) for every external boundary.
- Firebase Authentication, Firestore, Hosting, Cloud Messaging and Functions (TypeScript on Node.js 24).
- Tailwind CSS 4, configured in `app/globals.css` (`@theme`) on CSS custom-property design tokens, which also define the one UV palette.
- Vitest, Playwright (static export on the Hosting emulator, and a signed-in suite on the Firebase emulators), and an axe-scanned UI harness.
- GitHub Actions for quality checks and deployment.

## Local setup

Use Node.js 24.16.0 (`.nvmrc`) to match CI.

```bash
git clone https://github.com/n8watkins/solara.git
cd solara
npm ci
npm ci --prefix functions
cp .env.local.example .env.local
npm run dev
```

The landing page is at `/` and the app at `/app/`.
Without Firebase configuration in `.env.local`, the landing page, setup and the guest dashboard still work, but the Google sign-in controls are hidden.
To set up a Firebase project of your own, follow [Firebase console setup](docs/DEPLOYMENT.md#firebase-console-setup).

## Code layout

The repository is an npm workspace.

- The web app (Next.js static export) lives at the root: `app/`, `components/` and `lib/`.
  `app/page.tsx` is the static landing page: `scripts/static-pages.mjs` strips the framework scripts from it after the build, so it loads no JavaScript of its own beyond two inline scripts and nothing from Firebase.
  The app is `app/app/page.tsx` (`/app/`); a browser with a signed-in account that opens `/` is sent there.
- `packages/core` (`@solara/core`) holds the logic every surface shares: the recommendation engine, the preferences schema and migrations, the Zod-validated Open-Meteo parser and weather labels, the iCalendar builder, the calendar feed token policy and the Functions response contracts.
  The web app imports its TypeScript source.
- `functions/` holds the Cloud Functions in TypeScript (`functions/src/`, one folder per area) and the manual morning notifier (`functions/scripts/send-notifications.js`).
  It is a separate npm package, because `firebase deploy` uploads only that directory.
  `npm run build --prefix functions` compiles `@solara/core` into `functions/core/` and the Functions into `functions/lib/` (both gitignored); the Functions test scripts and the predeploy hook run it.

## Quality checks

CI runs all of these on every pull request (`.github/workflows/quality.yml`).
The unit tests also exercise the Functions code, so install both packages first.

```bash
npm ci
npm ci --prefix functions
npm audit --omit=dev --audit-level=high
npm audit --prefix functions --omit=dev --audit-level=high
npm run lint
npm run check:docs
npm run typecheck
npm test
npm run build
npm test --prefix functions
npm run test:rules --prefix functions
npx playwright install chromium
npm run test:e2e
npm run test:e2e:integrations
npm run test:e2e:signed-in
npm run test:harness
```

- `npm run test:e2e` builds the static export with a hermetic public configuration and tests it on the Firebase Hosting emulator without credentials: the landing page, onboarding, guest mode and its upsells, analytics consent, legal pages, share links and Hosting headers.
- `npm run test:e2e:integrations` builds the production export with a fake Sentry DSN and reCAPTCHA site key, answers every third-party request with a fake, and checks that error reports arrive scrubbed and that App Check starts only after sign-in, within the CSP.
  It writes `out/` like `npm run test:e2e`, so run the two one after the other.
- `npm run test:e2e:signed-in` signs in through the Auth emulator and covers the dashboard, activities, settings, calendar, sharing, Pro gating, guest-to-account carry-over, account isolation and export against the real rules and Functions.
- `npm run test:harness` captures screenshots at desktop and phone widths in both themes, with an axe report, into `test-results/ui-harness/`: the signed-in screens and header popovers, the guest dashboard with each upsell and the plans dialog, and the pages a visitor sees before signing in (landing, sign-in, each onboarding step, legal pages, share links, the account page and the 404 page).
  `UPDATE_LANDING_SHOTS=1 npm run test:harness -- landing-shots` regenerates the landing page's screenshots in `public/landing/`.
- `npm run check:docs` checks that every relative link and backticked repository path in the Markdown docs resolves.

The rules tests and the signed-in suite need Java for the Firestore emulator.
Real Google OAuth, App Check, FCM delivery, Stripe signatures and calendar clients are outside what CI can prove; they are covered by the [owner checklist](docs/OWNER_CHECKLIST.md#release-verification).

## Firestore layout

The primary account document is `users/{uid}`, with notification registrations in `users/{uid}/notificationDevices/{deviceId}`, Stripe resource history in `users/{uid}/billingResources/{resourceId}`, and the owner's calendar feed link in `users/{uid}/private/calendarFeed`.
Trusted backend code owns the calendar feed token index, the notification-token ownership index, the Stripe subscription ownership index, account-deletion tombstones, billing cleanup resources, checkout cleanup tasks, entitlements and delivery state.
Firestore rules deny client access to those server-owned collections and prevent clients from writing notification-device or billing state.

## License

The source code is all rights reserved (owner decision D8): no license to use, copy, modify or distribute it is granted.

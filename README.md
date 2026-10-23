# Solara

Solara is a personalized UV and outdoor-activity planner.
It combines Open-Meteo forecasts with a user's location, skin profile, sunscreen settings, and activities to estimate lower-UV planning windows.

Solara is a planning aid, not medical advice or a guarantee that sun exposure is safe.
Conditions and individual sensitivity can change quickly.

## Product capabilities

- Live UV and weather forecasts from Open-Meteo.
- Personalized activity windows for today and upcoming days.
- Location search with optional region or country qualifiers for ambiguous city names.
- Required Google sign-in with Firestore preference sync.
- Multiple activities, locations, and profiles with Free and Pro limits.
- Shareable activity-window links with clear recovery guidance when a link is incomplete.
- Google Calendar scheduling and calendar-feed support when configured.
- Web push notifications for eligible accounts when Firebase Cloud Messaging is configured.
- Stripe-backed Pro fulfillment through Firebase Functions when Stripe is configured.
- Installable progressive web app assets for supported browsers.

Production currently serves only the static app, Firestore and Google sign-in.
Firebase Functions are not deployed, so the calendar feed, push notifications, Stripe checkout, and account export and deletion are built but not live.
See [docs/status.md](docs/status.md) for the verified production state.

## Stack

- Next.js 16 App Router with static export.
- React 19 and TypeScript 5.
- Firebase Authentication, Firestore, Cloud Messaging, Hosting, and Functions (Node.js 24 runtime).
- Tailwind CSS 3.
- Vitest for unit tests and Playwright for browser smoke tests.
- GitHub Actions for quality checks, deployment, and notification dispatch.

## Local setup

Use Node.js 24 to match CI.

```bash
git clone https://github.com/n8watkins/solara.git
cd solara
npm ci
cp .env.local.example .env.local
npm run dev
```

The app requires Google sign-in before a user can reach the dashboard.
Without Firebase configuration, local development still supports the welcome and onboarding flow, but the final Google sign-in control is intentionally unavailable.

## Firebase setup

1. Create a Firebase project.
2. Register a Web app and copy its client configuration into `.env.local`.
3. Enable Google as an Authentication provider and add each deployed domain to Authorized domains.
4. Create Firestore in production mode and deploy `firestore.rules`.
5. Enable Cloud Messaging and create a Web Push VAPID key if notifications are required.
6. Enable Hosting.
7. Upgrade to Blaze before deploying Firebase Functions.

The complete environment and activation checklist is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Code layout

The repository is an npm workspace.

- The web app (Next.js static export) lives at the root: `app/`, `components/` and `lib/`.
- `packages/core` (`@solara/core`) holds the business logic every surface shares: the recommendation engine, the Zod-validated Open-Meteo parser and weather labels, the iCalendar builder and the calendar feed token policy.
  The web app imports its TypeScript source.
- `functions/` holds the Cloud Functions and the morning notifier (`functions/scripts/send-notifications.js`).
  It is a separate npm package, because `firebase deploy` uploads only that directory.
  `npm run build:core` compiles `@solara/core` to CommonJS in `functions/core/` (gitignored), which Functions load through the `#core` import in `functions/package.json`.
  The Functions test scripts and the Functions predeploy hook run it automatically.

## Quality checks

The unit tests also exercise the Functions code, so install both packages first.

```bash
npm ci
npm ci --prefix functions
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
npm audit --prefix functions --omit=dev --audit-level=high
npm test --prefix functions
npm run test:rules --prefix functions
npx playwright install chromium
npm run test:e2e
```

The Playwright smoke suite deliberately runs without Firebase credentials.
It verifies the welcome screen, the analytics consent choice, and the onboarding flow through the Google sign-in boundary on desktop and mobile Chromium.
OAuth, Stripe, Cloud Messaging, and cross-device persistence still require controlled staging or production tests.

## Deployment

Pull requests and non-main branches run the quality workflow.
Every push to `main` runs the same gates before Firebase Hosting and Firestore rules deploy.
The repository has no branch protection, so reviews are a convention rather than an enforced rule.
The deployment workflow attempts to deploy Firestore indexes on every release and reports missing index IAM separately from Hosting; it currently fails at that step until the owner grants `roles/datastore.indexAdmin`.
Firebase Functions deploy only when the `ENABLE_BLAZE_FUNCTIONS` repository variable is `true`, and it is not set.
Public `NEXT_PUBLIC_*` values are compiled into the static bundle, so changing one requires a new build and deploy.

See [docs/GO_LIVE.md](docs/GO_LIVE.md) for the release checklist, [docs/status.md](docs/status.md) for current activation state, and [docs/OWNER_ACTIONS.md](docs/OWNER_ACTIONS.md) for the remaining owner-only decisions and provider setup.

## Firestore layout

The primary account document is `users/{uid}`, with notification registrations in `users/{uid}/notificationDevices/{deviceId}` and Stripe resource history in `users/{uid}/billingResources/{resourceId}`.
Trusted backend code owns the global notification-token ownership index, Stripe subscription ownership index, account-deletion tombstones, billing cleanup resources, checkout cleanup tasks, entitlements, and delivery state.
Firestore rules deny client access to those server-owned collections and prevent clients from writing notification-device or billing state.

## License

No license file is currently included.
Confirm the intended license and copyright holder before public distribution.

# Solara roadmap

_Last reviewed: 2026-10-25_

This is the plan for the remaining work, in priority order.
What is live today is in [status.md](status.md); the owner's steps are in the [owner checklist](OWNER_CHECKLIST.md); how lanes are run by parallel agents is in [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md).
Finding IDs such as `BE-9` or `PROD-6` refer to the [archived October 2026 assessment](archive/assessment-2026-10/REPORT.md#finding-status).

## Owner steps first

The owner's steps unblock most of the engineering items below, so they come first.
The full, numbered list with exact console links is [Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order); in short:

1. Turn on Google Calendar: enable the Calendar API and set the OAuth web client ID.
2. Resubmit the OAuth branding review.
3. Publish the sign-in app.
4. Request verification for the two calendar scopes.
5. Turn on App Check with a reCAPTCHA v3 key, watch for a week, then enforce Firestore.
6. Create the Sentry project and set the DSN.
7. Keyless deploys (Workload Identity Federation), then delete the old service-account key.
8. Move the public build values to repository variables.
9. Delete the unused `NEXT_PUBLIC_PRO_PRICE` secret.
10. Counsel review of the governing-law language.
11. Local branch and worktree cleanup.

Steps 12-15 (Blaze, staging and Stripe test mode, the Open-Meteo commercial plan, release checks) come at the Pro launch.

## Where we are (2026-10-25)

| Wave | State | PRs |
| --- | --- | --- |
| 0 - unblock and safety net | Done 2026-10-23 | #17-#21 |
| 1 - correctness, security, CI/CD | Done 2026-10-23 | #22-#30 |
| 2 - shared core, data layer, signed-in e2e | Done 2026-10-23 | #44, #47, #49-#52 |
| 4 - Tailwind 4, restyle and split, upgrades | Done 2026-10-24 (ESLint 10 and TypeScript 7 deferred, see Next up) | #57-#67 |
| 3 phase 1 - free launch (no Blaze) | Done 2026-10-24; Sentry and App Check wait for the owner's keys | #70, #71 |
| 3 phase 2 - Pro launch (Blaze) | Not started; waits for the Pro launch | - |
| 5 - features | Scheduled activities done (#55, #56); the rest not started | - |
| 6 - mobile app | Not started | - |

Also done: the move to `solara-uv.web.app` (#42, #45), Search Console verification (#43), the legal operator details (#46), the privacy policy's Google user data section (#48), the docs consolidation (#53), the costs page and Wave 3 decisions (#68), the new-user sign-in race and test flake fixes (#69), every CodeQL alert (#72, #73), the "fast checks locally, full suites on CI" agent contract (#74), the plan docs refresh (#75), and the fixes from the first post-launch code review (client findings in #79, server and rules findings in #81).
The Wave 4 lane details were removed now that the lanes are merged; what each lane changed is in PRs #57-#67.
The repository is public, with the "Protect main" ruleset (pull requests, squash merges only, 8 required checks), Dependabot alerts and security updates, secret scanning with push protection, and CodeQL.

## Next up

Each item lists its goal, scope, the files or areas it owns, acceptance criteria, what it depends on and a rough size (S: under a day of agent time, M: one to three days, L: more).
Items 1-8 need no Blaze and can start now; items 9-11 wait for the Pro launch.

### 1. Change-aware CI (done, #76)

Done 2026-10-25 in #76: each required check reports on every pull request and runs its suite only when the changed files can affect it; the README's [change-aware checks](../README.md#change-aware-checks) table lists which paths run which suite.

### 2. Sun arc peak label clipped on phones (done, #78)

Done 2026-10-25 in #78: the peak callout stays inside the arc's box at every width, for early and late peaks.

### 3. Faster app load on phones (done, #83, #93)

Done 2026-10-25 in #83 and #93: Lighthouse mobile LCP for `/app/` is about 2.1 s for a guest and the same for a returning account, whose dashboard now shows from this browser's copy while Firebase loads; a guest's first load is about 196 KB gzip of JavaScript, held under 200 KB by `tests/e2e/guest.spec.ts`.

### 4. App-shell service worker with an offline forecast (PERF-2, PROD-6 part) (done, #94)

Done 2026-10-25 in #94: an installed Solara opens offline from the app-shell service worker (`scripts/sw/shell.ts`, built after each build by `scripts/build-sw.mjs`) and shows the last forecast for the place with an offline notice and an "updated at" stamp.
A signed-in account opens read-only from this browser's copy until the browser is back online, and a deploy replaces the worker and its caches at once.

### 5. Place autocomplete in onboarding (PROD-6, done, #80)

Done 2026-10-25 in #80: setup and the header's location panel suggest places while typing, from Open-Meteo's place search (Nominatim's usage policy forbids client-side autocomplete; it stays for "use my location" names).
Settings' Location tab uses the same search since the polish follow-up, and the data credits name GeoNames, the source of Open-Meteo's places.

### 6. Forecast proxy and licensing (BE-12, with D5)

- **Goal:** forecasts are fetched under a commercial licence before any paid feature launches.
- **Scope:** decide between the Open-Meteo commercial plan (D5, bought at Pro launch) and a free commercial provider ([COSTS.md](COSTS.md#forecast-providers)); if the paid plan's API key must stay secret, add a cached forecast proxy Function, which needs Blaze.
- **Owns:** `lib/forecast.ts` provider adapter, a new forecast proxy Function under `functions/src/` if needed.
- **Acceptance:** one provider adapter behind the existing validated parser; the proxy, if built, caches per rounded location and hour and has a timeout and a last-good fallback.
- **Depends on:** D5 and, for a proxy, Blaze; lands with item 9 at the latest.
- **Size:** M.

### 7. ESLint 10 (deferred)

- **Goal:** move to ESLint 10 (Dependabot #35).
- **Blocked by:** `eslint-config-next` does not support ESLint 10 yet; reasons on #35.
- **Scope:** `package.json`, the lockfile and `eslint.config.mjs` only.
- **Acceptance:** `npm run lint` passes with the same rules and no new disables.
- **Size:** S once unblocked.

### 8. TypeScript 7 (deferred)

- **Goal:** move to TypeScript 7 (Dependabot #40, #31).
- **Blocked by:** `typescript-eslint` and Next.js do not support TypeScript 7 yet; reasons on #40 and #31.
- **Scope:** `package.json`, the lockfiles and any type fixes.
- **Acceptance:** typecheck, lint, tests and build pass in both packages.
- **Size:** S-M once unblocked.

### 9. Wave 3 phase 2: billing and account lifecycle (W3-A, at Pro launch)

- **Goal:** Pro can be bought, managed, cancelled and deleted safely.
- **Closes:** BE-9, BE-10, BE-14.
- **Owns:** `functions/src/billing/`, `functions/src/account/`, `components/PricingModal.tsx`, `lib/billing.ts`, `lib/plans.ts`, `app/account/`.
- **Scope:** checkout with the confirmed prices ($2.99 a month or $19.99 a year, 7-day free trial) replacing the waitlist; delete the Stripe customer after its subscriptions end; TTLs on server-owned records; a billing summary in the account export; deletion never stalls (a missing Stripe resource counts as done, a retry cap and an alert); refunds for server-initiated cancellations; a `past_due` grace period.
  The Stripe API version is already pinned (#58).
- **Acceptance:** an end-to-end run in Stripe test mode on the staging project covers checkout with trial, webhooks, portal, cancellation and account deletion with an active subscription; then the owner's [Functions and Stripe](OWNER_CHECKLIST.md#functions-and-stripe) checks.
- **Depends on:** Blaze, the staging project and Stripe test mode (D9), item 6.
- **Size:** L.

### 10. Wave 3 phase 2: Pro-only morning alerts (W3-B, at Pro launch)

- **Goal:** Pro subscribers get one morning alert per local morning, and nobody else does.
- **Closes:** OPS-4, BE-19, BE-11 (Functions runtime identity).
- **Owns:** `functions/src/notifications/`, `functions/scripts/send-notifications.js` and `functions/scripts/notification-core.js` (removal), `.github/workflows/notify.yml` (removal, coordinated with the CI owner), `components/settings/NotificationSettings.tsx`, `lib/use-notification-toggle.ts`, `components/InstallPrompt.tsx`.
- **Scope:** one scheduled Function every 15 minutes serving every time zone (D6) on a least-privilege service account, reusing the at-most-once claim logic; gated on `TIER_LIMITS.paid.notifications`; restore the notification copy; iOS Home Screen install guidance; a base for threshold alerts.
- **Acceptance:** an emulator test sends exactly one notification per eligible Pro user per local morning across time zones and none to Free users; then the real-device checks in the [owner checklist](OWNER_CHECKLIST.md#notifications).
- **Depends on:** Blaze, item 9 (Pro must be purchasable).
- **Size:** M-L.

### 11. Wave 3 phase 2: operations (rest of W3-D, at Pro launch)

- **Goal:** problems are noticed and recoverable once money is involved.
- **Closes:** OPS-12, OPS-15 (alerts and uptime; error reporting is built), OPS-16, OPS-17.
- **Owns:** `.firebaserc`, `infra/` (new), `docs/RUNBOOK.md` (new), deploy workflow changes coordinated with the CI owner.
- **Scope:** uptime checks; alerts on Function errors, scheduled-job failures, webhook 5xx and stalled deletions; PITR, delete protection, daily backups and a restore drill; budget alerts; PR preview channels and staging promotion (D9); a runbook with rollback per component and a secret rotation table.
- **Acceptance:** each alert fires once in staging from a forced failure; a restore drill is recorded in the runbook.
- **Depends on:** Blaze, D9.
- **Size:** M.

### 12. Wave 5: features

Each feature is its own lane that owns new files plus touch points agreed at kickoff.
Candidates, roughly ranked by impact over effort:

1. **Scheduled activities** - done (#55, #56); hidden in production until the Google OAuth client ID is set.
2. Threshold UV alerts and a sunscreen reapply timer (builds on item 10).
3. A daily briefing card, optionally AI-written, reused by push and share.
4. Family profiles as a headline Pro feature with a "most sensitive person" mode.
5. Cloud-aware forecasts with confidence that decays after day 3.
6. Better skin typing: named Fitzpatrick types and a short quiz (the swatches are done, in setup and Settings).
7. City landing pages for search traffic (builds on the static landing page).
8. Shade and surface reflection factors.
9. Linking with live events from Strava, Meetup and similar services, so Solara can plan around them (owner's idea, not yet scoped).

### 13. Wave 6: mobile app (owner's learning project)

- **Approach:** Expo (React Native), chosen over a Capacitor wrapper so the app is truly native and the work teaches real mobile development.
- **Reuse:** all of `packages/core` (recommendation engine, forecast parsing, schemas); the UI is rebuilt natively.
- **Steps:** an Expo app in the repo using `packages/core`; Firebase sign-in on device with the same Firestore; native push for Pro alerts; TestFlight and a Google Play internal test track; a home-screen UV widget.
- **Crash reporting:** Sentry's React Native SDK in the same Sentry account as the web app; Firebase Crashlytics can be added later for deep native crash data.
- **Depends on:** an Apple Developer account ($99 per year) and a Google Play developer account ($25 once); native push needs item 10.
- **Size:** L.

## Decisions

Agents never make owner decisions; they follow the recorded decision or the default.
The steps behind each one are in the [owner checklist](OWNER_CHECKLIST.md).

| # | Decision | State |
| --- | --- | --- |
| D1 | Functions deployment status | Decided 2026-10-23: not deployed until Pro launch |
| D2 | Make the repository public | Done 2026-10-23: public, "Protect main" ruleset with 8 required checks, squash merges only, Dependabot, secret scanning with push protection, CodeQL |
| D3 | Firestore index role for the deploy identity | Done 2026-10-23 |
| D4 | Workload Identity Federation, then delete the service-account key | Open; the key stays as the fallback until done |
| D5 | Forecast licensing | Decided 2026-10-23: Open-Meteo free tier until Pro launches, then the commercial plan (about $29 a month) from the first revenue |
| D6 | Morning alerts | Decided 2026-10-23: Pro-only, relaunch with Pro on one scheduled Function for every time zone |
| D7 | Guest mode | Decided 2026-10-23, shipped in #71 |
| D8 | Operator, contact, jurisdiction, license | Done 2026-10-23 (#46) |
| D9 | Staging project and Stripe test mode | Decided 2026-10-23: set up at Pro launch, before billing work |
| D10 | Error reporting | Decided 2026-10-23: Sentry; code shipped in #70, waits for the owner's DSN |
| D11 | Bot protection | Decided 2026-10-23: App Check with reCAPTCHA v3; works without code changes, waits for the owner's site key |
| D12 | Local branch and worktree cleanup on the owner's machine | Open, any time |
| Blaze | Billing plan | Decided 2026-10-23: stay on Spark until Pro launches, then Blaze with a $5 budget alert ([COSTS.md](COSTS.md)) |
| Price | Pro price | Decided 2026-10-24: $2.99 a month or $19.99 a year, 7-day free trial, waitlist until billing launches |
| Tiers | Plans | Decided 2026-10-24: as shipped in #71, below |
| Testing | Where tests run | Decided 2026-10-24: fast checks locally, full suites on GitHub Actions (#74) |

### Tiers

| | Guest (no sign-in) | Free account | Pro |
| --- | --- | --- | --- |
| Forecast | Today | Today and tomorrow | 10 days |
| Activities | 1 | 3 | 20 |
| Storage | This device only | Synced | Synced |
| Calendar sync (Google Calendar adding, Scheduled, live feed, .ics export) | - | Yes | Yes |
| Family profiles, morning alerts | - | - | Yes |

Google Calendar adding and Scheduled stay available on Free accounts by owner decision (2026-10-24); `lib/tiers.ts` keeps `calendar` on for Free, and that one flag also covers the live feed and the .ics export.
Morning alerts are Pro-only and launch with Pro.
Upsell moments: "Save your plan, sign in free" when a guest adds a second activity or returns on a later day; "See the next 10 days with Pro" on the forecast tabs; "Get this as a morning alert" on the recommendation card.
No pop-ups on first arrival.

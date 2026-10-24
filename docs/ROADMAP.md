# Solara roadmap

_Last reviewed: 2026-10-23_

This is the open work, grouped into waves of lanes that can run in parallel.
Waves 0, 1 and 2 of the October 2026 level-up plan are merged (PRs #17-#52); what they changed is recorded in the [archived assessment](archive/assessment-2026-10/REPORT.md#finding-status).
Finding IDs such as `BE-9` or `PROD-1` refer to that report.
For what is live today read [status.md](status.md); for how lanes are run read [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md).

## Order

1. **Wave 4 - styling system and upgrades:** finishing (Tailwind 4, the upgrades, and the calendar, settings and activity restyles are merged).
2. **Wave 3, phase 1 - free launch work (no Blaze):** guest mode with tiers and upsell and the landing page (done), Sentry, and App Check with reCAPTCHA.
3. **Wave 3, phase 2 - Pro launch (Blaze):** billing, Pro-only morning alerts, staging and the rest of operations.
4. **Wave 5 - features:** one lane per feature.
5. **Wave 6 - mobile app:** an Expo (React Native) app for iOS and Android.

A wave starts when the previous wave's lanes are merged and `main` is green.
Wave 3 also needs the owner decisions listed below.

## Decisions made on 2026-10-23

| # | Decision |
| --- | --- |
| D2 | Done: the repository is public, with Dependabot, secret scanning with push protection, CodeQL and a "Protect main" ruleset |
| Blaze | Stay on the free Spark plan until Pro launches; enable Blaze with a $5 budget alert at Pro launch (costs in [COSTS.md](COSTS.md)) |
| D5 | Stay on the Open-Meteo free tier until Pro launches, then buy the commercial plan (about $29 per month) from the first revenue; free commercial alternatives are listed in [COSTS.md](COSTS.md#forecast-providers) |
| D6 | Morning alerts become a Pro-only feature and relaunch with Pro, on one scheduled Function that serves every time zone |
| D7 | Yes to guest mode, with tiers and gentle upsell (below) |
| D9 | Staging project and Stripe test mode are set up at Pro launch, before billing work |
| D10 | Sentry for the website now; the same Sentry account later covers the mobile app |
| D11 | App Check with reCAPTCHA v3 (free up to 10k checks a month), starting now |
| Price | Proposed: Pro at $2.99 per month or $19.99 per year, with a 7-day free trial (owner to confirm) |

### Tiers (proposed, owner to confirm)

| | Guest (no sign-in) | Free account | Pro |
| --- | --- | --- | --- |
| Forecast | Today | Today and tomorrow | 10 days |
| Activities | 1 | 3 | 20 |
| Storage | This device only | Synced | Synced |
| Calendar, morning alerts, family profiles | - | - | Yes |

Upsell moments: "Save your plan, sign in free" when a guest adds a second activity or returns the next day; "See the next 10 days with Pro" on the forecast tabs; "Get this as a morning alert" on the recommendation card.
No pop-ups on first arrival.

## Owner decisions

Agents never make these; they follow the default until the owner decides.
The steps behind each one are in the [owner checklist](OWNER_CHECKLIST.md).
D1, D3 and D8 are done; the current state of every owner action is in [status.md](status.md#owner-actions).

| # | Decision or action | Needed by | Default until decided |
| --- | --- | --- | --- |
| D2 | Make the repository public, or buy GitHub Pro, for branch protection, rulesets, environments, CodeQL and secret scanning | When the repository goes public (planned) | Stay private; gitleaks, zizmor and actionlint run in CI |
| D4 | Run the Workload Identity Federation setup, then delete the service-account JSON key | Before Wave 3 enables Functions | The key secret stays as the fallback |
| D5 | Buy an Open-Meteo commercial plan or choose another forecast provider | W3-C, and before any paid feature launches | Free tier with attribution; the licensing risk stays open |
| D6 | Relaunch morning notifications | W3-B | Relaunch on a scheduled Function |
| D7 | Offer a guest mode before sign-in | W3-C | Yes |
| D9 | Create a staging Firebase project and enable Stripe test mode | W3-A and W3-D | Required before W3-A and W3-D finish |
| D10 | Create the Sentry project and set `NEXT_PUBLIC_SENTRY_DSN` (code ready; [checklist step 8](OWNER_CHECKLIST.md#now-free-no-blaze)) | Any time | Error reporting off, no Sentry code shipped |
| D11 | Create the reCAPTCHA v3 key, register it in App Check, set `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`, then enforce Firestore (code ready; [checklist step 7](OWNER_CHECKLIST.md#now-free-no-blaze)) | Before Function-backed surfaces go live | App Check off |
| D12 | Delete the merged local branches and worktrees under `projects/polish/` on the owner's machine | Any time | Leave untouched |
| - | Upgrade `uv-activity-planner` to Blaze with a budget alert | Before any Functions deploy (W3-A, W3-B) | Spark; Functions stay undeployed |
| - | Publish the Google OAuth consent screen and pass scope verification for `calendar.freebusy` and `calendar.events.owned` | Before Google Calendar is turned on in production | Calendar connect stays hidden (no OAuth client ID in the build) |

## Wave 3 - Launch tracks (4 lanes)

Wave 3 runs in two phases.
**Phase 1 (free, now):** W3-C (guest mode with the tiers above, landing page; done).
The Sentry part of W3-D and App Check with reCAPTCHA v3 are built and wait only for the owner's keys (D10, D11).
**Phase 2 (Pro launch, Blaze):** W3-A (billing), W3-B (Pro-only morning alerts), the rest of W3-D (staging, alerts, backups).

The Functions feature folders under `functions/src/` keep the backend lanes apart.

### W3-A - Billing and account lifecycle

- **Branch:** `feat/billing-launch`
- **Closes:** BE-9, BE-10, BE-13, BE-14, PROD-3 (pricing content)
- **Owns:** `functions/src/billing/`, `functions/src/account/`, `components/PricingModal.tsx`, `lib/billing.ts`, `app/account/`
- **Work:** delete the Stripe customer after its subscriptions end; TTLs on server-owned records; a billing summary in the account export; deletion never stalls (a missing Stripe resource counts as done, a retry cap and an alert); a pinned Stripe `apiVersion`; refunds for server-initiated cancellations; a `past_due` grace period; pricing that leads with alerts, family profiles and travel locations, with annual and trial options.
- **Acceptance:** an end-to-end run in Stripe test mode on the staging project (D9) covers checkout, webhooks, portal, cancellation and account deletion with an active subscription.

### W3-B - Notifications relaunch

- **Branch:** `feat/scheduled-notifications`
- **Closes:** OPS-4, BE-19, BE-11 (Functions runtime identity)
- **Owns:** `functions/src/notifications/`, `functions/scripts/send-notifications.js` and `functions/scripts/notification-core.js` (removal), `.github/workflows/notify.yml` (removal), `components/settings/NotificationSettings.tsx` and `lib/use-notification-toggle.ts`, `components/InstallPrompt.tsx`
- **Touch points:** the notification entries in `lib/billing.ts` and `components/PricingModal.tsx` (owned by W3-A)
- **Work:** an hourly `onSchedule` dispatcher on a least-privilege service account that reuses the at-most-once claim logic; restore the notification copy removed in #24; iOS Home Screen install guidance; a foundation for threshold alerts.
- **Acceptance:** an emulator test sends exactly one notification per eligible user per local morning across time zones; then the real-device checks in the [owner checklist](OWNER_CHECKLIST.md#notifications).

### W3-C - Growth: guest mode, landing, performance, PWA

Phase 1 is done (branch `feat/guest-landing-pricing`): guest mode on the tiers above (`lib/tiers.ts`), with the guest plan kept in the browser and carried into a new account on first sign-in; the three upsells, dismissible per device; the static landing page at `/` (no framework JavaScript, nothing from Firebase, real harness screenshots) and the app at `/app/`, with `/` sending a signed-in browser to the app; Pro pricing ($2.99 a month or $19.99 a year, 7-day trial) as a waitlist; onboarding that hugs its content, with Back on every step and specific geolocation errors.
Calendar sync (Google Calendar, the live feed and the .ics export) moved to Pro with the tiers.

Still open:

- **Branch:** `feat/guest-landing-pwa`
- **Closes:** PROD-6, PERF-2, UX-5, BE-12 (forecast proxy, with D5)
- **Owns:** `scripts/generate-sw.js` (replaced by an app-shell service worker), lazy-loading boundaries in `components/`
- **Work:** load Firebase in the app only on sign-in or an existing session (the landing page already loads none); lazy modals and calendar; an app-shell service worker with an offline forecast, an "updated" stamp and the push handler; place autocomplete in onboarding.
- **Acceptance:** the guest app's first load under 200 KB gzip of JavaScript.

### W3-D - Operations

- **Branch:** `ops/observability-staging`
- **Closes:** OPS-12, OPS-15 (alerts and uptime checks; error reporting is done), OPS-16, OPS-17
- **Owns:** `.github/` except `notify.yml`, `.firebaserc`, `infra/` (new), `docs/RUNBOOK.md` (new), `components/ErrorBoundary.tsx`, `app/global-error.tsx` (new), `instrumentation-client.ts` (new)
- **Work:** uptime checks; alerts on Function errors, scheduled-job failures, webhook 5xx and stalled deletions; PITR, delete protection, daily backups and a restore drill; budget alerts; PR preview channels and staging promotion (D9); a runbook with rollback per component and a secret rotation table.

## Wave 4 - Styling system, upgrades and polish

### W4-A..E - Component restyle and split (5 lanes in parallel)

Each lane converts inline styles to Tailwind, splits large components (target under 250 lines), extracts hooks (`useGoogleCalendar`, `useToast`, `useReverseGeocode`, `useTheme`) and adds component tests, for its own file group only.
Closes CQ-11, CQ-12, UX-10 and the inline-style part of CQ-13.
Use the theme utilities defined in `app/globals.css` (`bg-surface-card`, `text-ink-2`, `border-line-strong`, `bg-accent text-accent-on`, `bg-uv-high`, ...) rather than raw colors; utilities override the hand-written rules and CSS modules, which live in `@layer components`.

| Lane | Files in `components/` and `app/` |
| --- | --- |
| W4-D | `AddActivityModal.tsx`, `EditActivityModal.tsx`, `ManageActivitiesModal.tsx`, `ActivityManager.tsx`, `ActivitySuggestionSettings.tsx`, `EmojiPicker.tsx`, `ActivityModalShell.tsx` |
| W4-E | `Header.tsx`, `App.tsx`, `AppShell.tsx`, `TipCarousel.tsx`, `InstallPrompt.tsx`, `Onboarding.tsx`, `LocationPopover.tsx`, and the pages under `app/` |

### W4-F - Major upgrades (serial within the lane, parallel with W4-A..E)

One PR per upgrade, in this order: Vitest 5 (with `@vitest/coverage-v8`), ESLint 10, Firebase 13 (then drop the `@grpc/grpc-js` override if it is fixed), Stripe 23 with the pinned `apiVersion` from W3-A, `@types/node` 24, dotenv 18, TypeScript 7 once Next.js and typescript-eslint support it.
Each PR replaces the matching open Dependabot PR (#31-#40).
The lane owns only `package.json`, the lockfiles and the code changes each upgrade requires.

## Wave 5 - Features

Each feature is an independent lane that owns new files plus touch points agreed at kickoff.
Candidates, roughly ranked by impact over effort:

1. **Scheduled activities** - done (#55, #56); hidden in production until the Google OAuth client ID is set and the calendar scopes are verified.
2. Threshold UV alerts and a sunscreen reapply timer (builds on W3-B).
3. A daily briefing card, optionally AI-written, reused by push and share.
4. Family profiles as a headline Pro feature with a "most sensitive person" mode.
5. Cloud-aware forecasts with confidence that decays after day 3.
6. Better skin typing: named Fitzpatrick types, swatches and a short quiz.
7. City landing pages for search traffic (builds on W3-C).
8. Shade and surface reflection factors.
9. Linking with live events from Strava, Meetup and similar services, so Solara can plan around them (idea from the owner, not yet scoped).
10. Native mobile apps: see Wave 6.

## Wave 6 - Mobile app (owner's learning project)

- **Approach:** Expo (React Native), chosen over a Capacitor wrapper so the app is truly native and the work teaches real mobile development.
- **Reuse:** all of `packages/core` (recommendation engine, forecast parsing, schemas); the UI is rebuilt natively.
- **Steps:** an Expo app in the repo using `packages/core`; Firebase sign-in on device with the same Firestore; native push for Pro alerts; TestFlight and a Google Play internal test track; a home-screen UV widget.
- **Crash reporting:** Sentry's React Native SDK, so web and mobile errors share one dashboard; Firebase Crashlytics can be added alongside later for deep native crash data.
- **Owner needs:** an Apple Developer account ($99 per year) and a Google Play developer account ($25 once).

## Wave summary

| Wave | Lanes | Gate to start the next wave |
| --- | --- | --- |
| 3 | W3-A, W3-B, W3-C, W3-D | All merged; D9 done |
| 4 | W4-A to W4-F | All merged |
| 5 | One lane per feature | - |

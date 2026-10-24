# Solara roadmap

_Last reviewed: 2026-10-23_

This is the open work, grouped into waves of lanes that can run in parallel.
Waves 0, 1 and 2 of the October 2026 level-up plan are merged (PRs #17-#52); what they changed is recorded in the [archived assessment](archive/assessment-2026-10/REPORT.md#finding-status).
Finding IDs such as `BE-9` or `PROD-1` refer to that report.
For what is live today read [status.md](status.md); for how lanes are run read [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md).

## Order

1. **Wave 3 - launch tracks:** billing, notifications, growth and operations, each with the security work it needs.
2. **Wave 4 - styling system and upgrades:** component restyle and split, major dependency upgrades (Tailwind 4 is done).
3. **Wave 5 - features:** one lane per feature.

A wave starts when the previous wave's lanes are merged and `main` is green.
Wave 3 also needs the owner decisions listed below.

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
| D10 | Choose an error-reporting service | W3-D | Sentry with PII scrubbing |
| D11 | Enforce App Check in the console and provide a reCAPTCHA Enterprise key | Before Function-backed surfaces go live | Code supports reCAPTCHA v3 (default) and Enterprise |
| D12 | Delete the merged local branches and worktrees under `projects/polish/` on the owner's machine | Any time | Leave untouched |
| - | Upgrade `uv-activity-planner` to Blaze with a budget alert | Before any Functions deploy (W3-A, W3-B) | Spark; Functions stay undeployed |
| - | Publish the Google OAuth consent screen and pass scope verification for `calendar.freebusy` and `calendar.events.owned` | Before Google Calendar is turned on in production | Calendar connect stays hidden (no OAuth client ID in the build) |

## Wave 3 - Launch tracks (4 lanes)

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
- **Owns:** `functions/src/notifications/`, `functions/scripts/send-notifications.js` and `functions/scripts/notification-core.js` (removal), `.github/workflows/notify.yml` (removal), the notification section of `components/PreferencesModal.tsx`, `components/InstallPrompt.tsx`
- **Touch points:** the notification entries in `lib/billing.ts` and `components/PricingModal.tsx` (owned by W3-A)
- **Work:** an hourly `onSchedule` dispatcher on a least-privilege service account that reuses the at-most-once claim logic; restore the notification copy removed in #24; iOS Home Screen install guidance; a foundation for threshold alerts.
- **Acceptance:** an emulator test sends exactly one notification per eligible user per local morning across time zones; then the real-device checks in the [owner checklist](OWNER_CHECKLIST.md#notifications).

### W3-C - Growth: guest mode, landing, performance, PWA

- **Branch:** `feat/guest-landing-pwa`
- **Closes:** PROD-1, PROD-5, PROD-6, PROD-3 (remaining upsell wiring), PERF-1, PERF-2, UX-5, UX-6, BE-12 (forecast proxy, with D5)
- **Owns:** `app/page.tsx`, `app/app/` (new), `components/Welcome.tsx`, `components/Onboarding.tsx`, `scripts/generate-sw.js` (replaced by an app-shell service worker), lazy-loading boundaries
- **Touch points:** routing in `components/App.tsx`; upsell handlers in `components/Dashboard.tsx`
- **Work:** a static marketing page at `/` with real screenshots and a direct "Sign in"; the app at `/app`; a read-only guest dashboard (D7); Firebase loaded only on sign-in or an existing session; lazy modals and calendar; an app-shell service worker with an offline forecast, an "updated" stamp and the push handler; onboarding with autocomplete, Back on every step, focus management and specific geolocation errors; every upsell opens pricing.
- **Acceptance:** landing LCP under 2.5 s on throttled mobile with under 100 KB gzip of JavaScript.

### W3-D - Operations

- **Branch:** `ops/observability-staging`
- **Closes:** OPS-12, OPS-15 (remaining), OPS-16, OPS-17, CQ-13 (error reporting part)
- **Owns:** `.github/` except `notify.yml`, `.firebaserc`, `infra/` (new), `docs/RUNBOOK.md` (new), `components/ErrorBoundary.tsx`, `app/global-error.tsx` (new), `instrumentation-client.ts` (new)
- **Work:** error reporting with source maps and PII scrubbing (D10); uptime checks; alerts on Function errors, scheduled-job failures, webhook 5xx and stalled deletions; PITR, delete protection, daily backups and a restore drill; budget alerts; PR preview channels and staging promotion (D9); a runbook with rollback per component and a secret rotation table.

## Wave 4 - Styling system, upgrades and polish

### W4-A..E - Component restyle and split (5 lanes in parallel)

Each lane converts inline styles to Tailwind, splits large components (target under 250 lines), extracts hooks (`useGoogleCalendar`, `useToast`, `useReverseGeocode`, `useTheme`) and adds component tests, for its own file group only.
Closes CQ-11, CQ-12, UX-10 and the inline-style part of CQ-13.
Use the theme utilities defined in `app/globals.css` (`bg-surface-card`, `text-ink-2`, `border-line-strong`, `bg-accent text-accent-on`, `bg-uv-high`, ...) rather than raw colors; utilities override the hand-written rules and CSS modules, which live in `@layer components`.

| Lane | Files in `components/` and `app/` |
| --- | --- |
| W4-A | `Dashboard.tsx`, `SunArc.tsx`, `UVTimeline.tsx`, `PlanAhead.tsx`, `ActivityCards.tsx` |
| W4-C | `PreferencesModal.tsx`, `PricingModal.tsx`, `ProfileSwitcher.tsx` |
| W4-D | `AddActivityModal.tsx`, `EditActivityModal.tsx`, `ManageActivitiesModal.tsx`, `ActivityManager.tsx`, `ActivitySuggestionSettings.tsx`, `EmojiPicker.tsx`, `ActivityModalShell.tsx` |
| W4-E | `Header.tsx`, `App.tsx`, `AppShell.tsx`, `TipCarousel.tsx`, `InstallPrompt.tsx`, `Welcome.tsx`, `Onboarding.tsx`, `LocationPopover.tsx`, and the pages under `app/` |

### W4-F - Major upgrades (serial within the lane, parallel with W4-A..E)

One PR per upgrade, in this order: Vitest 5 (with `@vitest/coverage-v8`), ESLint 10, Firebase 13 (then drop the `@grpc/grpc-js` override if it is fixed), Stripe 23 with the pinned `apiVersion` from W3-A, `@types/node` 24, dotenv 18, TypeScript 7 once Next.js and typescript-eslint support it.
Each PR replaces the matching open Dependabot PR (#31-#40).
The lane owns only `package.json`, the lockfiles and the code changes each upgrade requires.

## Wave 5 - Features

Each feature is an independent lane that owns new files plus touch points agreed at kickoff.
Candidates, roughly ranked by impact over effort:

1. **Scheduled activities** (in progress on `feat/scheduled-activities`, not merged): show the Google Calendar events that Solara created as "Scheduled" in the calendar view.
2. Threshold UV alerts and a sunscreen reapply timer (builds on W3-B).
3. A daily briefing card, optionally AI-written, reused by push and share.
4. Family profiles as a headline Pro feature with a "most sensitive person" mode.
5. Cloud-aware forecasts with confidence that decays after day 3.
6. Better skin typing: named Fitzpatrick types, swatches and a short quiz.
7. City landing pages for search traffic (builds on W3-C).
8. Shade and surface reflection factors.
9. Linking with live events from Strava, Meetup and similar services, so Solara can plan around them (idea from the owner, not yet scoped).
10. A native shell (Capacitor) for widgets, reliable iOS push and HealthKit.

## Wave summary

| Wave | Lanes | Gate to start the next wave |
| --- | --- | --- |
| 3 | W3-A, W3-B, W3-C, W3-D | All merged; D9 done |
| 4 | W4-A to W4-F | All merged |
| 5 | One lane per feature | - |

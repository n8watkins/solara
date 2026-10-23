# Solara level-up plan - October 2026

This plan turns [REPORT.md](REPORT.md) into lanes that subagents execute in parallel.
Finding IDs (for example `BE-4`, `UX-1`) refer to the report.

## Purpose

The goal is to make what is live correct, then make Solara launch-ready, then grow it.
Today users get the static app, Firestore and Google sign-in; Functions, Stripe and notifications are built but not live.
So the plan runs in this order:

1. **Fix what users hit today** (safety, privacy and visual bugs in the live app).
2. **Catch up the platform** (dependencies, CI, tooling, types, tests) so it stays healthy.
3. **Launch tracks** (billing, notifications, growth, operations), each with the security work it needs.
4. **Polish and grow** (styling system, major upgrades, new features).

Every finding in the report is assigned to exactly one lane; see the [coverage matrix](#coverage-matrix).

## How parallelism works

- Work is split into **waves**.
  Lanes inside a wave run at the same time; a wave starts when the previous wave's lanes are merged.
- Each lane **owns** a set of files.
  Within a wave, no two lanes own the same file.
- A lane may make a small edit to a file it does not own only if that file is listed in its **touch points**, and only the lines described there.
  Anything else is reported to the lead instead of edited.
- New files are owned by the lane that creates them, and a lane owns the existing test files of the source files it owns.
  New test files and new e2e spec files never conflict.
- `package-lock.json` and `functions/package-lock.json` are never hand-merged.
  After rebasing, a lane regenerates them with `npm install` (and `npm install --prefix functions`) and commits the result.
- Docs: a lane updates the doc sections about its own work.
  Docs conflicts are resolved by rebase; they are prose and merge cheaply.

## Agent contract (applies to every lane)

1. Create a fresh git worktree from the latest `origin/main` on the branch named by the lane.
2. Read `docs/assessment-2026-10/REPORT.md` and this plan before changing anything.
3. For each bug, reproduce it first in the closest end-to-end setting available (browser, emulator or test), then fix it, then prove the fix with an automated test.
   For visual changes, capture before and after screenshots with the UI harness (lane W0-C) at 1440 px and 390 px, light and dark.
4. Commit after each logical change with a clear message.
   Never add an agent name as co-author.
   Never use the em dash character; use a plain dash.
5. Before finishing, run and pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm test --prefix functions`, `npm run test:rules --prefix functions`, and `npm audit --omit=dev --audit-level=high` in both packages.
   Fix any failure or flake you see, even if unrelated, and mention it.
6. Edit only owned files and listed touch points.
   Never edit `CHANGELOG.md` or generated files (`next-env.d.ts`, the `AGENTS.md` block that `next dev` writes).
7. Push the branch and open a PR against `main`.
   Do not merge, deploy, or change cloud, GitHub or Stripe settings.
8. Finish with a summary: what changed, test evidence, finding IDs closed, anything deferred, and any owner action now required.

## Merge protocol

- The lead session reviews each PR, waits for green CI, rebases if needed and merges with squash.
- Merging to `main` deploys Hosting, so the owner can ask for approval before each merge.
- Within a wave, merge in the order listed in that wave; later lanes rebase onto the earlier merges.
- A wave closes when all its PRs are merged and `main` is green.

## Owner decisions and actions

Agents never make these; they follow the default until the owner decides.

| # | Decision or action | Needed by | Default |
| --- | --- | --- | --- |
| D1 | Functions deployment status | Done | Not deployed: the Cloud Functions API is disabled on `uv-activity-planner` (checked 2026-10-23) |
| D2 | Make the repo public, or buy GitHub Pro, for branch protection, environments, CodeQL and secret scanning | Wave 1 (W1-G) | Stay private; use gitleaks, zizmor and actionlint |
| D3 | Grant the deploy SA `roles/datastore.indexAdmin`; later run the Workload Identity Federation setup that W1-G documents | Wave 1 | Production deploys stay red at the index step until done |
| D4 | Rotate or delete the existing SA JSON key | When W1-G's WIF setup is live | Delete the key right after WIF works |
| D5 | Open-Meteo commercial plan or another provider | Wave 3 (W3-C) | Free tier plus attribution; risk stays open |
| D6 | Notifications: relaunch | Wave 3 (W3-B) | Relaunch on a scheduled Function |
| D7 | Guest mode before sign-in | Wave 3 (W3-C) | Yes |
| D8 | Operator name, contact email, jurisdiction, license | Wave 1 (W1-H) | Clearly marked placeholders |
| D9 | Staging Firebase project and Stripe test mode | Wave 3 | Required before W3-A and W3-D finish |
| D10 | Error reporting service | Wave 3 (W3-D) | Sentry with PII scrubbing |
| D11 | App Check enforcement in the console and a reCAPTCHA Enterprise key | Wave 1 (W1-F) | Code supports both providers |
| D12 | Delete the 13 merged local branches and 8 worktrees under `projects/polish/` | Any time | Leave untouched |

## Wave 0 - Foundations (3 lanes)

Already merged or in review: **PR #17** (Node 24 for Functions, in-range dependency updates, production audit gate) closes BE-1, BE-3, OPS-1, OPS-2, CQ-2 and part of OPS-14.
Wave 0 lanes start now; they can run while #17 is in review because they touch different files.
Merge order: #17, then W0-A, then W0-B and W0-C.

### W0-A - Strictness, lint and coverage

- **Branch:** `chore/strictness-lint-coverage`
- **Closes:** CQ-8, CQ-9, CQ-10 (coverage tooling)
- **Owns:** `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, formatter config (new), and every source file only for mechanical fixes the new rules require
- **Why first:** it touches many files lightly, so it merges before Wave 1 lanes start editing them.
- **Work:** enable `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, target ES2022; re-enable the six disabled lint rules and fix the 26 violations without changing behavior; type-aware lint with `no-floating-promises` and `no-misused-promises`; `reportUnusedDisableDirectives: 'error'`; Prettier or Biome for `ts`, `tsx`, `js`, `css` with a CI check; `@vitest/coverage-v8` with thresholds at the current numbers; ignore `next dev`'s generated `AGENTS.md` or commit it, whichever keeps the tree clean.
- **Acceptance:** all checks green; behavior unchanged (no snapshot or e2e changes).

### W0-B - Docs truth

- **Branch:** `docs/refresh-status`
- **Closes:** OPS-24, OPS-22 (except license)
- **Owns:** `docs/status.md`, `docs/DEPLOYMENT.md`, `docs/GO_LIVE.md`, `docs/OWNER_ACTIONS.md`, `README.md`, `.local-ops.yaml`
- **Work:** correct stale claims (deployed commit, SA scope, notification schedule removed, no branch protection, Functions not deployed); add D2-D12 to `OWNER_ACTIONS.md`; fix or delete `.local-ops.yaml`.
- **Acceptance:** every factual claim matches the code or is marked "owner to confirm".

### W0-C - Signed-in UI harness

- **Branch:** `test/ui-harness`
- **Closes:** prerequisite for UX, A11Y and visual work in every later wave
- **Owns:** new files only: a harness route compiled only when `NEXT_PUBLIC_UI_HARNESS=1`, mock forecast fixtures, a frozen clock helper, a Playwright project that screenshots the dashboard, calendar, settings and pricing
- **Work:** render the real `Header`, `Dashboard`, `CalendarView`, `PreferencesModal` and `PricingModal` with fixed data and a fixed clock; prove the harness route is absent from the production build; add `@axe-core/playwright` scans that report (not fail) violations.
- **Acceptance:** `npm run test:harness` produces deterministic screenshots and an axe report; the production `out/` has no harness route.

## Wave 1 - Fix what is live, and catch up the platform (9 lanes)

All nine lanes run in parallel.
Merge order: W1-A, W1-B, W1-C, W1-D, W1-E, W1-F, W1-G, W1-H, W1-I (data and shell first, then UI, then platform).

### W1-A - Forecast data correctness

- **Branch:** `fix/forecast-data`
- **Closes:** CQ-1, BE-15, BE-16, BE-7 (fetch timeout and last-good fallback), CQ-3 (weather label and ICS drift only)
- **Owns:** `lib/forecast.ts`, `lib/ics.ts`, `functions/lib/sun.js`, `functions/lib/ics.js`, `scripts/notification-core.js`, the forecast-parsing section of `scripts/send-notifications.js`, their tests
- **Work:** `null` UV stays `null` everywhere and unknown hours are never eligible; one weather-label table; ICS outputs aligned with a sync test; activity ids validated and ICS UIDs escaped; 5 s fetch timeout with last-good fallback; notifier evicts failed cache entries and retries once.
- **Acceptance:** fixtures with `null` gaps produce no recommendation in those hours in the app, feed and notifier.

### W1-B - Account isolation and app shell

- **Branch:** `fix/account-isolation`
- **Closes:** FE-3, CQ-7 (auth race and unaborted weather fetch only), OPS-4 (interim: hide notification claims, delete dead `showNotif` code), UX-9
- **Owns:** `components/App.tsx`, `components/Header.tsx`, `lib/prefs.ts`, `lib/cache.ts`, `lib/session.ts` (new), `components/NotificationBanner.tsx`, `components/InstallPrompt.tsx`
- **Touch points:** `components/PreferencesModal.tsx` (replace the sign-out call with `signOutAndClear()`; notification copy lines), `components/PricingModal.tsx` (notification bullet), `lib/billing.ts` (`PRO_FEATURES` notification entry)
- **Work:** `signOutAndClear()` clears local prefs, weather cache and notification state, or they are namespaced by uid; new accounts are seeded only with onboarding fields, never `uid`, `tier` or `calendarFeedToken`; seed-write errors are handled; stale auth results and stale weather responses are ignored; compact mobile header with city and current UV.
- **Acceptance:** e2e or component test: user A signs out, new user B signs in on the same browser and inherits nothing.

### W1-C - Dashboard correctness

- **Branch:** `fix/dashboard-recommendations`
- **Closes:** UX-1, UX-2, A11Y-3 (sun arc and UV strip parts), FE-12 (`ActivityCards.tsx`)
- **Owns:** `components/Dashboard.tsx`, `components/SunArc.tsx`, `components/UVTimeline.tsx`, `components/ActivityCards.tsx`, `components/PlanAhead.tsx`, `lib/planner.ts`, `lib/scheduler.ts`, `lib/next-slot.ts` (new)
- **Work:** one "next actionable slot" function (future, long enough for the activity) used by the hero, cards, PlanAhead and share; drop or label elapsed windows; one UV source for "now"; sun arc keeps its aspect ratio and lines up with the strip; arc is a keyboard slider or hidden from assistive tech; strip bars announce the risk level and the strip has a text summary; `noopener` on `window.open`.
- **Acceptance:** harness screenshots show one consistent recommendation per activity at 10:30 and none in the past.

### W1-D - Calendar week view

- **Branch:** `fix/calendar-week-view`
- **Closes:** UX-3, FE-12 (`CalendarView.tsx`)
- **Owns:** `components/CalendarView.tsx`
- **Work:** CSS grid day columns with equal clipped lanes; compact chips with a detail sheet; axis starts at the earliest window; shared max-width with the header; `noopener` on `window.open`.
- **Acceptance:** harness screenshots at both widths show every chip inside its day column with readable labels.

### W1-E - Design tokens, theme and focus

- **Branch:** `fix/design-tokens-a11y`
- **Closes:** A11Y-1, A11Y-5, UX-4, UX-7, UX-8, PERF-4, FE-6 (fonts)
- **Owns:** `app/globals.css`, `tailwind.config.ts`, `lib/theme.ts`, `components/ThemeInit.tsx`, `components/DarkModeToggle.tsx`, `app/layout.tsx`
- **Touch points:** hard-coded banner colors in `components/App.tsx` (replace hex values with tokens only)
- **Work:** accent and `--text-3` tokens that pass WCAG AA in both themes; disabled button styles; hover rules under `@media (hover: hover)`; 2 px `:focus-visible` outline on inputs; self-hosted variable Inter via `next/font`; System/Light/Dark with the system default and a blocking head script so there is no flash.
- **Acceptance:** zero axe color-contrast violations on harness screens; no Google Fonts request.

### W1-F - Backend security

- **Branch:** `feat/backend-security`
- **Closes:** BE-4, BE-5, BE-6, BE-7 (feed lookup, caching and rate limits), BE-17, BE-18, BE-20, FE-10, FE-6 (reCAPTCHA), CQ-14
- **Owns:** `functions/**` except W1-A's files, `firestore.rules`, `firestore.indexes.json`, `lib/feed.ts`, `components/CalendarFeed.tsx`, `lib/firebase.ts`, `lib/notifications.ts`, `lib/billing.ts` (except W1-B's touch point), `app/account/page.tsx`
- **Work:** server-minted feed tokens stored as `sha256` doc ids in server-only `calendarFeeds/{hash}`, looked up by doc get, removed from client-writable keys, migrated, deleted on account deletion; typed and size-capped rules for every user field with a rules test for each; App Check on every browser-called endpoint with limited-use tokens and replay protection for delete and checkout, Enterprise provider supported, initialized only after sign-in; feed `Cache-Control: private, max-age=900` and ETag; allowlisted error codes; `functions/tsconfig.json` with `checkJs` and `strict` plus an `HttpError` class; no `Math.random` token fallback.
- **Acceptance:** a test proves a copied token cannot hijack another feed; rules tests cover every writable field; functions typecheck runs in CI.

### W1-G - CI/CD and supply chain

- **Branch:** `ci/modernize-pipeline`
- **Closes:** BE-2, BE-8, BE-11 (deploy identity), OPS-3 (pipeline side), OPS-5, OPS-6 (config side), OPS-7, OPS-8, OPS-9, OPS-10, OPS-11, OPS-18, OPS-19, OPS-20, OPS-21, CQ-15
- **Owns:** `.github/**`, `playwright.config.ts`, `firebase.pre-functions.json`, `firestore.pre-functions.rules`, `functions/.env` (new), `SECURITY.md` (new), `CODEOWNERS` (new), `docs/WIF_SETUP.md` (new)
- **Work:** reusable `quality.yml`; CI on `pull_request` and push to `main` with `cancel-in-progress`; build `out/` once, test it and deploy that artifact; default `permissions: contents: read`; actions pinned by SHA at latest majors; Workload Identity Federation with separate deploy and notifier identities plus the gcloud steps the owner runs; locked firebase-tools everywhere; indexes in their own visible job; remove the pre-functions rules swap; resolvable Functions params; deploy timeout, SBOM and provenance; Dependabot for both packages and actions; dependency-review, gitleaks, zizmor and actionlint; Playwright against the static export on the Hosting emulator with a random port; public `NEXT_PUBLIC_*` values as variables with a build check; npm install-script allowlist.
- **Acceptance:** one quality run per PR, all green; zizmor and actionlint clean.

### W1-H - Frontend privacy and hardening

- **Branch:** `feat/frontend-privacy`
- **Closes:** FE-1, FE-2, FE-4, FE-5, FE-7, FE-8, FE-9, FE-11, FE-14, FE-15, FE-16, PROD-7, PROD-8, BE-12 (attribution part)
- **Owns:** `firebase.json`, `scripts/generate-sw.js`, a postbuild CSP script (new), `app/share/**`, `lib/share.ts`, `app/privacy/**`, `app/terms/**`, `components/AnalyticsConsent.tsx`, `lib/gcal.ts`, `lib/geocoding.ts`, `components/LocationPopover.tsx`
- **Touch points:** geolocation and reverse-geocode calls in `components/Onboarding.tsx` and `components/PreferencesModal.tsx`; the GA id check in `app/layout.tsx`
- **Work:** per-page script hashes and per-route CSP generated at build, exact connect-src hosts, `Reporting-Endpoints`, Report-Only first then enforced, with a test that script-src has no `'unsafe-inline'`; `calendar.freebusy` scope and a narrower booking scope with truthful copy; coordinates rounded to 2 decimals before any request or storage; one cached, debounced reverse-geocode helper; Open-Meteo and OpenStreetMap attribution; complete privacy policy with D8 placeholders; share links with length and type limits, ISO dates and `noindex`; GA without query strings or signals, cookies deleted on decline, equal-weight buttons, non-blocking banner; service worker bundled from npm Firebase with same-origin links and focus of an existing window; header and caching tweaks; unknown paths return 404.
- **Acceptance:** a browser probe of the built site shows zero CSP violations with enforcement on, and no third-party request before consent except disclosed security services.

### W1-I - Dialogs and semantics

- **Branch:** `fix/dialogs-a11y`
- **Closes:** A11Y-2, A11Y-3 (tooltips), A11Y-4
- **Owns:** `components/ActivityModalShell.tsx`, `components/Tooltip.tsx`, `components/PreferencesModal.tsx` (except W1-B and W1-H touch points), `components/PricingModal.tsx` (except W1-B touch point), `components/EditActivityModal.tsx`, `components/ManageActivitiesModal.tsx`, `components/EmojiPicker.tsx`, `components/ActivityManager.tsx`, `components/ActivitySuggestionSettings.tsx`, `components/ProfileSwitcher.tsx`, `components/TipCarousel.tsx`, `components/Dialog.tsx` and its styles (new)
- **Work:** one native `<dialog>` component with `showModal()`, used by every modal including Settings; tooltips become buttons with popovers; h1 per screen and h2 per card in owned files; labels on all controls; 24 px minimum targets; `aria-pressed` on chips; `role="status"` on toasts; full menu keyboard support or no `role="menu"`.
- **Acceptance:** keyboard-only pass through every modal; zero serious axe violations on modal screens.

## Wave 2 - Shared core and typed platform (1 serial step, then 4 lanes)

### W2-0 - Workspace skeleton (serial, merges first)

- **Branch:** `refactor/workspace-core`
- **Closes:** CQ-3 (structure), OPS-14 (remaining), FE-13
- **Work:** npm workspaces; `packages/core` in TypeScript holding the recommendation engine, a Zod-validated Open-Meteo parser, ICS builder, weather labels and token policy, moved from W1-A's unified code; app and Functions consume it; `firebase-admin` leaves the web app's dependencies.
- **Acceptance:** no business logic is duplicated; grep for the old mirrors finds nothing.

### W2-A - Prefs schema and migrations

- **Branch:** `refactor/prefs-schema`
- **Closes:** CQ-5, CQ-6 (prefs and API response validation)
- **Owns:** `lib/prefs.ts`, `lib/types.ts` (except W2-C's touch point), prefs schema in `packages/core`, rules key-list test
- **Work:** one Zod schema with `z.infer` types; `schemaVersion` migrations; refuse to write newer-version documents; `setDoc` with merge instead of read-then-write; rules key lists checked against the schema; Zod validation of geocoding, Nominatim and Functions responses.

### W2-B - Functions in TypeScript

- **Branch:** `refactor/functions-typescript`
- **Closes:** CQ-4, BE-17 (remaining), OPS-15 (structured logging part)
- **Owns:** `functions/**`
- **Work:** migrate to TypeScript consuming `packages/core`; `firebase-functions/logger` with severities; directory layout `functions/src/{billing,account,feed,notifications}` so Wave 3 lanes own separate folders.

### W2-C - Data layer and time

- **Branch:** `refactor/data-layer`
- **Closes:** CQ-7 (remaining), CQ-6 (cache validation), PERF-3, PROD-2, PROD-4, CQ-13 (React Compiler)
- **Owns:** `components/App.tsx`, `lib/forecast.ts`, `lib/cache.ts`, `lib/units.ts` (new), `lib/time.ts` (new), `next.config.ts`
- **Touch points:** weather and forecast types in `lib/types.ts`; temperature and time rendering lines in `components/Dashboard.tsx`, `components/CalendarView.tsx`, `components/UVTimeline.tsx`; units fields in `components/PreferencesModal.tsx`
- **Work:** TanStack Query (or equivalent) with abort, stale-while-revalidate, multi-location persisted, validated and versioned cache and midnight rollover; "today" and "now" from the location's time zone; Celsius storage with units and 12/24-hour preferences defaulting from locale; React Compiler enabled.

### W2-D - Signed-in e2e on emulators

- **Branch:** `test/emulator-e2e`
- **Closes:** CQ-10 (remaining)
- **Owns:** `tests/e2e/signed-in/**` (new), emulator config, `lib/firebase.ts` (emulator connection only)
- **Work:** Playwright project under `firebase emulators:exec` with Auth, Firestore and Functions; sign in through the Auth emulator; cover dashboard, add/edit/delete activity, preferences, calendar, share links and Pro gating; run in CI.

## Wave 3 - Launch tracks (4 lanes)

Functions folders from W2-B keep the backend lanes apart.

### W3-A - Billing and account lifecycle

- **Branch:** `feat/billing-launch`
- **Closes:** BE-9, BE-10, BE-13, BE-14, PROD-3 (pricing content)
- **Owns:** `functions/src/billing/**`, `functions/src/account/**`, `components/PricingModal.tsx`, `lib/billing.ts`, `app/account/**`
- **Work:** delete the Stripe customer after subscriptions end; TTLs on server records; billing summary in export; deletion never stalls (missing resources count as done, retry cap, alert); pinned Stripe `apiVersion`; refunds for server-initiated cancellations; `past_due` grace; pricing that leads with alerts, family profiles and travel locations, with annual and trial options; end-to-end test in Stripe test mode on staging (D9).

### W3-B - Notifications relaunch

- **Branch:** `feat/scheduled-notifications`
- **Closes:** OPS-4, BE-19, BE-11 (runtime identity)
- **Owns:** `functions/src/notifications/**`, `scripts/send-notifications.js` and `scripts/notification-core.js` (removal), `.github/workflows/notify.yml` (removal), `components/NotificationBanner.tsx`, notification settings section of `components/PreferencesModal.tsx`
- **Work:** hourly `onSchedule` dispatcher on a least-privilege SA reusing the at-most-once claim logic; restore notification copy; iOS Home Screen install guidance; foundation for threshold alerts.
- **Acceptance:** emulator test sends exactly one notification per eligible user per local morning across time zones.

### W3-C - Growth: guest mode, landing, performance, PWA

- **Branch:** `feat/guest-landing-pwa`
- **Closes:** PROD-1, PROD-5, PROD-6, PROD-3 (upsell wiring), PERF-1, PERF-2, UX-5, UX-6, BE-12 (forecast proxy, with D5)
- **Owns:** `app/page.tsx`, `app/app/**` (new), `components/Welcome.tsx`, `components/Onboarding.tsx`, `scripts/generate-sw.js` (replaced by Serwist), lazy-loading boundaries
- **Touch points:** routing in `components/App.tsx`; upsell handlers in `components/Dashboard.tsx`
- **Work:** static marketing page at `/` with real screenshots and a direct "Sign in"; app at `/app`; read-only guest dashboard; Firebase loaded only on sign-in or an existing session; lazy modals and calendar; app-shell service worker with offline forecast, "updated" stamp and the push handler; onboarding with autocomplete, Back on every step, focus management and specific geolocation errors; every upsell opens pricing.
- **Acceptance:** landing LCP under 2.5 s on throttled mobile with under 100 KB gzip JS.

### W3-D - Operations

- **Branch:** `ops/observability-staging`
- **Closes:** OPS-12, OPS-15 (remaining), OPS-16, OPS-17
- **Owns:** `.github/**` except `notify.yml`, `.firebaserc`, `infra/**` (new), `docs/RUNBOOK.md` (new), `components/ErrorBoundary.tsx`, `app/global-error.tsx` (new), `instrumentation-client.ts` (new)
- **Work:** error reporting with source maps and PII scrubbing; uptime checks; alerts on function errors, scheduled-job failures, webhook 5xx and stalled deletions; PITR, delete protection, daily backups and a restore drill; budget alerts; PR preview channels and staging promotion; runbook with rollback per component and a rotation table.

## Wave 4 - Styling system, upgrades and polish

### W4-0 - Tailwind 4 (serial, merges first)

- **Closes:** OPS-13 (Tailwind), the remaining `braces` and `postcss-selector-parser` advisories
- **Work:** `@tailwindcss/upgrade`, CSS-first `@theme` using the W1-E tokens, one UV palette; restore the full audit as a blocking gate if it is clean.

### W4-A..E - Component restyle and split (5 lanes in parallel)

Each lane converts inline styles to Tailwind, splits large components (target under 250 lines), extracts hooks (`useGoogleCalendar`, `useToast`, `useReverseGeocode`, `useTheme`) and adds component tests, for its own file group only.
Closes CQ-11, CQ-12, UX-10 and the inline-style part of CQ-13.

| Lane | Files |
| --- | --- |
| W4-A | `Dashboard.tsx`, `SunArc.tsx`, `UVTimeline.tsx`, `PlanAhead.tsx`, `ActivityCards.tsx` |
| W4-B | `CalendarView.tsx`, `CalendarFeed.tsx` |
| W4-C | `PreferencesModal.tsx`, `PricingModal.tsx`, `ProfileSwitcher.tsx` |
| W4-D | `EditActivityModal.tsx`, `ManageActivitiesModal.tsx`, `ActivityManager.tsx`, `ActivitySuggestionSettings.tsx`, `EmojiPicker.tsx`, `ActivityModalShell.tsx` |
| W4-E | `Header.tsx`, `App.tsx`, `TipCarousel.tsx`, `InstallPrompt.tsx`, `NotificationBanner.tsx`, `Welcome.tsx`, `Onboarding.tsx`, `LocationPopover.tsx`, `app/**` pages |

### W4-F - Major upgrades (serial within the lane, parallel with W4-A..E)

One PR per upgrade, in order: Vitest 5, ESLint 10, Firebase 13 (then drop the gRPC override if fixed), Stripe 23 with the pinned `apiVersion`, `@types/node` 24, TypeScript 7 once Next and typescript-eslint support it.
Owns only `package.json`, lockfiles and the code changes each upgrade requires.

## Wave 5 - Features (parallel lanes, one per feature)

Ranked by impact over effort; each is an independent lane that owns new files plus listed touch points decided at kickoff.

1. Threshold UV alerts and a sunscreen reapply timer (builds on W3-B).
2. Daily briefing card, optionally AI-written, reused by push and share.
3. Family profiles as a headline Pro feature with a "most sensitive person" mode.
4. Cloud-aware forecasts with confidence that decays after day 3.
5. Better skin typing: named Fitzpatrick types, swatches and a short quiz.
6. City landing pages for search traffic (builds on W3-C).
7. Shade and surface reflection factors.
8. Native shell (Capacitor) for widgets, reliable iOS push and HealthKit.

## Wave summary

| Wave | Lanes in parallel | Gate to start next wave |
| --- | --- | --- |
| 0 | W0-A, W0-B, W0-C (plus PR #17) | All merged, `main` green |
| 1 | W1-A to W1-I (9 lanes) | All merged; D2, D3, D11 decided |
| 2 | W2-0, then W2-A to W2-D (4 lanes) | All merged |
| 3 | W3-A to W3-D (4 lanes) | All merged; D9 done |
| 4 | W4-0, then W4-A to W4-F (6 lanes) | All merged |
| 5 | One lane per feature | - |

## Coverage matrix

| Finding | Lane | Finding | Lane | Finding | Lane |
| --- | --- | --- | --- | --- | --- |
| BE-1 | PR #17 | FE-1 | W1-H | OPS-1 | PR #17 |
| BE-2 | W1-G | FE-2 | W1-H | OPS-2 | PR #17 |
| BE-3 | PR #17 | FE-3 | W1-B | OPS-3 | W1-G + D3 |
| BE-4 | W1-F | FE-4 | W1-H | OPS-4 | W1-B, W3-B |
| BE-5 | W1-F | FE-5 | W1-H | OPS-5 | W1-G + D4 |
| BE-6 | W1-F | FE-6 | W1-E, W1-F | OPS-6 | W1-G + D2 |
| BE-7 | W1-A, W1-F | FE-7 | W1-H | OPS-7 | W1-G |
| BE-8 | W1-G | FE-8 | W1-H | OPS-8 | W1-G |
| BE-9 | W3-A | FE-9 | W1-H | OPS-9 | W1-G |
| BE-10 | W3-A | FE-10 | W1-F | OPS-10 | W1-G |
| BE-11 | W1-G, W3-B | FE-11 | W1-H | OPS-11 | W1-G |
| BE-12 | W1-H, W3-C + D5 | FE-12 | W1-C, W1-D | OPS-12 | W3-D |
| BE-13 | W3-A | FE-13 | W2-0 | OPS-13 | W4-0, W4-F |
| BE-14 | W3-A | FE-14 | W1-H | OPS-14 | PR #17, W2-0 |
| BE-15 | W1-A | FE-15 | W1-H | OPS-15 | W2-B, W3-D |
| BE-16 | W1-A | FE-16 | W1-H | OPS-16 | W3-D |
| BE-17 | W1-F, W2-B | CQ-1 | W1-A | OPS-17 | W3-D |
| BE-18 | W1-F | CQ-2 | PR #17 | OPS-18 | W1-G |
| BE-19 | W3-B | CQ-3 | W1-A, W2-0 | OPS-19 | W1-G |
| BE-20 | W1-F | CQ-4 | W2-B | OPS-20 | W1-G |
| PROD-1 | W3-C | CQ-5 | W2-A | OPS-21 | W1-G |
| PROD-2 | W2-C | CQ-6 | W2-A, W2-C | OPS-22 | W0-B + D8 |
| PROD-3 | W3-A, W3-C | CQ-7 | W1-B, W2-C | OPS-23 | D12 |
| PROD-4 | W2-C | CQ-8 | W0-A | OPS-24 | W0-B |
| PROD-5 | W3-C | CQ-9 | W0-A | A11Y-1 | W1-E |
| PROD-6 | W3-C | CQ-10 | W0-A, W0-C, W2-D | A11Y-2 | W1-I |
| PROD-7 | W1-H | CQ-11 | W4-A..E | A11Y-3 | W1-C, W1-I |
| PROD-8 | W1-H | CQ-12 | W4-0, W4-A..E | A11Y-4 | W1-I |
| PERF-1 | W3-C | CQ-13 | W2-C, W4-A..E | A11Y-5 | W1-E |
| PERF-2 | W3-C | CQ-14 | W1-F | UX-1 | W1-C |
| PERF-3 | W2-C | CQ-15 | W1-G | UX-2 | W1-C |
| PERF-4 | W1-E | UX-4 | W1-E | UX-3 | W1-D |
| UX-5 | W3-C | UX-6 | W3-C | UX-7 | W1-E |
| UX-8 | W1-E | UX-9 | W1-B | UX-10 | W4-A..E |

## Subagent kickoff template

```text
You are implementing lane [LANE-ID] of the Solara level-up plan.
Repository: github.com/n8watkins/solara. Create a git worktree from the latest origin/main on branch [branch].
Read docs/assessment-2026-10/REPORT.md and docs/assessment-2026-10/PLAN.md first, then follow the "Agent contract" section exactly.
Your scope is the [LANE-ID] section of PLAN.md: close the listed finding IDs, edit only the files it owns plus its listed touch points, and meet its acceptance criteria.
You may push your branch and open a PR. Do not merge or deploy.
If something needs an owner decision or a file outside your ownership, stop and report it instead of guessing.
```

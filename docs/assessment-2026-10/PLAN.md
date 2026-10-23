# Solara level-up plan - October 2026

This plan turns [REPORT.md](REPORT.md) into workstreams that subagents can execute in parallel.
Finding IDs (for example `BE-4`, `UX-1`) refer to the report.

## How this plan is structured

- **Phases** run in order.
  A phase starts only after the previous phase's branches are merged to `main`.
- **Workstreams** inside a phase run in parallel.
  Each one owns a disjoint set of files so branches do not conflict.
  If a workstream must touch a file owned by another, it stops and reports instead of editing.
- **Owner decisions** are listed separately.
  Agents never make those decisions; they implement the documented default or wait.

## Agent contract (applies to every workstream)

Every subagent prompt below starts with this contract.

1. Work in a fresh git worktree created from the latest `origin/main`, on the branch named in the workstream.
2. Read `docs/assessment-2026-10/REPORT.md` and this plan before changing anything.
3. For each bug, reproduce it first in the closest end-to-end setting available (browser, emulator or test), then fix it, then prove the fix with an automated test.
4. Commit after each logical change with a clear message.
   Never add an agent name as co-author.
   Never use the em dash character; use a plain dash.
5. Before finishing, run and pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm test --prefix functions`, `npm audit --audit-level=high` in both packages, and `npm run test:rules --prefix functions` if Java is available.
   Fix any failure or flake you see, even if unrelated.
6. Only edit files your workstream owns.
   Never edit `CHANGELOG.md` or generated files.
7. Do not push, open PRs, deploy, or change cloud, GitHub or Stripe settings unless the kickoff message explicitly allows it.
8. Finish with a summary: what changed, test evidence, finding IDs closed, anything deferred, and any owner action now required.

## Owner decisions and actions

These block or shape specific workstreams.
Defaults apply if the owner does not decide.

| # | Decision or action | Blocks | Default if undecided |
| --- | --- | --- | --- |
| D1 | Confirm whether Functions are deployed today and the value of `ENABLE_BLAZE_FUNCTIONS` | Urgency of WS-0 deploy | Assume live; ship WS-0 before 2026-10-30 |
| D2 | Make the repo public, or buy GitHub Pro, to enable branch protection, environments, CodeQL and secret scanning | WS-B protection steps | Stay private; use gitleaks, zizmor and actionlint in CI instead |
| D3 | Grant the deploy SA `roles/datastore.indexAdmin`, then replace the JSON key with Workload Identity Federation | OPS-3, WS-B | WS-B prepares WIF config; owner runs the gcloud steps |
| D4 | Treat the existing SA key as exposed and rotate it now | OPS-5 | Strongly recommended regardless |
| D5 | Buy an Open-Meteo commercial plan, or pick another forecast provider | BE-12, WS-F proxy | Keep free tier; add attribution; flag risk |
| D6 | Notifications: relaunch on a scheduled Function, or remove from pricing | OPS-4, WS-F | Hide notification claims now (WS-0b), relaunch in Phase 2 |
| D7 | Guest mode: allow a read-only dashboard before sign-in | PROD-1, WS-G | Yes |
| D8 | Legal: operator name, contact email, jurisdiction, license | FE-7, OPS-22 | Placeholders flagged in the privacy page PR |
| D9 | Create a staging Firebase project and Stripe test mode | OPS-12, WS-H | Required before Phase 2 billing work |
| D10 | Choose an error-reporting service (Sentry or Google Cloud Error Reporting) | OPS-15, WS-H | Sentry with PII scrubbing |
| D11 | Confirm App Check enforcement in the Firebase console and create a reCAPTCHA Enterprise key | BE-6, WS-A | WS-A ships code that works with both providers |
| D12 | Approve local cleanup of the 13 merged branches and 8 worktrees under `projects/polish/` | OPS-23 | Leave untouched |

## Phase 0 - Unblock and stop the bleeding (target: before 2026-10-30)

Three workstreams, run in parallel; they touch disjoint files.

### WS-0a - Dependencies and runtime

- **Branch:** `chore/unblock-runtime-deps`
- **Closes:** OPS-1, BE-3, BE-1, OPS-2, BE-2, OPS-14 (partial), OPS-18 (partial), CQ-2
- **Owns:** `package.json`, `package-lock.json`, `functions/package.json`, `functions/package-lock.json`, `functions/.env` (new), `.nvmrc` (new), the `node-version` lines in `.github/workflows/*.yml`, `docs/DEPENDENCY_RISK.md`
- **Work:**
  - In-range bumps: next 16.4.2, react 19.3.1, firebase 12.19, firebase-admin 14.5 (root), postcss, vitest 4.1.12, playwright 1.64.1, eslint-config-next 16.4.2.
  - Functions: engines Node 24, firebase-functions 7.4, firebase-admin ^14.5, stripe 22.6.x, firebase-tools 15.34.x.
  - Backend CI jobs to Node 24; add `.nvmrc` and root `engines`; point `setup-node` at `node-version-file`.
  - Fix BE-2: commit `functions/.env` with non-secret `APP_URL` and `STRIPE_PRICE_ID` placeholder, or generate `.env.<projectId>` in the deploy step; add a functions deploy dry-run check (`firebase deploy --only functions --dry-run` against the emulator project) if feasible.
  - Tailwind 3's high advisory has no in-range fix: document it in `DEPENDENCY_RISK.md` and gate CI with `npm audit --omit=dev --audit-level=high` until WS-E2 migrates to Tailwind 4.
- **Acceptance:** both audit gates green; all checks in the contract pass on Node 24; `npm ci` prints no EBADENGINE.

### WS-0b - Safety and privacy hotfixes

- **Branch:** `fix/uv-null-and-account-isolation`
- **Closes:** CQ-1, FE-3, FE-2, OPS-4 (interim copy only), CQ-14 (`Math.random` fallback)
- **Owns:** `lib/forecast.ts`, `functions/lib/sun.js`, `scripts/send-notifications.js` (UV parse lines only), `lib/prefs.ts`, `lib/feed.ts`, `lib/gcal.ts`, `components/App.tsx`, `components/Header.tsx`, `components/PreferencesModal.tsx` (sign-out and notification copy only), `components/PricingModal.tsx`, `components/InstallPrompt.tsx`, `components/NotificationBanner.tsx`, `lib/billing.ts` (`PRO_FEATURES` only), `app/privacy/page.tsx` (calendar sentence only), related tests
- **Work:**
  - Null UV stays `null` through all three parsers; hours with unknown UV are never eligible; fixtures with gaps for each consumer.
  - On sign-out: clear local prefs, weather cache and notification state, or namespace them by uid.
    When seeding a new account, copy only onboarding fields; never `uid`, `tier` or `calendarFeedToken`; handle seed-write errors.
  - Google Calendar: use the `calendar.freebusy` scope for availability; switch booking to `calendar.events.owned` or the no-OAuth template link; fix the code comment and privacy sentence.
  - Hide or label notification claims until WS-F relaunches them; delete dead `showNotif` banner code.
  - Remove the `Math.random` token fallback.
- **Acceptance:** a test signs in as user A, signs out, signs in as new user B, and asserts B inherits nothing; UV fixtures with `null` produce no recommendation in the affected hours.

### WS-0c - Repo and docs truth

- **Branch:** `docs/refresh-status`
- **Closes:** OPS-24, OPS-22 (except license), `.local-ops.yaml`
- **Owns:** `docs/status.md`, `docs/DEPLOYMENT.md`, `docs/GO_LIVE.md`, `docs/OWNER_ACTIONS.md`, `.local-ops.yaml`, `README.md`
- **Work:** correct stale claims (deployed commit, SA scope, notification schedule, branch protection, Node version); add the D1-D12 owner decisions to `OWNER_ACTIONS.md`; fix or delete `.local-ops.yaml`.
- **Acceptance:** every factual claim in docs matches code or is marked "owner to confirm".

## Phase 1 - Security, platform and UX foundations (parallel)

Start after Phase 0 merges.

### WS-A - Backend security hardening

- **Branch:** `feat/backend-hardening-2`
- **Closes:** BE-4, BE-5, BE-6, BE-7, BE-8 (rules side), BE-9, BE-10, BE-13, BE-14, BE-15, BE-16, BE-17, BE-18, FE-10, FE-6 (reCAPTCHA part)
- **Owns:** `functions/**` (except anything WS-F later adds), `firestore.rules`, `firestore.indexes.json`, `functions/test/**`, `lib/feed.ts`, `components/CalendarFeed.tsx`, `lib/firebase.ts`, `lib/billing.ts` (request headers only), `app/account/page.tsx` (request headers only)
- **Work:**
  - Server-minted calendar feed tokens: authenticated endpoint issues the token; store `sha256(token)` as the doc id of a server-only `calendarFeeds/{hash}`; look up by doc get; remove `calendarFeedToken` from client-writable keys; migrate existing tokens; delete on account deletion.
  - Typed, size-capped rule validators for every user field, with rules tests for each.
  - App Check on every browser-called endpoint, limited-use tokens with replay protection for delete and checkout; support `ReCaptchaEnterpriseProvider`; initialize App Check only after sign-in so reCAPTCHA never loads on the landing page (FE-6).
  - Feed: 5 s fetch timeout, last-good fallback, `Cache-Control: private, max-age=900`, ETag.
  - Deletion: treat `resource_missing` as done, cap retries then finish Firestore/Auth deletion, delete the Stripe customer, add TTL `expireAt` fields, include billing summary in export.
  - Pin Stripe `apiVersion`; refund server-initiated cancellations; define `past_due` grace.
  - Validate activity ids; escape ICS UIDs and control characters.
  - Return allowlisted error codes, never `error.message`.
  - Add `functions/tsconfig.json` with `checkJs` and `strict`, plus an `HttpError` class; run it in CI via a functions `typecheck` script.
- **Acceptance:** rules tests cover every writable field; a test proves a copied token cannot hijack another feed; functions typecheck passes.

### WS-B - CI/CD and supply chain

- **Branch:** `ci/modernize-pipeline`
- **Closes:** OPS-3 (pipeline side), OPS-5 (repo side), OPS-7, OPS-8, OPS-9, OPS-10, OPS-11 / BE-8, OPS-19, OPS-20, OPS-21, OPS-6 (config side)
- **Owns:** `.github/**`, `firebase.pre-functions.json`, `firestore.pre-functions.rules`, `playwright.config.ts`, `SECURITY.md` (new), `CODEOWNERS` (new)
- **Work:**
  - Reusable `quality.yml` via `workflow_call`; CI on `pull_request` and push to `main` with `cancel-in-progress`.
  - Build `out/` once, test it, upload it, deploy that exact artifact.
  - `permissions: contents: read` by default; per-job grants; actions pinned by SHA with version comments; latest majors; drop `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`.
  - Workload Identity Federation with `google-github-actions/auth`; separate deploy and notifier identities; document the gcloud setup the owner runs (D3).
  - Use the locked firebase-tools binary everywhere.
  - Firestore indexes in their own job with a visible outcome.
  - Remove the pre-functions rules swap and both files.
  - Deploy timeout; SBOM via `npm sbom`; build provenance attestation.
  - Dependabot for npm (`/`, `/functions`) and github-actions, grouped weekly; dependency-review-action; gitleaks, zizmor and actionlint if the repo stays private.
  - Playwright runs against the static export via the Hosting emulator; random port; no stale server reuse.
  - Move public `NEXT_PUBLIC_*` values to repo variables and fail the build when a required one is empty.
- **Acceptance:** a PR run shows one quality run, all checks green, and zizmor reports no high findings; deploy workflow lints clean with actionlint.

### WS-C - Frontend security and privacy

- **Branch:** `feat/frontend-privacy`
- **Closes:** FE-1, FE-4, FE-5 (attribution and Nominatim caching), FE-7, FE-8, FE-9, FE-11, FE-12, FE-14, FE-15, FE-16
- **Owns:** `firebase.json`, `scripts/generate-sw.js`, `scripts/` new postbuild CSP script, `app/share/**`, `lib/share.ts`, `app/privacy/**`, `app/terms/**`, `components/AnalyticsConsent.tsx`, `app/layout.tsx`, `lib/geocoding.ts`, `components/LocationPopover.tsx`, `components/Onboarding.tsx` (geolocation calls only), `components/ActivityCards.tsx` (`window.open` only), `components/CalendarView.tsx` (`window.open` only), `lib/firebase-hosting.test.ts`
- **Work:**
  - Postbuild script that hashes inline scripts per page and writes per-route CSP headers; move the GA bootstrap to a static file; exact connect-src hosts; `Reporting-Endpoints`; ship as Report-Only first, then enforce; test that script-src has no `'unsafe-inline'`.
  - Round coordinates to 2 decimals before any network call or storage; `enableHighAccuracy: false`.
  - One shared, cached, debounced reverse-geocode helper replacing the three inline Nominatim calls.
  - Open-Meteo and OpenStreetMap attribution in the UI.
  - Privacy policy: operator and contact (D8 placeholders), rights, legal bases, transfers, retention, full processor list.
  - Share links: length and type limits, ISO date instead of free text, `noindex`.
  - GA: strip query strings from `page_location`, disable signals, delete `_ga*` cookies on decline, add GA4 hosts to CSP, equal-weight consent buttons.
  - Service worker bundled from npm Firebase, same-origin link check, focus existing window.
  - `noopener` on all `window.open`; header tweaks; remove the catch-all rewrite so unknown paths 404.
- **Acceptance:** a browser probe of the built site shows zero CSP violations with enforcement on; no third-party request before consent other than disclosed security services.

### WS-E1 - Accessibility and visual correctness

- **Branch:** `fix/a11y-visual`
- **Closes:** A11Y-1..5, UX-1, UX-2, UX-3, UX-4, UX-8, PROD-2, PROD-4, PERF-4, UX-7 (fonts)
- **Owns:** `app/globals.css`, `tailwind.config.ts`, `components/` except files owned by WS-C, `lib/forecast.ts` (time zone and units only, after WS-0b merges), `lib/types.ts`, `lib/theme.ts`, `lib/weather.ts`, `tests/e2e/**`
- **Work:**
  - First, add a committed signed-in UI harness (dev-only route or Playwright fixture with mocked auth and a frozen clock) so the dashboard, calendar, settings and pricing can be screenshot-tested.
  - Contrast tokens (accent about #C2410C for white text, darker `--text-3` in both themes); add `@axe-core/playwright` to every e2e spec.
  - One shared native `<dialog>` modal used everywhere, including Settings.
  - One "next actionable slot" function used by the hero, cards, PlanAhead and share; drop or label elapsed windows; one UV source for "now".
  - Fix SunArc aspect ratio and alignment with the strip; make it a real keyboard slider or hide it from assistive tech.
  - Rebuild the calendar week view on a CSS grid with clipped lanes.
  - Location time zone for "today" and "now"; Celsius storage with units and 12/24-hour preferences defaulting from locale.
  - Self-hosted variable Inter via `next/font`; system dark mode by default with no flash.
  - Disabled button styles; hover rules under `@media (hover: hover)`.
- **Acceptance:** axe reports zero serious or critical violations on welcome, onboarding, dashboard, settings and pricing; visual snapshots of the harness in light and dark, desktop and mobile, are committed and reviewed.

### WS-D1 - Code health quick wins

- **Branch:** `chore/strictness-lint-coverage`
- **Closes:** CQ-8, CQ-9, CQ-10 (coverage tooling only), CQ-15 (port part is WS-B)
- **Owns:** `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.prettierrc` or `biome.json` (new), and only the `lib/` files needed to satisfy new compiler and lint rules that no other Phase 1 workstream owns
- **Coordination:** this workstream touches many files for small fixes, so it runs **first within Phase 1** and merges before the others start, or runs last after they merge.
  Recommended: run it first; it is small (about a day).
- **Work:** enable `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, target ES2022; re-enable the six disabled lint rules and fix the 26 violations; type-aware lint with `no-floating-promises`; formatter with a CI check; `@vitest/coverage-v8` with ratcheting thresholds.
- **Acceptance:** all checks green with the stricter settings; coverage reported in CI.

## Phase 2 - Architecture, notifications and operations

### WS-D2 - Shared core and typed backend

- **Branch:** `refactor/core-workspace`
- **Closes:** CQ-3, CQ-4, CQ-5, CQ-6, CQ-7, CQ-11, CQ-13 (partial)
- **Owns:** repo structure (`packages/core/**`, workspace config), `lib/**`, `functions/lib/**` (moves only), `components/App.tsx`, `components/Dashboard.tsx`, `components/CalendarView.tsx`, `components/PreferencesModal.tsx`
- **Work:** npm workspaces with `packages/core` in TypeScript holding the recommendation engine, a Zod-validated Open-Meteo parser, ICS builder, weather labels, prefs schema with `schemaVersion` migrations and token policy; Functions migrated to TypeScript consuming core; generate or snapshot-test rules key lists from the schema; validated, versioned cache; a data layer (TanStack Query or equivalent) with abort, stale-while-revalidate and midnight rollover; split large components; enable the React Compiler; `global-error.tsx`.
- **Acceptance:** no duplicated business logic remains (grep for the old mirrors returns nothing); a schema change requires editing one file.

### WS-F - Notifications relaunch

- **Branch:** `feat/scheduled-notifications`
- **Depends on:** D6, WS-A merged, WS-D2 merged
- **Closes:** OPS-4, BE-19, BE-16, OPS-14 (remaining), FE-11 (if not done)
- **Owns:** new `functions/src/notifications/**`, `scripts/send-notifications.js` and `scripts/notification-core.js` (removal), `.github/workflows/notify.yml` (removal), notification UI copy
- **Work:** hourly `onSchedule` dispatcher running as a dedicated least-privilege SA, reusing the existing at-most-once claim logic; remove root `firebase-admin` and the cross-package require; restore notification copy; add iOS Home Screen install guidance for web push; add the threshold-alert foundation (UV drops below an activity limit).
- **Acceptance:** an emulator test dispatches exactly one notification per eligible user per local morning across time zones.

### WS-H - Operations

- **Branch:** `ops/observability-runbook`
- **Depends on:** D9, D10
- **Closes:** OPS-12, OPS-15, OPS-16, OPS-17
- **Owns:** `docs/RUNBOOK.md` (new), `infra/**` (new, Terraform or gcloud scripts), `components/ErrorBoundary.tsx`, `app/global-error.tsx` (coordinate with WS-D2), functions logger calls
- **Work:** error reporting wired to boundaries and global handlers with source maps and PII scrubbing; `firebase-functions/logger` everywhere; uptime checks for the site and feed; alerts for function errors, scheduled-job failures, webhook 5xx and stalled deletions; PITR, delete protection, daily backups and a restore drill into staging; budget alerts; PR preview channels and staging promotion; runbook with rollback per component and a rotation table.
- **Acceptance:** a forced error in staging produces an alert; a restore drill is documented with its date.

## Phase 3 - Growth and modernization

### WS-G - Guest mode, landing page and performance

- **Closes:** PROD-1, PROD-5, PROD-6, PROD-7, PROD-8, PERF-1, PERF-2, PERF-3, UX-5, UX-6, UX-9, UX-10, PROD-3
- **Work:** statically rendered marketing page at `/` with real screenshots and a direct "Sign in"; app moves to `/app`; read-only guest dashboard; Firebase loaded only on sign-in or existing session; lazy-loaded modals and calendar; app-shell service worker (Serwist) with offline forecast and "updated" stamp; multi-location stale-while-revalidate cache; non-blocking consent banner; durable share links that open the guest dashboard; every upsell opens pricing; Pro repositioned around alerts, family profiles and travel locations.
- **Acceptance:** landing LCP under 2.5 s on throttled mobile with under 100 KB gzip JS; guest reaches a useful UV view in one step.

### WS-E2 - Styling system and majors

- **Closes:** CQ-12, OPS-13, CQ-13 (remaining)
- **Work:** Tailwind 4 via `@tailwindcss/upgrade` with CSS-first tokens; convert inline styles component by component; one UV palette; one icon set; then majors one PR each: Vitest 5, ESLint 10, Firebase 13, Stripe 23 (with pinned apiVersion), TypeScript 7 once Next and typescript-eslint support it.
- **Acceptance:** fewer than 50 inline style objects; Tailwind advisory gone; full audit green without `--omit=dev`.

### Feature backlog (ranked by impact over effort)

1. Threshold UV alerts and a sunscreen reapply timer.
2. Daily briefing card (optionally AI-written) reused by push and share.
3. Family profiles as a headline Pro feature, with a "most sensitive person" mode.
4. Cloud-aware forecasts with confidence that decays after day 3.
5. Better skin typing (named Fitzpatrick types, swatches, short quiz).
6. Native shell (Capacitor) for widgets, reliable iOS push and HealthKit.
7. City landing pages ("UV index today in Phoenix") for search traffic.
8. Shade and surface reflection factors.

## Parallelism summary

| Phase | Parallel workstreams | Gate to next phase |
| --- | --- | --- |
| 0 | WS-0a, WS-0b, WS-0c | All merged, CI green, Functions on Node 24 deployed (if live) |
| 1 | WS-D1 first, then WS-A, WS-B, WS-C, WS-E1 in parallel | All merged; owner decisions D2, D3, D11 done |
| 2 | WS-D2 first, then WS-F and WS-H in parallel | All merged; staging exists |
| 3 | WS-G and WS-E2 (E2 majors sequentially) | - |

## Subagent kickoff template

Use this prompt for each workstream, filling in the bracketed parts.

```text
You are implementing workstream [WS-ID] of the Solara level-up plan.
Repository: github.com/n8watkins/solara. Create a git worktree from the latest origin/main on branch [branch].
Read docs/assessment-2026-10/REPORT.md and docs/assessment-2026-10/PLAN.md first, then follow the "Agent contract" section exactly.
Your scope is the [WS-ID] section of PLAN.md: close the listed finding IDs, edit only the files it owns, and meet its acceptance criteria.
Permissions for this run: [for example "commit locally only" or "push the branch and open a PR"].
If something requires an owner decision or a file outside your ownership, stop and report it instead of guessing.
```

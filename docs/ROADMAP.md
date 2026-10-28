# Solara roadmap

_Last reviewed: 2026-10-27_

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

Steps 12-18 (Blaze with the budget kill switch, staging and Stripe test mode, the first Functions deploy, monitoring and backups, switching billing on, the Open-Meteo commercial plan, release checks) come at the Pro launch.

## Where we are (2026-10-25)

| Wave | State | PRs |
| --- | --- | --- |
| 0 - unblock and safety net | Done 2026-10-23 | #17-#21 |
| 1 - correctness, security, CI/CD | Done 2026-10-23 | #22-#30 |
| 2 - shared core, data layer, signed-in e2e | Done 2026-10-23 | #44, #47, #49-#52 |
| 4 - Tailwind 4, restyle and split, upgrades | Done 2026-10-24 (ESLint 10 and TypeScript 7 deferred, see Next up) | #57-#67 |
| 3 phase 1 - free launch (no Blaze) | Done 2026-10-24; Sentry and App Check wait for the owner's keys | #70, #71 |
| 3 phase 2 - Pro launch (Blaze) | Built and switched off (items 6, 9, 10, 11); waits for the owner's Pro launch steps | #99, #102, #104, #106, #107 |
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
Settings' Location tab uses the same search (#95), and the data credits name GeoNames, the source of Open-Meteo's places.

### 6. Forecast proxy and licensing (BE-12, with D5) (built, #106)

Built 2026-10-27 in #106 and switched off: one provider adapter (`packages/core/src/forecast.ts`) behind the shared validated parser, and the `forecast` Function, which keeps the Open-Meteo commercial key on the server and caches per place (0.01 degree) and hour, with a 5 s timeout and a 6-hour last-good fallback ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)).
The browser keeps calling Open-Meteo directly until the owner buys the plan (D5) and sets `FORECAST_PROXY_ENABLED` ([owner checklist step 17](OWNER_CHECKLIST.md#at-pro-launch-blaze)).

### 7. ESLint 10 (done)

Done 2026-10-27: ESLint 10.13.0 lints with the same 91 rules and no new disables.
`eslint-config-next` 16.4.3 allows ESLint 10, but three plugins it bundles still declare peer ranges that stop at ESLint 9: `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 and `eslint-plugin-jsx-a11y` 6.10.2.
The root `package.json` therefore overrides their `eslint` peer to the installed version (`"$eslint"`), so `npm ci` and `npm ls` stay clean.
A probe file that breaks one rule of every bundled plugin gives the same findings under ESLint 9 and 10, and the resolved rule set is identical.
Remove the three overrides once those plugins declare ESLint 10 support.

### 8. TypeScript 7 (deferred)

- **Goal:** move to TypeScript 7 (Dependabot #40, #31).
  TypeScript 6.0.3, the last JavaScript-based release, is in use since 2026-10-27.
- **Blocked by:** TypeScript 7.0.2 ships the native compiler and no JavaScript compiler API: `require('typescript')` returns only the version, the rest is under `typescript/unstable/*`.
  `typescript-eslint` 8.72 (peer `typescript` below 6.1) and `next build`, which type checks through that API, both need it.
  TypeScript 7's `tsc` itself type checks both packages cleanly (checked 2026-10-27), but running it beside 6.0 would add a second compiler with the same semantics for no gain beyond speed, so it is not adopted.
- **Unblocks when:** `typescript-eslint` and Next.js support TypeScript 7.
- **Scope:** `package.json`, the lockfiles and any type fixes.
- **Acceptance:** typecheck, lint, tests and build pass in both packages.
- **Size:** S-M once unblocked.

### 9. Wave 3 phase 2: billing and account lifecycle (W3-A) (built, #102, #104)

Built 2026-10-27 and switched off behind `BILLING_ENABLED`; closes BE-9, BE-10 and BE-14 in code.

- #102: checkout for $2.99 a month or $19.99 a year with a once-per-account 7-day trial, the plans dialog's plan choice, the account page's billing summary and portal, tested end to end against a fake Stripe that delivers signed webhooks.
- #104: refunds for server-initiated cancellations, refunds and disputes ending Pro, a 7-day `past_due` grace period, deleting the Stripe customer, deletion that never stalls (missing resources count as done, a retry cap with an ERROR alert), TTLs on server-owned records and on Scheduled records, and a billing summary in the export.

Left for the owner: the Stripe test-mode run on the staging project, then the [Functions and Stripe](OWNER_CHECKLIST.md#functions-and-stripe) checks and switching billing on ([steps 13-16](OWNER_CHECKLIST.md#at-pro-launch-blaze)).

### 10. Wave 3 phase 2: Pro-only morning alerts (W3-B) (built)

Built 2026-10-27 and switched off behind `ALERTS_ENABLED`; closes OPS-4, BE-19 and BE-11 in code.
The scheduled `alerts` Function (`functions/src/notifications/`) runs every 15 minutes for every time zone (D6), as the second of Cloud Scheduler's three free jobs, and sends each entitled Pro account (active, trialing or in the `past_due` grace period) one morning alert per local morning at its chosen hour, at most once per day, with per-run caps, a saved cursor, the cost guard, and removal of devices whose token FCM rejects.
Its own least-privilege identity is created by `infra/alerts-identity.sh` and named by `ALERTS_SERVICE_ACCOUNT`.
The emulator test (`functions/test/emulator/alerts.test.js`) simulates a day of runs across time zones: one alert per entitled account per local morning, none to Free, canceled, lapsed or deleting accounts.
The GitHub Actions notifier is retired.
Left for the owner: the real-device checks in the [owner checklist](OWNER_CHECKLIST.md#notifications), then switching alerts on (step 17).
The morning alert's text is built in `packages/core/src/alerts.ts` with the daily briefing's inputs, so it can switch to the briefing's text once that lands.

### 11. Wave 3 phase 2: operations (rest of W3-D, at Pro launch) (code built, #99, #107)

- **Built:** cost and abuse limits on every Function, the cost guard and the budget kill switch (#99); uptime checks and alert policies as code (`infra/monitoring.sh`, `infra/alerts/`), PITR, delete protection, daily backups and the image cleanup policy (`infra/backups.sh`), TTL policies (`infra/firestore-ttl.sh`), and [RUNBOOK.md](RUNBOOK.md) with alerts, rollback per component, restore steps and the secret rotation table (#107).
- **Left:** the owner applies the scripts ([steps 12-15](OWNER_CHECKLIST.md#at-pro-launch-blaze)); each alert fired once in staging from a forced failure, and a restore drill recorded in the runbook; PR preview channels and staging promotion in the deploy workflow (D9), with the CI owner.
- **Closes:** OPS-15 (alerts and uptime) and OPS-17 in code; OPS-16 once the backups are on; OPS-12 with the staging project.

### 12. Wave 5: features

Each feature is its own lane that owns new files plus touch points agreed at kickoff.
Candidates, roughly ranked by impact over effort:

1. **Scheduled activities** - done (#55, #56); hidden in production until the Google OAuth client ID is set.
2. Threshold UV alerts and a sunscreen reapply timer: the UV alert is built with item 10 (Pro, once a day when the forecast UV reaches the chosen level, outside quiet hours).
3. A daily briefing card, optionally AI-written, reused by push and share.
4. **Family profiles as a headline Pro feature** - done (#105): "Plan for a group" uses the most sensitive person among those ticked for plans and burn estimates, the switcher works on phones, Free sees an honest Pro offer (a waitlist while checkout is off), and the plan comparison names the mode.
5. Cloud-aware forecasts with confidence that decays after day 3.
6. **Better skin typing** - done (#103): named Fitzpatrick types in setup, Settings and profiles, and an optional five-question quiz with the questionnaire's standard scoring.
7. City landing pages for search traffic (builds on the static landing page).
8. **Shade and surface reflection factors** - done (#109): each activity can set its typical shade and the surface around it, which scale the UV it is planned against (cited, cautious factors in `packages/core/src/exposure.ts`), in the app and the calendar feed.
9. Linking with live events from Strava, Meetup and similar services, so Solara can plan around them (owner's idea) - scoped in [integrations/EVENTS.md](integrations/EVENTS.md).
   Recommended: .ics import first (phase 1, no Blaze and no partner approval), then link subscriptions and Pro heads-ups on Blaze, optionally events already in Google Calendar, and Strava last (no future events in its API, a developer subscription and a 10-athlete cap); the Meetup, Eventbrite, Komoot and Garmin APIs are not needed.

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

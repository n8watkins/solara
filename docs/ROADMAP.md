# Solara roadmap

_Last reviewed: 2026-10-28_

This is the plan for the remaining work, in priority order.
What is live today is in [status.md](status.md); the owner's steps are in the [owner checklist](OWNER_CHECKLIST.md); how lanes are run by parallel agents is in [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md).
Finding IDs such as `BE-9` or `PROD-6` refer to the [archived October 2026 assessment](archive/assessment-2026-10/REPORT.md#finding-status).

## Owner steps first

The owner's steps unblock most of the engineering items below, so they come first.
The full, ordered list with exact console links, values, times, costs and checks is [Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order); in short:

- **A, anytime (free, no Blaze):** confirm a non-test Google account can sign in, then Google Calendar (API and OAuth client ID), branding, publishing and the two scope verifications, App Check, Sentry and a free uptime check, locking down the browser API key and Firebase Auth, Firestore quota caps and a traffic alert, trying the TTL policies, the `production` environment and keyless deploys, moving public values to variables, ruleset hardening, private vulnerability reporting, closing the open alerts, small clean-ups and counsel review.
- **B, staging:** the staging deploy is built ([item 34](#34-staging-deploy-before-the-pro-launch-built)); a staging project on Blaze with its own budget, keys and Stripe test mode, and the staging checks.
- **C, Pro launch:** Blaze, the budget kill switch, the Stripe webhook endpoint before the first Functions deploy, the first Functions deploy, monitoring and backups, the Open-Meteo key before billing, then billing, alerts and the release checks.
- **D, per feature switch:** Events from Google Calendar, events from Outlook, linked calendars and Pro alerts.

## Where we are (2026-10-28, through #147)

| Wave | State | PRs |
| --- | --- | --- |
| 0 - unblock and safety net | Done 2026-10-23 | #17-#21 |
| 1 - correctness, security, CI/CD | Done 2026-10-23 | #22-#30 |
| 2 - shared core, data layer, signed-in e2e | Done 2026-10-23 | #44, #47, #49-#52 |
| 4 - Tailwind 4, restyle and split, upgrades | Done 2026-10-24 (ESLint 10 and TypeScript 7 deferred, see Next up) | #57-#67 |
| 3 phase 1 - free launch (no Blaze) | Done 2026-10-24; Sentry and App Check wait for the owner's keys | #70, #71 |
| 3 phase 2 - Pro launch (Blaze) | Built and switched off (items 6, 9, 10, 11), hardened after the third, fourth and fifth reviews (items 14-18, 21, 22) and the sixth (items 25, 26); waits for the owner's Pro launch steps | #99, #102, #104, #106, #107, #118-#124, #126, #128-#130, #133, #134, #136, #138 |
| 5 - features | Done: scheduled activities, the reapply timer and UV alert, the daily briefing, family profiles, cloud-aware forecasts, skin typing, city pages, shade and surface, and .ics event import (events phase 1). Built and switched off: linked calendars with Pro event heads-ups (events phase 2, item 19), events already in Google Calendar (phase 2b, item 20) and events from Outlook (item 23). Built and switched off with linked calendars: the "Add a calendar from..." helper (item 24). Done: the dashboard hero, daylight-only slots and WHO wording (item 28), and 320 px polish (item 31) | #55, #56, #103, #105, #108-#112, #114, #115, #117, #131, #132, #135, #137, #139-#144 |
| 6 - mobile app | Not started | - |

Also done: the move to `solara-uv.web.app` (#42, #45), Search Console verification (#43), the legal operator details (#46), the privacy policy's Google user data section (#48), the docs consolidation (#53), the costs page and Wave 3 decisions (#68), the new-user sign-in race and test flake fixes (#69), every CodeQL alert (#72, #73), the "fast checks locally, full suites on CI" agent contract (#74), the plan docs refresh (#75), and the fixes from the first post-launch code review (client findings in #79, server and rules findings in #81).
The Wave 4 lane details were removed now that the lanes are merged; what each lane changed is in PRs #57-#67.
The eighth review (REVIEW8, 2026-10-28: owner steps and Android readiness, security, delivery readiness; no critical findings) is fixed in three parallel lanes: FIX8A (privacy promises, the runbook's free-stage section, costs and site-only monitoring; done in #146, [item 32](#32-privacy-promises-free-stage-runbook-and-costs-from-the-eighth-review-fix8a-built)), FIX8B (account download and deletion in the browser on Spark; done in #147, [item 33](#33-account-download-and-deletion-without-functions-fix8b-built)) and FIX8C (the owner steps, the deploy env guards and docs, [item 35](#35-owner-steps-deploy-guards-and-docs-from-the-eighth-review-fix8c-built)).
The repository is public, with the "Protect main" ruleset (pull requests, squash merges only, 8 required checks), Dependabot alerts and security updates, secret scanning with push protection, and CodeQL.

## Next up

Each item lists its goal, scope, the files or areas it owns, acceptance criteria, what it depends on and a rough size (S: under a day of agent time, M: one to three days, L: more).
Items 1-8 need no Blaze and can start now; items 9-11 wait for the Pro launch; item 34 (built) unblocks the owner's staging steps.

### 1. Change-aware CI (done, #76)

Done 2026-10-25 in #76: each required check reports on every pull request and runs its suite only when the changed files can affect it; the README's [change-aware checks](../README.md#change-aware-checks) table lists which paths run which suite.

### 2. Sun arc peak label clipped on phones (done, #78)

Done 2026-10-25 in #78: the peak callout stays inside the arc's box at every width, for early and late peaks.

### 3. Faster app load on phones (done, #83, #93)

Done 2026-10-25 in #83 and #93: Lighthouse mobile LCP for `/app/` is about 2.1 s for a guest and the same for a returning account, whose dashboard now shows from this browser's copy while Firebase loads; a guest's first load is about 196 KB gzip of JavaScript, held under 200 KB by `tests/e2e/guest.spec.ts`.
On 2026-10-28 (#127) the install prompt and the dashboard's activity plan moved out of the first load: about 189 KB, and the budget is now 193 KB.

### 4. App-shell service worker with an offline forecast (PERF-2, PROD-6 part) (done, #94)

Done 2026-10-25 in #94: an installed Solara opens offline from the app-shell service worker (`scripts/sw/shell.ts`, built after each build by `scripts/build-sw.mjs`) and shows the last forecast for the place with an offline notice and an "updated at" stamp.
A signed-in account opens read-only from this browser's copy until the browser is back online, and a deploy replaces the worker and its caches at once.

### 5. Place autocomplete in onboarding (PROD-6, done, #80)

Done 2026-10-25 in #80: setup and the header's location panel suggest places while typing, from Open-Meteo's place search (Nominatim's usage policy forbids client-side autocomplete; it stays for "use my location" names).
Settings' Location tab uses the same search (#95), and the data credits name GeoNames, the source of Open-Meteo's places.

### 6. Forecast proxy and licensing (BE-12, with D5) (built, #106)

Built 2026-10-27 in #106 and switched off: one provider adapter (`packages/core/src/forecast.ts`) behind the shared validated parser, and the `forecast` Function, which keeps the Open-Meteo commercial key on the server and caches per place (0.02 degree since item 14) and hour, with a 5 s timeout and a 6-hour last-good fallback ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)).
The browser keeps calling Open-Meteo directly until the owner buys the plan (D5) and sets `FORECAST_PROXY_ENABLED` ([owner checklist step C9](OWNER_CHECKLIST.md#at-pro-launch-blaze)).

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

Left for the owner: the Stripe test-mode run on the staging project, then the [Functions and Stripe](OWNER_CHECKLIST.md#functions-and-stripe) checks and switching billing on ([steps B4-C10](OWNER_CHECKLIST.md#at-pro-launch-blaze)).

### 10. Wave 3 phase 2: Pro-only morning alerts (W3-B) (built)

Built 2026-10-27 and switched off behind `ALERTS_ENABLED`; closes OPS-4, BE-19 and BE-11 in code.
The scheduled `alerts` Function (`functions/src/notifications/`) runs every 15 minutes for every time zone (D6), as the second of Cloud Scheduler's three free jobs, and sends each entitled Pro account (active, trialing or in the `past_due` grace period) one morning alert per local morning at its chosen hour, at most once per day, with per-run caps, a saved cursor, the owner's cost-guard pin, and removal of devices whose token FCM rejects.
Its own least-privilege identity is created by `infra/alerts-identity.sh` and named by `ALERTS_SERVICE_ACCOUNT`.
The emulator test (`functions/test/emulator/alerts.test.js`) simulates a day of runs across time zones: one alert per entitled account per local morning, none to Free, canceled, lapsed or deleting accounts.
The GitHub Actions notifier is retired.
Left for the owner: the real-device checks in the [owner checklist](OWNER_CHECKLIST.md#notifications), then switching alerts on (step C11).
The morning alert's text is built in `packages/core/src/alerts.ts` with the daily briefing's inputs, so it can switch to the briefing's text once that lands.

### 11. Wave 3 phase 2: operations (rest of W3-D, at Pro launch) (code built, #99, #107)

- **Built:** cost and abuse limits on every Function, the cost guard and the budget kill switch (#99); uptime checks and alert policies as code (`infra/monitoring.sh`, `infra/alerts/`), PITR, delete protection, daily backups and the image cleanup policy (`infra/backups.sh`), TTL policies (`infra/firestore-ttl.sh`), and [RUNBOOK.md](RUNBOOK.md) with alerts, rollback per component, restore steps and the secret rotation table (#107).
- **Left:** with the staging deploy built ([item 34](#34-staging-deploy-before-the-pro-launch-built)), the owner applies the scripts ([steps C2-C8](OWNER_CHECKLIST.md#at-pro-launch-blaze)), each alert is fired once in staging from a forced failure, and a restore drill is recorded in the runbook.
- **Closes:** OPS-15 (alerts and uptime) and OPS-17 in code; OPS-16 once the backups are on; OPS-12 with the staging project.

### 12. Wave 5: features

Each feature is its own lane that owns new files plus touch points agreed at kickoff.
Candidates, roughly ranked by impact over effort:

1. **Scheduled activities** - done (#55, #56); hidden in production until the Google OAuth client ID is set.
2. **Threshold UV alerts and a sunscreen reapply timer** - done: the reapply timer (#115) is free for every plan and runs in the browser; the UV alert (#112) is Pro, once a day when the forecast UV reaches the chosen level, outside quiet hours.
3. **Daily briefing card** - done (#108): "Today at a glance" on the dashboard (peak UV and time, the best lower-UV window for the plan, burn time at the peak, one line of advice), tomorrow's after dark, with a share.
   The words come from `dailyBriefing` in `packages/core/src/briefing.ts`, and the Pro morning alert (item 10, `morningAlertMessage`) sends the same text, titled with its best window.
   An AI-written version stays a future option: it needs an LLM API key, which must stay secret behind a Function, so Blaze, and a cost line in [COSTS.md](COSTS.md).
4. **Family profiles as a headline Pro feature** - done (#105): "Plan for a group" uses the most sensitive person among those ticked for plans and burn estimates, the switcher works on phones, Free sees an honest Pro offer (a waitlist while checkout is off), and the plan comparison names the mode.
5. **Cloud-aware forecasts with confidence** - done (#110): the forecast now also requests Open-Meteo's `uv_index_clear_sky`, and the dashboard and week view say when clouds lower UV ("Clouds may cut UV to 4.1 from a clear-sky 6.3") and how sure a day is (high for three days, fair for days 4-6, low from day 7) (`packages/core/src/forecast-quality.ts`).
   Every UV value is written with one decimal by `formatUV` in `packages/core/src/uv-scale.ts`, in the app, the alerts, the calendar feed and the city pages (2026-10-28), so the hour chips, the briefing and the cloud note quote the same number; bands and thresholds read the whole-number index.
   Clouds are counted once in plans (#114, decided 2026-10-27): `uv_index` already includes the forecast clouds, so an activity plans on the clear-sky UV unless "Account for cloud cover" is on, when it plans on `uv_index` as it is (the old extra cloud discount is gone).
   The app, the calendar feed and the briefing share `planningUV` in `packages/core/src/forecast-quality.ts`.
6. **Better skin typing** - done (#103): named Fitzpatrick types in setup, Settings and profiles, and an optional five-question quiz with the questionnaire's standard scoring.
7. **City landing pages** - done (#111): `/uv/<city>/` for 50 US and world cities and an index at `/uv/`, static HTML with no JavaScript, each with its typical UV by month, facts, a link that opens setup on the city, and its own title, description, canonical address and social cards; in the sitemap and linked from the landing page.
   The data is checked in (`lib/cities/`): daily UV and clear-sky UV for 2023-2025 from the CAMS global model via the Open-Meteo Air Quality API, averaged by month in local time by `scripts/city-climatology.mjs`, which is run by hand to add cities.
   Each city page carries structured data (JSON-LD: a WebPage about the city as a schema.org Place, and its breadcrumb trail) since 2026-10-28; `scripts/csp.mjs` hashes it into the page's policy at build time like every inline script.
   Later: a returning visitor's own plan wins over the city link (setup only).
8. **Shade and surface reflection factors** - done (#109): each activity can set its typical shade and the surface around it, which scale the UV it is planned against (cited, cautious factors in `packages/core/src/exposure.ts`), in the app and the calendar feed.
9. Linking with live events from Strava, Meetup and similar services, so Solara can plan around them (owner's idea) - scoped in [integrations/EVENTS.md](integrations/EVENTS.md); **phase 1 built**: .ics file import with the UV, burn time and sunscreen timing per event, for every signed-in account.
   **Phase 2 built and switched off** (item 19): linked calendars refreshed on the server and Pro heads-ups before high-UV events.
   **Phase 2b built and switched off** (item 20): events already in Google Calendar, read in the browser.
   **Built and switched off** (item 23): events from Outlook, read in the browser.
   **Built and switched off with linked calendars** (item 24): the "Add a calendar from..." helper.
   Next: Strava last (no future events in its API, a developer subscription and a 10-athlete cap); the Meetup, Eventbrite, Komoot and Garmin APIs are not needed.

### 13. Wave 6: mobile app (owner's learning project)

- **Approach:** Expo (React Native), chosen over a Capacitor wrapper so the app is truly native and the work teaches real mobile development.
- **Reuse:** all of `packages/core` (recommendation engine, forecast parsing, schemas); the UI is rebuilt natively.
- **Steps:** an Expo app in the repo using `packages/core`; Firebase sign-in on device with the same Firestore; native push for Pro alerts; TestFlight and a Google Play internal test track; a home-screen UV widget.
- **Crash reporting:** Sentry's React Native SDK in the same Sentry account as the web app; Firebase Crashlytics can be added later for deep native crash data.
- **Depends on:** an Apple Developer account ($99 per year) and a Google Play developer account ($25 once); native push needs item 10.
- **Android readiness:** the web-side groundwork is built ([item 38](#38-android-groundwork-in-the-web-repo-androidprep-built)); [integrations/ANDROID.md](integrations/ANDROID.md) has what the web app and backend need first: Pro stays bought on the web and the app is consumption only (default, owner may change, 2026-10-28), native OAuth clients, Play Integrity for App Check, Android push payloads, assetlinks.json, a Trusted Web Activity as the first Play listing, and the 12-testers-for-14-days rule.
- **Size:** L.

### 14. Cost and abuse fixes from the third review (FIX3A, built, #118-#121)

The third security review (2026-10-27) found that a request flood could still run up the Blaze bill and that an attacker could pause Pro for everyone; this item fixes its cost and abuse findings H1, H2, M1, M2, M3, M6, L1, L2 and L3 (the other findings are lane FIX3B's).
The owner's requirement: nobody can abuse the Blaze setup or run up costs, and it is not easy to break.

- **Cheap rejections and client addresses (H1, M2, M6):** a rejected request is turned away before any Firestore read or upstream call and logged once a minute instead of once per request; the HTTP instance caps are launch-sized (15 in all, down from 37); `infra/logging.sh` drops 99% of rejected-request logs; IPv6 clients are limited per /64; a runtime self-check and `infra/check-client-address.sh` catch a wrong `TRUSTED_PROXY_HOPS` ([DEPLOYMENT.md](DEPLOYMENT.md#cost-and-abuse-limits), [COSTS.md](COSTS.md#worst-case-under-a-flood)).
- **A real hard stop that cannot be turned against paying users (H1, H2, L1, L2):** a $25 budget with three tiers (warn at 50%, cost guard at 100%, detach billing at 300%, on by default); a budget-engaged guard ends by itself at the next budget period and the owner releases it with `infra/cost-guard.sh released --apply`; the scheduled Pro alerts are never paused by the budget; `budgetAlert` acts only on `BUDGET_ID` and runs as its own `solara-budget` identity, the only one allowed to detach billing ([RUNBOOK.md](RUNBOOK.md#budget-kill-switch)).
- **Paid forecast calls bounded (M1, M3, L1, L3):** a global upstream budget (1,500 an hour, 20,000 a day) shared by the proxy and the calendar feed, failing closed to the cached forecast; a 0.02 degree cache grid chosen from measured UV differences; the calendar feed reads the shared cache with 4 upstream calls per feed an hour; fallbacks are remembered and logged once a minute; setup's current UV and the place search go through the proxy (a new `placeSearch` Function on the commercial geocoding host) once it is on, and the feed never uses the free API once billing is on ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)).

### 15. Trial, alert and export fixes from the third review (FIX3B, done, #122-#124)

The third review's findings M4, M5, L4 and L5, all in switched-off Pro features:

- **The free trial once per person (M4):** a keyed-hash trial history that survives account deletion keeps the trial from being taken again by a recreated account, the same verified email, or the same card on another account (#124, [DEPLOYMENT.md](DEPLOYMENT.md#trial-history)); the owner creates the `TRIAL_HISTORY_KEY` secret ([owner checklist](OWNER_CHECKLIST.md#at-pro-launch-blaze), step 14).
- **One planning skin type everywhere (M5) and validated server reads (L4):** the morning alert plans for a group's most sensitive person like the dashboard, and the alerts and the calendar feed read activities and profiles through the app's schemas (#122).
- **The alert history in the export (L5):** #123.

### 16. Fair forecast budget from the fourth review (FIX4A, done)

The fourth security review (2026-10-28, `handoff/review4.md`) found that the global upstream budget from item 14 was first come, first served: one caller with one App Check token could spend the hour's forecast calls, and place search shared the same pool (H1); an IPv6 /48 gave an attacker 65,536 per-address budgets, and the limiter evicted live windows under pressure (M1); and the feed's free-API forecasts could reach the proxy through the shared cache (L7).

- **Fair shares (H1):** each caller (an IPv4 address, or an IPv6 /64 with its /48 at 4 times as much) may cause 20 upstream calls an hour per budget, counted across instances; place search has its own budget (200 an hour, 2,000 a day); while a budget or share is spent, the last good forecast up to 12 hours old is served and flagged `stale` instead of a 503 ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)).
- **Per-address limits per site (M1):** every IPv6 request also counts against its /48 at 4 times the limit, and the limiter never forgets a live window ([DEPLOYMENT.md](DEPLOYMENT.md#cost-and-abuse-limits)).
- **No free-API forecasts in the paid cache (L7):** the free API's forecasts stay in the feed instance's memory, and cached entries record their source.
- **The `stale` flag in the app:** the app parses `stale` and `fetchedAt` (`ServedForecastSchema` in `packages/core`), keeps the copy's real age in the forecast and the browser cache, never replaces a newer forecast with an earlier copy, and says on the dashboard when the forecast was updated (`components/ForecastNotice.tsx`, one note with the offline notice).
- **Not done, for later if real traffic needs it:** reserved shares for signed-in or returning users, serving the nearest cached cell, limited-use App Check tokens for cache misses, and a /32 tier.

### 17. Imported events hardening from the fourth review (FIX4B, built)

The fourth review's event findings M2, M3, the rules part of M4, L1, L2 and L3 ([integrations/EVENTS.md](integrations/EVENTS.md#phase-1-as-built)):

- **No file can freeze the app (M2):** one work allowance per file bounds the parser (a full 1 MB hostile file now parses in under half a second, against minutes to hours before), and the app parses in a Web Worker stopped after 20 seconds.
- **The soonest events always show (M3):** the list reads the 200 soonest-ending upcoming events, and "Remove all" removes every stored event.
- **Per-account caps (M4, rules part):** at most 1,000 imported events and 500 scheduled activities, enforced by `firestore.rules` through a key list per collection; imported events expire within 31 days of their end.
  The export paging is item 18's.
- **Re-imports, text and lookups (L1-L3):** a re-import removes events the calendar cancels and occurrences it no longer produces; bidi controls are removed from event text; place lookups stop at 10 per import.

### 18. Export, wording and UI fixes from the fourth review (FIX4C, built)

The fourth security review's findings M4 (the export part), L4, L5 and L6, and its UI leftovers (`handoff/review4.md`):

- **A bounded export (M4):** the account export reads every collection in pages of 200 documents inside one read-only transaction and stops at 5,000 documents per collection, naming any section cut short in `truncated` ([DEPLOYMENT.md](DEPLOYMENT.md#account-export-and-deletion)); an emulator test exports 1,250 events and 230 scheduled activities in pages and checks that deletion removes imported events.
  The per-account caps on what clients can write (1,000 events, 500 scheduled activities) are item 17's.
- **Account page wording (L4):** the export and deletion text name every section, imported events and the calendar feed included, from one list a test compares with the real export.
- **One way to write UV (L5):** every UV value has one decimal through `formatUV` in `packages/core/src/uv-scale.ts`, so the 1pm chip reads 10.3 like the briefing, in the app, the alerts, the calendar feed and the city pages.
- **Replaying Stripe webhooks after a detach (L6):** the [runbook](RUNBOOK.md#budget-kill-switch) has the steps to finish within 3 days of a billing detach, and the [owner checklist](OWNER_CHECKLIST.md#at-pro-launch-blaze) step 12 states what a detach at 300% stops; detaching stays on by default.
- **UI:** the briefing gives the clear-sky peak when clouds lower it ("UV peaks at 6.2 (High) around 1pm, or 10.8 if the sky clears", also in the morning alert) and the UV card no longer repeats that note; the briefing names the "lowest-UV window" while the hero names the next slot, so the two never contradict each other; at night "UV returns about 7am" is said once; after sunset the hour strip opens where UV returns even while the last hour is on it; the analytics consent banner sits at the top of the page flow and covers nothing at any width; the landing and city pages follow an OS theme change while open; city pages carry JSON-LD, hashed into their CSP at build time.

### 19. Linked calendars and Pro event heads-ups (Wave 5 item 9, phase 2, built and switched off)

Built 2026-10-28 by lane EVENTS2 and switched off behind `EVENTS_SUBSCRIPTIONS_ENABLED` (with `ENABLE_BLAZE_FUNCTIONS`; heads-ups also need `ALERTS_ENABLED`), as scoped in [integrations/EVENTS.md](integrations/EVENTS.md#phase-2-as-built).

- **Linked calendars:** a signed-in account links up to 5 https or webcal addresses in the Events section (loaded only when switched on); the `eventSubscriptions` Function fetches each and the `eventSubscriptionsRefresh` job (the third free Cloud Scheduler job) refreshes it every 6 hours, replacing its upcoming events and keeping the place and activity the person set.
- **Security:** https on port 443 only, public addresses only, checked after DNS resolution and on every redirect (at most 3) with the connection pinned to the checked address; 10 seconds, 1 MB after decompression, calendar content only; the address is a credential, kept in the server-only `eventSubscriptions/{id}` and never sent back to the app; the rules refuse client-created linked events and let the app change only their place and activity.
- **Cost:** per-account cap, per-account and per-address limits, the cost guard on the endpoint and the job, backoff and a pause after 7 days of failures; the Function keeps the per-account key list (1,000 events) itself; place lookups have their own budget and event forecasts come out of the forecasts' budget, each through the account's share ([COSTS.md](COSTS.md)); item 21 hardened it after the fifth review.
- **Heads-ups:** the `alerts` job sends Pro a push about 3 hours before an imported or linked event with UV 6 or higher, outside quiet hours, once per event; Settings has an "Event heads-up" switch.
- **Removal and accounts:** removing a link deletes its events and their keys; account deletion removes the account's links; the export lists linked calendars without their addresses and the heads-ups sent.
- **Tests:** unit tests for the URL rules, backoff, heads-up timing and wording, and the fetcher's SSRF, redirect, size, time and content checks; emulator tests for adding, refreshing, backoff and pause, the caps, removal, the rules, and a day of heads-ups; harness screens at 390 and 1440 px, light and dark.
- **Left for the owner:** the [Linked calendars](OWNER_CHECKLIST.md#linked-calendars) checks in staging, then `EVENTS_SUBSCRIPTIONS_ENABLED` ([group D](OWNER_CHECKLIST.md#per-feature-switch)).
- **Not done:** Strava (phase 3); reverse lookups of unnamed `GEO` points on the server; showing which linked calendar an event came from by name.

### 20. Events already in Google Calendar (Wave 5 item 9, phase 2b, built and switched off)

Built 2026-10-28 by lane GCAL, as scoped in [integrations/EVENTS.md](integrations/EVENTS.md#phase-2b-as-built); hidden until the build has the Google OAuth client ID (the switch that also shows Scheduled) and `GOOGLE_CALENDAR_EVENTS_ENABLED`.

- **What:** "Show my Google Calendar events" in the Events section reads the next 30 days of the chosen calendars (the main one by default, up to 10) in the browser with `calendar.events.readonly`, and keeps timed events with a place or a matching activity, with the same UV card, marked "From Google Calendar"; "Choose calendars" asks for `calendar.calendarlist.readonly`.
- **Privacy:** only title, time, zone, location text, place and activity are stored (`source: 'google'` in `users/{uid}/events`); no description, guests, links or tokens; video-call locations are dropped; the chosen calendars live in `users/{uid}/meta/googleCalendar` (the main one as `primary`), in the export as `googleCalendar` and deleted with the account; the privacy policy describes it.
- **Refresh and cap:** client only (no refresh tokens): every 30 minutes while the session holds a token, else on Refresh; at most 200 events a refresh within the 1,000-event key list; gone events removed, unchanged ones not rewritten; duplicates of file or linked events skipped.
- **Disconnect:** removes the events and the connection and revokes the grant with GIS (which ends Scheduled's access too, as the confirmation says; `oauth2.googleapis.com` added to `connect-src`).
- **Also (REVIEW5 L2 client part and UI items 4 and 5):** "Remove all" is now "Remove imported events" and keeps linked and Google Calendar events, which their next refresh would bring back; the empty "Link calendar" and "Save" buttons are outline buttons while disabled.
- **Tests:** unit tests for parsing, filtering, de-duplication, the refresh and the read calls; static and emulator rules tests for `google` events and the connection document; a signed-in browser test against the fake Calendar with the real rules; UI harness screens at 390 and 1440/1280 px, light and dark, with a fake Google.
- **Left for the owner:** the [Events from Google Calendar](OWNER_CHECKLIST.md#events-from-google-calendar) steps: after the Scheduled verification and REVIEW5 M3's outdoor-only heads-ups (FIX5B), add the two scopes, verify them with a demo video, then set `GOOGLE_CALENDAR_EVENTS_ENABLED`.

### 21. Linked calendar hardening from the fifth review (FIX5A, built)

The fifth security review's findings H1, M1, M2, M4, L3 and the server part of L2 (`handoff/review5.md`), all in linked calendars, which stay switched off:

- **A hostile link cannot crash or wedge anything (H1):** response bodies are read through one stream pipeline (`readBoundedBody`), so a corrupt gzip, a decompression bomb or a dropped connection fails only that fetch, never with an unhandled rejection; one deadline (`withDeadline`) bounds the whole fetch, decompression included; each attempt claims its link before fetching (`functions/src/events/lease.ts`), so a hanging or crashing link waits for its retry time instead of holding the queue, and counts as a failure at the next attempt; the run gives each link 90 seconds. The review's hostile sites are replayed over real TLS in `functions/test/safe-fetch.test.js`.
- **Own place lookup budget (M1):** 50 an hour and 300 a day, 10 an hour per account, separate from place search's; each text is looked up once per link.
- **Refreshes write only what changed (M2):** the link's events are read once inside the write transaction and unchanged ones are not written; the same answer as last time is parsed again only once a day; the key-list check runs at most once a day per link; [COSTS.md](COSTS.md) has the corrected numbers.
- **A refresh job that scales (M4):** every due link, oldest first, read a page at a time, 16 at a time, up to 3,000 a run, with an ERROR (an owner email) when a link waits 6 hours past its time.
- **Removal and deleted accounts (L2 server part, L3):** a link is marked `removing`, then its events and keys go, then the link and its summary entry, and the run finishes a removal that stopped halfway; nothing is written under a deleted account.
- **"Remove imported events" (L2):** the app's button (item 20) keeps linked events; if they are ever deleted anyway, the server notices the missing events and writes them back at the link's next refresh (emulator test).
- **Left:** refreshing only accounts active in the last 30 days, if the link count ever needs it.

### 22. Heads-ups, limiter, forecast shares and copy from the fifth review (FIX5B, built)

The fifth security review's findings M3, M5, L1, L4, L5, L6 and L7, and its UI items 2, 3 and 7 (`handoff/review5.md`):

- **Heads-ups only for outdoor events (M3):** an event gets a heads-up only when it counts as one of the person's (outdoor) activities (`countsAsOutdoorActivity` in `packages/core/src/event-heads-up.ts`, for files, linked calendars and Google Calendar alike); the same title starting within 30 minutes counts once across sources and keys; an account gets at most one every 3 hours, naming the soonest high-UV event and counting the others it covers; and a run reads every event whose heads-up can be due instead of the 5 soonest.
- **Publisher text in pushes (L4):** the push's title is Solara's own; the body quotes the event's name, cleaned of links, domains, e-mail addresses, phone numbers and invisible formatting, and cut to 40 characters.
- **A limiter that keeps serving newcomers (M5):** when its 10,000 exact windows are all live, new keys are counted in a fixed-size count-min sketch, which never under-counts, so throttled clients get no fresh budget and newcomers are still served.
- **Forecast shares by network, and a reserve (L1):** an IPv4 caller also counts against its /24 at 4 shares, and the browser's forecasts may spend only two thirds of the global budget, so a flood from many networks cannot stop the calendar feed or Pro heads-ups ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)).
- **Copy and UI (L5, L6, UI items):** UV thresholds are named by band ("moderate or higher") wherever a decimal is shown, and the city table explains the WHO rounding once; briefing time ranges no longer break on phones; the consent bar is about 80 px tall on phones; alerts have their own Settings tab (Appearance is now Display, so six tabs fit a 320 px phone); the heads-up and quiet-hours hints say what heads-ups do; the Events section names every switched-on source.
- **Harness (L7):** the fixture's live reading follows the clock, so evening and night screens show that time's UV.
- **Not done, for later if real traffic needs it:** serving the nearest cached cell before a 503, and limited-use App Check tokens for cache misses.

### 23. Events already in Outlook (built and switched off)

Built 2026-10-28 by lane OUTLOOK, as designed in [integrations/OUTLOOK.md](integrations/OUTLOOK.md#as-built); hidden until the build has the Azure app's client ID (`MICROSOFT_CLIENT_ID`) and `OUTLOOK_CALENDAR_EVENTS_ENABLED`.

- **What:** "Show my Outlook events" in the Events section signs in to Microsoft in a popup and reads the next 30 days of up to 10 own calendars (the default one first) from Microsoft Graph in the browser, and keeps timed events with an address, a place picked in Outlook or a matching activity, with the same UV card, marked "From Outlook"; "Choose calendars" uses the same permission.
- **Sign-in:** a hand-rolled authorization code flow with PKCE (`lib/microsoft-auth.ts`, loaded only with the Outlook panel) for `Calendars.ReadBasic` only, against the `common` authority; no `offline_access`, so no refresh token, and the access token stays in memory; the static `/auth/microsoft/` page hands the code back over a BroadcastChannel without the framework, analytics or the service worker.
- **Privacy:** only title, time, zone, location text, place and activity are stored (`source: 'outlook'`); no body, attendees, organizer, meeting links, office rooms or homes; the chosen calendars live in `users/{uid}/meta/outlookCalendar` (the default one as `default`), checked by the rules like Google's (REVIEW6 L4), in the export as `outlookCalendar` and deleted with the account; the privacy policy has a Microsoft user data section.
- **Shared with Google Calendar events:** the refresh, duplicate, cap and place code now lives in `lib/calendar-events.ts`, so both connections follow the same rules (REVIEW6 M2, L4, L5); heads-ups follow `eventHeadsUpsEnabled()` with the new Outlook switch.
- **Tests:** unit tests for PKCE (RFC 7636's example), the popup flow and its errors, the redirect page, Graph mapping (UTC times, Windows zones, all-day, cancelled, declined, recurring, places, meeting and private locations), paging, throttling and the refresh; static and emulator rules tests; a signed-in browser test with the real popup and redirect page against a fake Microsoft sign-in and Graph and the real rules; UI harness screens at 390, 1280 and 1440 px, light and dark.
- **Left for the owner:** the [Events from Outlook](OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection) steps: the free Azure app registration, `MICROSOFT_CLIENT_ID`, a live check with a real account (it settles the design's open questions), one sign-in with production's headers, the cache cleared and the network throttled (item 29), then `OUTLOOK_CALENDAR_EVENTS_ENABLED`.

### 24. "Add a calendar from..." helper (built and switched off)

Built by lane LINKGUIDE as specified in [integrations/CALENDAR_LINKS.md](integrations/CALENDAR_LINKS.md#as-built), and switched off with linked calendars (`EVENTS_SUBSCRIPTIONS_ENABLED`).

- **Goal:** make linked calendars (item 19) easy to use: step-by-step instructions for getting a calendar link from Apple iCloud (public calendar), Google (secret address in iCal format), Outlook.com (published ICS link) and Yahoo (shareable ICS link), on a computer and on a phone where they differ.
- **Built:** "Add a calendar from..." under "Linked calendars" opens, on demand, a panel with the four providers, one short sentence per step (iCloud on a computer and on iPhone or iPad), each provider's reset or stop-sharing note, and the shared notes (the link is a key, changes take a few hours); `recogniseCalendarLink` in `@solara/core` names the provider of a pasted link and catches the common mistakes before anything is sent, and a card whose calendar sends no name shows the provider's name.
- **Tests:** unit tests for every recognition rule and hostile input, a copy test, harness screens for each provider at 390 and 1440 px (and 320 and 1280 px) in light and dark with 0 axe violations, and a signed-in test that adds a recognised Google link through the real Function.
- **Still open:** the steps marked unconfirmed in the document could not be checked in real accounts, so Yahoo ships with one sentence instead of numbered steps; the owner (or a later lane with test accounts) should confirm the open questions there.
- **Depends on:** item 19's linked calendars; it ships switched off with them (`EVENTS_SUBSCRIPTIONS_ENABLED`).

### 25. Heads-up fairness from the sixth review (FIX6A, built)

The sixth review's findings M1, L2 and the server side of L1 (`handoff/review6.md`):

- **Fair event forecast lookups (M1):** an account's heads-up looks up at most 10 event places per alerts run, its soonest events first; the walk over the accounts only gathers their events, and the run then hands its 200 lookups out one per account per round (the account whose next event starts soonest first, places already looked up free), so a few accounts with many events at new places cannot starve everyone else's heads-ups (`planHeadsUpLookups` in `functions/src/notifications/alerts.ts`; the review's probe is an emulator test).
- **No event silently dropped (L2):** a push also covers and counts ("1 more") every later high-UV outdoor event that could not get a heads-up of its own once the 3-hour gap ends, such as a 10K at 12:15 behind a 1K at noon, or a 7am start due only the evening before (`eventHeadsUpLaterPossible` in `packages/core/src/event-heads-up.ts`).
- **Heads-ups with either events switch (L1, server side):** the `alerts` job sends heads-ups when linked calendars (`EVENTS_SUBSCRIPTIONS_ENABLED`) or events from Google Calendar (`GOOGLE_CALENDAR_EVENTS_ENABLED`, now also written to the Functions params by the deploy) are on; the Settings switch and copy are lane FIX6B's; Outlook events (item 23) added their switch, `OUTLOOK_CALENDAR_EVENTS_ENABLED`, to `eventHeadsUpsEnabled` in `functions/src/notifications/config.ts`.
- **Not done:** remembering for an hour that an event's forecast was missing or low (review M1 suggestion 3); with 10 lookups per account, cached forecasts and the per-account upstream share, repeating them every 15 minutes costs a few cache reads.

### 26. Forecast budget sides, the sun's phase and docs from the sixth review (FIX6C, built)

The sixth review's findings L3, L6 and L7 item 1 (`handoff/review6.md`):

- **Neither side of the forecast budget can starve the other (L3):** the browser's forecasts and the server's own work (the calendar feed and event heads-ups) may each spend at most two thirds of the hourly and daily budget, counted on their own counters in the same lease transaction as the shared ones (`side` in `functions/src/forecast/upstream-budget.ts`).
  Before, the browser was held to two thirds but the server could spend all 1,500.
  Unit tests drive both directions through the deployed request pipeline, and an emulator test races instances of both sides.
  Linked calendars' place lookups were already a budget of their own.
- **The sun's phase from the sun (L7 item 1):** the live hero said "Before sunrise ... UV returns about 9am" at 8:05am in Los Angeles, an hour after sunrise, because the phase came from the UV (under 0.5 before the day's first hour of 0.5), not from the sun; evenings had the same flaw ("Sun is down" before sunset).
  Sunrise and sunset now come from NOAA's equations for the place's own date and zone (`packages/core/src/sun-times.ts`, moved from `lib/` in item 28), in the dashboard and in setup's UV preview.
  Harness screens (`tests/harness/sun-phase.spec.ts`) cover dawn, morning, evening and night in Los Angeles and Sydney.
- **Docs drift (L6):** the status table through #136, [COSTS.md](COSTS.md) (the two sides, the IPv4 /24 tier, linked calendars' place lookups in the worst case), [DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy) and the [runbook](RUNBOOK.md) (a side's exhausted budget, and why the place lookup ERROR can email a dozen times in a busy hour).

### 27. Google Calendar events and Settings from the sixth review (FIX6B, built)

The sixth review's findings M2, L4, L5, the app's copy for L1, and UI items 2-5 of L7 (`handoff/review6.md`), all in features that stay switched off:

- **Only towns of addresses are searched (M2):** a Google event's location goes to the place search only when it is written as an address (two or more parts with a state or province code, a postal code or a country, no person, room, office or meeting words), and then only its town (`googleLocationQueries` in `lib/google-events.ts`); dial-in numbers and passcodes are dropped like meeting links; other events are kept only when they match an activity, at the person's place, which they can set by hand.
  The privacy policy names what goes where for every event source: Open-Meteo's place search for files, linked calendars and Google Calendar, the forecasts at event places, the heads-up push through Firebase Cloud Messaging, and the proxy.
- **A disconnect wins (L4):** the rules accept Google events only while `users/{uid}/meta/googleCalendar` exists; a disconnect deletes it before the events; a refresh checks it (and its calendars) on the server before writing and records `syncedAt` with an update that never recreates it; a device that finds Google events without a connection removes them.
- **Every stored event counts (L5):** a refresh compares Google events with every stored event that has not ended, and the panel counts with an aggregate query (new `events` index on `source`, `end`) when the section holds only the soonest 200.
- **One heads-up rule (L1, app copy):** Settings' switch and the Events section's note use one sentence from the shared constants (outdoor events with an activity set, UV 6 or higher, from a file, a linked calendar or Google Calendar, at most one every 3 hours), shown when either outside source is on.
- **UI (L7 items 2-5):** the Free Alerts tab has the "See Pro plans" button; the Google panel's Disconnect is a quiet text button beside the calendar's name in a narrow card; the first Settings tab reads "Sun" on phones (still named "Sun profile"); the UI harness opens any Settings tab by URL.

### 28. Dashboard hero, daylight slots and UV wording (HERO, built)

What lane FIX6C found on the dashboard and left for later, through a day in Los Angeles in late October (sunrise 7:09am, sunset 6:04pm):

- **The hero at phone widths:** at 390 px the "Next lower-UV slot" time wrapped onto two lines ("8:05am–" / "8:50am") and its detail line was cut to "Running · Morning · Peak U...", because the "Start now" badge took the room.
  The badge now sits on the label's row, the time stays on one line, and the detail line wraps after a dot instead of cutting anything off, from 320 px; the desktop card keeps its shape.
- **"None" is not a UV category:** an index of 0 read "0.2 None now" in the UV card, the header chip, the hour strip's spoken labels and setup's preview, against the app's own scale legend ("Low (0–2)").
  `uvLabel` now names it "Low", the WHO's name for 0-2, everywhere it is used (the briefing and city pages included); the gray "none" shade of the band stays.
- **No slot in the dark:** before sunrise the hero offered a run at 6:40am and the briefing "Running 6:40am–11am", because UV 0 counted as the lowest of the day; evenings offered "3pm–8pm" past a 6:04pm sunset.
  Every window is now cut to the day's daylight, from the first 5-minute step after sunrise to the last before sunset (`daylightHours` in `packages/core/src/sun-times.ts`, moved from `lib/`, used by `findWindows`): the hero, the activity cards, "Best day this week", the week calendar, the briefing, the morning alert and the calendar feed alike.
  An activity whose preferred hours are all in the dark gets no slot, and the hero says so ("No daylight in your hours").
  "% of daylight hours fit" now counts only hours with the sun up.
- **One notion of "today is over":** at 5:20pm the briefing had turned to "Tomorrow at a glance" (no UV left) while the hero still offered a run this evening.
  Both now go by the place's sunset (`todayOver` in `packages/core/src/day-view.ts`): until sunset the briefing covers today and the hero stays, and both say no slot is left when the daylight is too short for the activity.
- **Tests:** unit tests for the daylight bounds, the briefing day, the plans, the alert and the feed; harness screens (`tests/harness/dashboard-hero.spec.ts`) at dawn, morning, evening and night at 320, 390 and 1280-1440 px, light and dark.

### 29. Outlook sign-in fixes from the seventh review (FIX7A, built)

The seventh review's findings M1, L1, L2, L3, L4 and L6 (`handoff/review7.md`), in features that stay switched off:

- **The sign-in no longer fails silently on a slow network (M1):** Solara's own `Cross-Origin-Opener-Policy` severs the app's handle on the popup the moment the redirect page arrives, so the popup reads as closed before the page has handed the code back; the hand-over script waited for two stylesheets, and when they took over 1.5 seconds the person signed in and nothing happened.
  The script is now the first thing in the redirect page's `<head>`, before any stylesheet or font (`data-head-first`, moved by `scripts/static-pages.mjs`, which fails the build if the page has none), and the app waits 5 seconds after `closed` before it treats the popup as closed by the person.
  The signed-in suite's test server now sends firebase.json's headers, and a new browser test (`tests/e2e/microsoft-sign-in.spec.ts`) runs the real sign-in code and redirect page on the Hosting emulator with 4-second stylesheets in Chromium, Firefox and WebKit; it failed in all three before the fix.
- **A sign-in cannot outlive a sign-out (L1):** forgetting the token also ends any sign-in still open, closing its popup, and a token redeemed after that is dropped.
- **Wording that is exactly true (L2, L3):** a refresh whose events are all already in Solara says so instead of "No events ... have an address"; the privacy policy says the Microsoft account is never stored (the browser reads calendar owners in memory), names "rooms and homes that Outlook marks as such", says Solara keeps no refresh token and holds the access for up to an hour (now capped at an hour in code); the panel says Solara "stored no" token; [OUTLOOK.md](integrations/OUTLOOK.md) has the real disconnect order and prompt behaviour.
- **Refresh reuses the Microsoft account (L3):** only "Show my Outlook events" shows Microsoft's account picker ("Outlook account picker" below).
- **Retry-After (L4):** a 429 without a usable `Retry-After` waits 5 seconds (at least 1, at most 30; seconds or an HTTP date).
- **The redirect page's own policy and Web Crypto (L6):** `/auth/microsoft/` has a Content-Security-Policy of its own with only its inline scripts' hashes, its own styles, font and icon, `connect-src 'none'` and no third-party origin; a page without `crypto.subtle` (a development server on a LAN address over http) says the sign-in needs a secure connection before any popup opens.
- **Left for the owner:** [step 10 of Events from Outlook](OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection), one sign-in with production's headers, the cache cleared and the network throttled, before `OUTLOOK_CALENDAR_EVENTS_ENABLED`.

### 30. Link helper, refresh note, UV card and sun times from the seventh review (FIX7B, built)

The seventh review's findings L5 and L7 (`handoff/review7.md`):

- **The helper blocks only what cannot be a calendar (L5):** a provider's web page, an HTML link or an embed link is still held back with its reason; any other link on a provider's host goes to the server with a warning ("This is not the usual Yahoo Calendar link. If linking fails, ..."), so Outlook's `/OWA/calendar/` in capitals and Yahoo hosts other than `calendar.yahoo.com` work again; hosts are compared exactly after lowercasing, and no part of a link is echoed or logged (`packages/core/src/calendar-providers.ts`).
  After "Link calendar" on a refused link the reason shows once, as the status, instead of also under the field.
- **The UV card at 320 px (L7.1):** the line under "Sun is down" ("UV returns about 9am tomorrow · 66°F · Clear") and under the reading wrap after a dot instead of cutting the weather off.
- **One refresh note (L7.2):** "Events update while Solara is open ..." shows once, below the Google Calendar and Outlook panels, instead of under each; both panels' own copies are gone.
- **The reading and the current hour's chip agree (L7.3):** at 5:20pm the reading said "0.1 Low now" beside a ringed 5pm chip reading 0.3, because the reading is the provider's live value at the clock's instant and the chip the forecast for the top of the hour (same rounding, different moments); the current hour's chip now shows the live reading as "Now", and pressing it keeps that reading.
- **The date line (L7.4):** `sunTimes` normalises the longitude to (-180, 180] first, so -180 gives the same sun as 180 instead of nothing.
- **Tests:** unit tests for every new recognition rule, the readout and the date line; `tests/harness/review7-helper-hero.spec.ts` at 320, 390 and 1280-1440 px, light and dark.

### 31. Dashboard polish at 320 px (POLISH, built)

Two UI findings left by the reviews, and what a pass over the whole dashboard at 320 px in both themes found:

- **The place name in the header (320 px):** the header cut the place to "San Luis ..." and even "Los Ange...".
  The name now wraps to a second line inside the header row when it needs one (two lines at most, then an ellipsis), and under 360 px the header shows the Solara mark without its wordmark (still the home button's name), so "San Luis Obispo, California" reads in full beside the Sign in button or the profile switcher and account menu, with no sideways scroll.
- **Burn time and vitamin D with too little UV:** while the sun was up but UV was under 0.5 (5:20pm in Los Angeles in late October), both cards read "None" in the 23 px type of a number.
  They now say "No burn risk" and "UV too low" in 15 px words on the number's line, so a card with words stays the height of one with minutes, with "Until 9am tomorrow" below; a screen reader hears "21 minutes" instead of "21m".
- **Also at 320 px:** the day chips (Today, Tomorrow, More days) share one row with the refresh button instead of dropping "More days" to a row of its own, and "Best day this week" breaks after the dot instead of inside a time range ("6pm–" / "6:45pm").
- **Tests:** `tests/harness/dashboard-polish.spec.ts` at 320, 390 and 1280 px, light and dark, for a long, a medium and a short place name on the guest and Pro headers, the low-UV cards, a burn time beside "UV too low", the day chips and the best-day rows.

### 32. Privacy promises, free-stage runbook and costs from the eighth review (FIX8A, built)

The eighth review's findings SEC M1, M2, M3 and L7, QA H1, H2, M1 (runbook part), M2, M6 (the Outlook switch), L7 and L9, and PLAN L4 and L8 (`handoff/review8-sec.md`, `handoff/review8-qa.md` and `handoff/review8-plan.md`):

- **Retention the policy can keep (SEC M3, QA M2):** an account's events (every source) and scheduled activities that ended more than 30 days ago are deleted on each signed-in visit, from `components/App.tsx` through `lib/retention.ts`, whatever shows (before, events were pruned only when the Events section rendered, so never when the forecast failed, and scheduled activities only with Google Calendar set up).
  The policy's switch-dependent lines come from `lib/privacy-retention.ts`: without TTL they promise deletion on the next signed-in visit; with `PRODUCTION_DATA_STEPS.firestoreTtl` set after `infra/firestore-ttl.sh --apply`, they add that Firestore deletes them even if the person never comes back.
- **Other policy lines (SEC L7, PLAN L4):** reCAPTCHA follows the forecast proxy switch (guests too once it is on); the Pro waitlist email is named, with its purpose and how to leave it; backups are named only once `PRODUCTION_DATA_STEPS.backups` is set, and until then the policy says there are none.
- **Plan lists (QA L7):** "Calendar sync" shows only in a build with Google Calendar or the live feed; otherwise the landing page, plans dialog and Settings say "Calendar export", which is what Free has today (.ics export and "Add to Calendar").
- **Runbook (QA H2, M1, M6):** a "Free stage (Spark)" section: where to look, Hosting and rules rollback, and an emailed export or deletion request step by step, with `infra/account-request.mjs` (export reads `users/{uid}` and every subcollection plus the per-account top-level records; delete lists first and needs `--apply`); the heads-up rollback row and the "Heads-up switch" decision name `OUTLOOK_CALENDAR_EVENTS_ENABLED`.
- **Monitoring on Spark (QA H2.2):** `infra/monitoring.sh --site-only` creates only the uptime check on `https://solara-uv.web.app/app/` and its email alert; `--functions-only` adds the rest at the Pro launch.
  `npm run lint:sh` runs shellcheck on `infra/*.sh` and `.github/scripts/*.sh`, and CI runs it with the lint (QA L9).
- **Costs (QA H1, SEC M1, M2, PLAN L8):** COSTS.md says that on Spark the quotas are where the site stops; "Worst case under a flood" covers a Hosting download loop and a Firestore write loop with their mitigations; a Stripe fees row and a corrected break-even (about 12 monthly subscribers for the $29 forecast plan, not 10).
- **Tests:** `lib/privacy-policy.test.ts` checks every switch-dependent line in both states and that the page renders them; `lib/retention.test.ts`; `tests/e2e/signed-in/events-limits.e2e.ts` deletes ended events on a visit whose forecast fails (it failed before the fix).

### 33. Account download and deletion without Functions (FIX8B, built)

The eighth review's SEC M4, QA M1 and PLAN M4 (`handoff/review8-sec.md`, `handoff/review8-qa.md`, `handoff/review8-plan.md`): on the free Spark plan the Functions are not deployed, so the account page disabled "Download account data" and "Delete permanently" and said "Account controls will become available after the Cloud Functions and App Check are configured."
Signed-in people could not export or delete their data, and Google Play will require a working web deletion link.

- **Download in the browser:** without Functions the page reads every document of `users/{uid}` the rules let the owner read (the account, imported events, scheduled activities, the Google and Outlook connections, the linked calendars' summary, notification devices) and downloads the same file as `exportAccountData`; both build it with `@solara/core/account-export`, checked against the Function's response contract.
- **Delete in the browser:** after "Type DELETE" and a fresh Google sign-in (`reauthenticateWithPopup`), `lib/account-self-service.ts` deletes the imported events and scheduled activities with their keys taken off the key lists in the same batches, then in one batch the emptied key lists, the Google and Outlook connections and the account document, reads everything back (running again if another tab saved meanwhile), and only then deletes the Auth user (`deleteUser`) and clears the browser (account data, guest plan, notification registration and delivery cache, every `solara_` entry but the theme and install choice).
  A failure says what happened in plain words: nothing deleted, some data deleted (retry picks up where it stopped), or data deleted but the sign-in left.
- **Rules (with emulator tests for every delete):** the owner may delete the account document while it holds no billing (no paid plan, no `stripeCustomerId`), and a key list once it names no key, which keeps the caps intact.
  Server-only records stay server-only: an account with notification devices, a calendar feed or linked calendars (none of which the Spark plan writes), or with billing, is told before anything is deleted to email contact@n8builds.dev.
- **The Functions stay the path when deployed** (`ENABLE_BLAZE_FUNCTIONS`), since they also reach server-only data and end billing.
- **Words:** the developer notice is gone; the page offers "Something not working? Email contact@n8builds.dev ..." as the way out, and the privacy policy's "Your rights" says the page downloads and deletes right away, with email as the fallback within 30 days.
- **Tests:** unit tests for the export builder, the browser deletion (blocked, retried, partial failure, sign-in failure) and the browser clean-up; `functions/test/emulator/firestore.rules.test.js` ("self-service account deletion"); `tests/e2e/signed-in/account-self-service.e2e.ts` creates settings, imported events and a scheduled activity in the app, downloads and checks the file, deletes the account and finds nothing left in Firestore or Auth; `tests/harness/account-controls.spec.ts` at 320, 390 and 1280 px, light and dark, with no axe violation.
  The code loads only on the account page, on demand.

### 34. Staging deploy before the Pro launch (built)

Built for REVIEW8 PLAN H1, so the owner's staging steps ([B1-B6](OWNER_CHECKLIST.md#staging-before-the-pro-launch)) can run on a second Firebase project ([DEPLOYMENT.md, Staging](DEPLOYMENT.md#staging)).

- **Hosting:** `firebase.json` names its configs by target (`app`, `redirect`) and `.firebaserc` maps them per project (production's two sites unchanged; `app` to `solara-staging`); `check-hosting-target.js` resolves them with the locked firebase-tools, and a full Hosting deploy to staging fails by design.
- **Functions:** `APP_URL` moved to `functions/.env.uv-activity-planner` and `functions/.env.solara-staging`, with no code default, and `check-functions-params.js` refuses production's origin for any other project (CI resolves both projects' params); production's resolved params are unchanged.
- **Workflow:** `deploy-staging.yml`, by hand, deploys the commit it runs from (the live site only from `main`), reads only `STAGING_*` settings from the `staging` environment, skips with a notice until `STAGING_FIREBASE_PROJECT_ID` is set, builds and smoke-tests the export, and deploys indexes, rules, Functions (when switched on) and the app target to staging, or only a branch's site to a 7-day preview channel (D9 previews; production previews are not safe, see DEPLOYMENT.md).
- **Guards:** `staging-target.mjs` and the staging mode of `check-public-env.mjs` (`NEXT_PUBLIC_DEPLOY_ENVIRONMENT=staging`) refuse production's project, sites, hosts, Functions host, keys and service accounts, also inside the built export (which found share links falling back to production's address; they now use the build's own site); staging builds are `noindex`; guard tests keep the two workflows apart.
- **Left for the owner:** B1-B6, starting with the `staging` environment and its variables (B1a); promoting a tested staging commit to production stays a merge to `main`.

### 35. Owner steps, deploy guards and docs from the eighth review (FIX8C, built)

- **Owner steps:** [Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order) is one verified list in four groups (anytime, staging, Pro launch, per feature switch), each step with what it unlocks, the console page, what to copy where, time, cost and how to check it; it adds the security steps the review found missing (website restriction on the browser key, `localhost` out of Auth, only Google as a provider, Firestore quota caps and a traffic alert, ruleset hardening, private reporting, closing the open alerts, trying TTL now) and a first check that a non-test Google account can sign in; the Open-Meteo key now comes before billing and the Stripe webhook endpoint before the first Functions deploy (REVIEW8 PLAN H1, M1, M2, L1-L3, L5, L6, L9; SEC L6, L8, M2, M3; QA M5, L8).
- **Deploy guards (PLAN M3, SEC L9):** `.github/scripts/check-public-env.mjs` fails the build when Functions are on without the App Check site key, when alerts are on without the VAPID key, and when an App Check debug token is set, including one in the `.env` files the build reads.
- **Docs:** `docs/HANDOFF.md` points at status.md and the handoff process instead of keeping its own state; SECURITY.md is current; `.env.local.example` lists every switch; [integrations/ANDROID.md](integrations/ANDROID.md) holds the Android readiness assessment.

### 36. Request size, webhook logs, Pro-only linked calendars and rules limits from the eighth review (FIX8E, built)

The eighth review's SEC L1-L5 and the code side of M2 (`handoff/review8-sec.md`):

- **Request bodies (SEC L1):** the Functions Framework read and parsed every body Cloud Run passed (up to 32 MiB) before a function ran; one 30 MB JSON body took a 256 MiB instance from about 135 MB to over 400 MB.
  The deploy entry point now guards the framework's server (`functions/src/shared/body-limit.ts`): a declared length over the function's limit (8 KiB, 256 KiB for the Stripe webhook) is answered 413 without reading the body, and a body without a length is held back until it is complete and within the limit, or answered 413 the moment it passes it; the connection is closed and the function never runs.
  `@google-cloud/functions-framework` is now a pinned dependency, so the tested framework is the deployed one.
- **Stripe webhook (SEC L2):** forged requests are logged once a minute per kind (`ThrottledLog`), the per-address limit is 60 a minute instead of 300, and the Stripe client is built only for a verified event.
- **Linked calendars are Pro-only (SEC L3):** adding and refreshing need Pro in the Functions (`hasProEntitlement`), the scheduled refresh pauses the links of an account that is no longer Pro without fetching them (`pro-required`), and removing works on any plan; a Free account sees a Pro offer instead of the form, a lapsed one its links with Remove only, and the plan comparison lists the feature for Pro (decision "Linked calendars plan").
- **Rules (SEC L4):** a key list holds only record keys mapped to `true` (32 hex characters for events, Google event ids for scheduled activities, with the joined length held so a key cannot hide commas), and `groupProfileIds` at most 768 characters in all.
- **Rules tests (SEC L5):** every server-only collection (the 14 top-level ones, tombstones' billing clean-up records, and `billingResources`, `alertState` and any unknown collection under an account) refuses get, list, filtered list, create, update and delete from its own account and from a signed-out client, and every collection group query is refused, also filtered to the caller.
- **Per-account write rate (SEC M2):** considered and left out; [COSTS.md](COSTS.md#writing-to-firestore-in-a-loop-any-signed-in-account) says why (a rules timestamp gate covers only some write paths, still allows more than Spark's daily quota, and would break real imports), so the Firestore quota caps, the operations alert and App Check remain the defence.
- **Tests:** `functions/test/body-limit.test.js` runs the real Functions Framework on the deploy entry point; `functions/test/hardening.test.js` floods the webhook with 570 forged requests; `functions/test/emulator/event-subscriptions.test.js` ("Pro only"); `functions/test/emulator/firestore.rules.test.js` (key lists, group selection, server-only collections and collection groups); `tests/harness/events.spec.ts` (the Free offer and a lapsed account at 390 and 1440 px, light and dark, no axe violation); `tests/e2e/signed-in/linked-calendars.e2e.ts`.

### 37. Guest settings and polish from the eighth review (FIX8D, built)

The eighth review's QA M3, L1-L5 and L11 (`handoff/review8-qa.md`), and a tighter account page:

- **Guests can change skin type, theme and units after setup (M3):** the burn card says "Now · fair skin, no SPF · Edit", and "Edit" opens Settings on the Sun profile; a guest's header has a Settings button (the account menu's place), which reaches Display (theme, units) and every other tab.
  Changes are kept in the guest plan on this device.
  Settings now lives in `components/SettingsHost.tsx`, opened through a context (`lib/open-settings.ts`) from anywhere in the app; it replaced App's never-set `prefsOpen`/`prefsTab` state and the header's `forceOpenTab` path (L2).
  The Settings sheet still loads on demand.
- **Escape closes the header's location panel (L1)** and returns focus to the place button, as the account menu and profile switcher do; with place suggestions open, the first Escape closes only them; the button has `aria-expanded`.
- **Setup's skin step quotes the UV it just showed (L3):** "Times are rough minutes to a burn without sunscreen at UV 7.0, the UV right now", with each type's minutes at that UV (fair skin ~21 min, as the dashboard then says); under UV 3 or without a reading it uses UV 10 and says so.
- **Copy that reads true (L4):** the briefing says "Seek shade while UV is very high or extreme, from 11am to 5pm" (the band before the hours, also in alerts); the hero is "Next slot for Hiking" instead of "Next lower-UV slot", which a slot planned with SPF can contradict, and an activity card's "Next slot: tomorrow at 6am".
- **Failures name the forecast service (L5):** "The forecast service isn't answering right now. Solara will try again in a minute."; the forecast store retries every minute while a screen shows the place (`errorRetryMs` in `lib/forecast-store.ts`), and "Retry" shows loading until it answers; with no forecast at all the dashboard and calendar show an empty state ("No forecast yet", "Try again now", loaded on demand) instead of a blank page; setup's place search says "Place search isn't answering right now."
  On phones the guest header's Settings and Sign in tighten a little, so "San Luis Obispo, California" still reads in full on two lines.
- **One Pro offer in the Events section:** a Free account saw two stacked "See Pro" offers (linked calendars, item 36, and the event heads-up note); with alerts on, the heads-up note makes one offer for both ("Pro adds linked calendars and a heads-up ..."), and Linked calendars keeps its Pro badge and what it does.
- **"CC BY 4.0" stays on one line (L11)** in setup's credits, city pages and the terms.
- **Account page:** each action leads with one sentence ("Get a copy of your Solara data as a JSON file.", "Permanently deletes your account, its data and your Solara sign-in. This cannot be undone."), with the full lists behind "What's included" and "What's deleted, and what stays"; every fact of the old text is kept (`lib/account-data.ts`).
- **Deferred, L6 (a cold `/app/` visit on slow 3G shows "Loading..." for about 14 s):** prerendering setup's first step is not small or clean.
  `/app/` cannot know before its JavaScript runs whether the browser holds a guest plan or a session, so a static setup step would flash before every returning visitor's dashboard unless an inline script hid it; the step would also be dead until hydration (typing or "Use my location" would do nothing for those 14 s, or be lost), and setup itself is loaded on demand to keep it out of a returning guest's first load.
  A better route is a smaller first load for a first visit (setup without the dashboard's code), measured with the review's slow 3G probe (`handoff/review8-probes/QA/` on the owner's machine).
- **First load:** a guest's first load is about 192.7 KB gzip (191.9 KB before), under the 193 KB budget.
- **Tests:** `tests/e2e/guest-settings.spec.ts` (each finding on the real export, all failing before the fix), `lib/forecast-store.test.ts` (retries every minute, a manual retry), `lib/onboarding.test.ts`, `lib/account-data.test.ts`, the briefing and alert tests; harness screens `guest-settings-skin`, `guest-settings-display` and `account-controls-details` at 320, 390 and 1280 px, light and dark, with no axe violation.

### 38. Android groundwork in the web repo (ANDROIDPREP, built)

The eighth review's Android readiness list (REVIEW8 PLAN part 3, "Small changes worth making in the web repo now"), items 2-8, so the owner's Expo app ([item 13](#13-wave-6-mobile-app-owners-learning-project)) and a first Trusted Web Activity start from shared code; the web app behaves as before.
The details are in [integrations/ANDROID.md](integrations/ANDROID.md).

- **Planning logic in `packages/core`:** plan limits, per-day activity windows, the next slot, the scheduler, the planner, today's state (`todayOver`), the skin quiz, the reapply timer, the UV strip and the key-list maths moved from `lib/` with their tests, each its own entry point (`@solara/core/<module>`) that the web app imports directly; `lib/` keeps the browser-only code.
  One source of truth: the record caps live in `record-caps.ts`, the linked-calendar Function uses core's `fitToCap` instead of its own copy, and a test holds `PREFS_LIMITS` to `TIER_LIMITS`.
  `packages/core/src/portable.test.ts` keeps core free of browser and Node globals.
- **Hermes:** imported event keys use core's own SHA-256 (identical digests, proven against Node and Web Crypto), and core reads time zones without `formatToParts` where an engine lacks it, tested on an Intl limited to what Hermes documents.
- **Entitlement:** a server-owned `subscriptionProvider` (`stripe`, read as `stripe` when absent) that `hasProEntitlement`, the account page and the export read; an unknown provider grants nothing.
- **Push:** Android devices get `android.notification` on the `solara-alerts` channel with high priority and the same collapse key; the web stays data-only.
- **Store build:** `NEXT_PUBLIC_STORE_BUILD=1`, or a session opened by an Android app (`android-app://` referrer or `?source=twa`), hides every price, upsell and checkout; a guest may still sign in free.
- **Client version:** Function calls send `X-Solara-Client: web/<commit>`, which the Functions validate and log, ready to refuse a too-old native build later.
- **Manifest:** an `id` and two `shortcuts`; the export and Hosting upload of `/.well-known/` files are checked, ready for assetlinks.json.
- **First load:** `@solara/core` is marked free of import side effects (as BUDGET2 also does), so unused barrel modules leave the first load; a guest's first load measured 192.1 KB gzip, against 192.7 KB on `main` before, with the store check included.
- **Tests:** the moved unit tests, `sha256.test.ts`, `hermes-intl.test.ts`, `key-lists.test.ts`, `client-version.test.ts`, `lib/store-build.test.ts`, `tests/manifest.test.ts`, `tests/well-known.test.ts`, the Functions' entitlement, CORS and logging tests, the rules and alerts emulator tests, and `tests/harness/store-build.spec.ts`.
- **Still to do for Android:** the Google Calendar and Microsoft Graph REST calls and the offline cache shapes in core, `share_target` and `screenshots` in the manifest, assetlinks.json (it needs the package name), and the same-site auth domain.

## Decisions

Agents never make owner decisions; they follow the recorded decision or the default.
The steps behind each one are in the [owner checklist](OWNER_CHECKLIST.md).

| # | Decision | State |
| --- | --- | --- |
| D1 | Functions deployment status | Decided 2026-10-23: not deployed until Pro launch |
| D2 | Make the repository public | Done 2026-10-23: public, "Protect main" ruleset with 8 required checks, squash merges only, Dependabot, secret scanning with push protection, CodeQL |
| D3 | Firestore index role for the deploy identity | Done 2026-10-23 |
| D4 | Workload Identity Federation, then delete the service-account key | Open; the key stays as the fallback until done |
| D5 | Forecast licensing | Decided 2026-10-23: Open-Meteo free tier until Pro launches, then the commercial plan (about $29 a month); its key is set with or just before `BILLING_ENABLED`, not after the first subscriber, or the free calendar feed fails in between (REVIEW8 PLAN M1) |
| D6 | Morning alerts | Decided 2026-10-23: Pro-only, relaunch with Pro on one scheduled Function for every time zone |
| D7 | Guest mode | Decided 2026-10-23, shipped in #71 |
| D8 | Operator, contact, jurisdiction, license | Done 2026-10-23 (#46) |
| D9 | Staging project and Stripe test mode | Decided 2026-10-23: set up at Pro launch, before billing work; the staging deploy and preview channels on staging are built (item 34) |
| D10 | Error reporting | Decided 2026-10-23: Sentry; code shipped in #70, waits for the owner's DSN |
| D11 | Bot protection | Decided 2026-10-23: App Check with reCAPTCHA v3; works without code changes, waits for the owner's site key |
| D12 | Local branch and worktree cleanup on the owner's machine | Done by 2026-10-28: only the main clone and the current review worktrees remain |
| Blaze | Billing plan | Decided 2026-10-23: stay on Spark until Pro launches, then Blaze with a budget and its kill switch ([COSTS.md](COSTS.md)) |
| Launch stage | How far to promote the free launch on Spark | Default, owner may change (2026-10-28): a quiet free launch on Spark now; move to Blaze with the budget kill switch (`infra/budget.sh`, owner checklist steps C2 and C3, without Functions) before any promotion, because on Spark a used-up quota stops the site instead of costing money (REVIEW8 QA H1, SEC M1 and M2; [COSTS.md](COSTS.md#how-many-users-before-blaze-costs-money)) |
| Forecast calls | Paid forecast API budget and cache grid | Default, owner may change (2026-10-27, item 14): 1,500 upstream calls an hour and 20,000 a day for the proxy, the feed and event heads-ups (`FORECAST_UPSTREAM_PER_HOUR`, `FORECAST_UPSTREAM_PER_DAY`), 4 an hour per calendar feed, a 0.02 degree cache grid |
| Budget | Budget and kill switch tiers | Default, owner may change (2026-10-27, item 14): $25 a month; warn at 50%, cost guard at 100% until the next period, detach billing at 300% (on by default, `COST_GUARD_DETACH_BILLING=false` turns it off); the scheduled Pro alerts are never paused by the budget |
| Price | Pro price | Decided 2026-10-24: $2.99 a month or $19.99 a year, 7-day free trial, waitlist until billing launches |
| Tiers | Plans | Decided 2026-10-24: as shipped in #71, below |
| Testing | Where tests run | Decided 2026-10-24: fast checks locally, full suites on GitHub Actions (#74) |
| Trial reuse | Keeping the free trial once per person | Default, owner may change (2026-10-27, item 15): keyed hashes (HMAC, `TRIAL_HISTORY_KEY`) of the sign-in provider's user id, the verified email and the card fingerprint, kept 2 years (TTL) after the trial, also after account deletion; checkout skips the trial for a known identity or email, and the webhook ends a trial at once for a known card |
| Group planning | Whom alerts and estimates plan for | Default, owner may change (2026-10-27, item 15): every estimate, the morning alert included, uses one core `planningFor`: in group mode, the group's most sensitive person |
| Server reads | Stored plans on the server | Default, owner may change (2026-10-27, item 15): the alerts and the calendar feed parse activities and profiles with the app's schemas and skip invalid entries |
| Export | Alert history in the export | Default, owner may change (2026-10-27, item 15): the export includes the last 7 days' alert history (kind, day, status, attempts, devices reached, times, error code) |
| Fair forecast budget | How the paid forecast calls are shared | Default, owner may change (2026-10-28): 20 upstream calls per caller per UTC hour in each budget (`UPSTREAM_SHARE_PER_CALLER`), keyed like the per-address limits, with an IPv6 /48 allowed 4 times the per-address limit and share; place search has its own budget of 200 an hour and 2,000 a day (`PLACE_SEARCH_UPSTREAM_PER_HOUR`, `PLACE_SEARCH_UPSTREAM_PER_DAY`); while a budget or share is spent, the last good forecast up to 12 hours old is served, flagged `stale`, instead of a 503 |
| Record caps | Imported events and scheduled activities per account | Default, owner may change (2026-10-28): 1,000 imported events and 500 scheduled activities, enforced by `firestore.rules` through a key list per collection (`lib/key-index.ts`, REVIEW4 M4) |
| Instance caps | HTTP Functions' `maxInstances` | Default, owner may change (2026-10-27, item 14; 2026-10-28, item 19): 3 for the forecast proxy, 2 for the calendar feed, 1 for the rest (the Stripe webhook, place search and linked calendars included), 16 in all (`INSTANCE_CAPS` in `functions/src/shared/options.ts`) |
| Linked calendars | Caps, refresh and backoff for linked calendars | Default, owner may change (2026-10-28): at most 5 links per account, Pro accounts only (see "Linked calendars plan" below); each refreshed every 6 hours by the third free Cloud Scheduler job (`eventSubscriptionsRefresh`, every 30 minutes, every due link oldest first, up to 3,000 a run, 16 at a time, 90 seconds per link, an ERROR when a link waits 6 hours past its time); a failing link waits 6, 12, 24, then 48 hours and is paused after 7 days; a manual refresh at most once per 10 minutes per link and 20 fetches an hour per account; 10 seconds, 1 MB and 3 redirects per fetch, https on port 443 to public addresses only |
| Linked calendars plan | Who may link calendars | Default, owner may change (2026-10-28): Pro only when `EVENTS_SUBSCRIPTIONS_ENABLED` is on; a Free account cannot link one, and the link of an account that is no longer Pro is paused without a fetch until it is Pro again, so many free Google accounts cannot spend the shared budget (REVIEW8 SEC L3); file imports and Google Calendar and Outlook events stay on Free |
| Linked calendar place lookups | Budget for looking up linked calendars' LOCATION text | Default, owner may change (2026-10-28): a budget of its own, 50 an hour and 300 a day (`EVENT_PLACE_LOOKUPS_PER_HOUR`, `EVENT_PLACE_LOOKUPS_PER_DAY`), 10 an hour per account, separate from place search's, so linked calendars cannot take place search from guests (REVIEW5 M1) |
| Google Calendar events | Scope, refresh and limits for events already in Google Calendar | Default, owner may change (2026-10-28, item 20): `calendar.events.readonly`, plus `calendar.calendarlist.readonly` only to choose calendars, verified separately from Scheduled's scopes; client only with tokens in memory and no refresh tokens (events refresh while Solara is open); the main calendar by default, up to 10 chosen; the next 30 days; only timed, not declined events with a place or a matching activity, at most 200 a refresh, counted in the 1,000-event key list; an event already stored from a file or linked calendar is not added again; disconnect removes the events and revokes the grant; behind `GOOGLE_CALENDAR_EVENTS_ENABLED` as well as the OAuth client ID |
| Event heads-ups | When Pro hears about a high-UV event | Default, owner may change (2026-10-28): a push about 3 hours before an outdoor event whose peak UV at its place reaches 6 (the evening before when that falls in quiet hours, never later than 15 minutes before), on by default for Pro (Settings turns it off), for imported, linked and Google Calendar events alike; at most one push every 3 hours, which covers the later events it names ("Heads-up scope", "Heads-up coverage" and "Heads-up switch" below); event forecasts come from the server's side of the forecast budget with a per-account share, at most 200 a run and 10 per account |
| Heads-up scope | Which events get a heads-up, and how often | Default, owner may change (2026-10-28, item 22): only events that count as an outdoor activity (the event's activity is one of the person's; "No activity" events, such as meetings, get none); the same title starting within 30 minutes counts as one event across files, linked calendars and Google Calendar; at most one heads-up push per account every 3 hours, naming the soonest high-UV event and how many more are coming up; every qualifying event in the window is looked at; the event's name is quoted in the body only, cleaned and cut to 40 characters |
| Heads-up lookups per account | How many event forecasts one account's heads-up may look up per alerts run | Default, owner may change (2026-10-28, item 25): at most 10 (`ALERTS_MAX_EVENT_FORECASTS_PER_ACCOUNT`), its soonest events first, places already looked up in the run free; the run's 200 are handed out one per account per round, the account whose next event starts soonest first (REVIEW6 M1) |
| Heads-up switch | Which switches turn event heads-ups on | Default, owner may change (2026-10-28, item 25): `ALERTS_ENABLED` and any events switch, linked calendars (`EVENTS_SUBSCRIPTIONS_ENABLED`), events from Google Calendar (`GOOGLE_CALENDAR_EVENTS_ENABLED`) or events from Outlook (`OUTLOOK_CALENDAR_EVENTS_ENABLED`, item 23), for every stored event alike (REVIEW6 L1); to stop heads-ups, turn off `ALERTS_ENABLED` or all three (REVIEW8 QA M6) |
| Heads-up coverage | Which later events a heads-up push stands for | Default, owner may change (2026-10-28, item 25): every high-UV outdoor event that could not get a heads-up of its own after the 3-hour gap, counted in "N more"; later events that still can get their own (REVIEW6 L2) |
| Limiter overflow | What the per-address limiter does when full | Default, owner may change (2026-10-28, item 22): past 10,000 live windows, new keys are counted in a 2 MB count-min sketch per limiter instead of being refused |
| Forecast shares by network | IPv4 networks and the browser's part of the forecast budget | Default, owner may change (2026-10-28, item 22): an IPv4 /24 may use 4 caller shares (`IPV4_NETWORK_WEIGHT`), like an IPv6 /48; the browser's part of the budget is now the "Forecast budget sides" row |
| Forecast budget sides | How the browser and the server share the paid forecast calls | Default, owner may change (2026-10-28, item 26): two sides, the browser's forecasts and the server's own work (the calendar feed and event heads-ups), may each spend at most two thirds of the hour and the day (`SIDE_SHARE_OF_UPSTREAM`: 1,000 an hour and 13,333 a day of the defaults), counted on their own counters as well as the shared ones; the total is unchanged and each side keeps at least a third whatever the other does |
| Sun's phase | When the dashboard and setup say the sun is down | Default, owner may change (2026-10-28, item 26): from the place's sunrise and sunset (NOAA's equations, for the place's own date and zone), not from the UV; while the sun is up the reading shows even under UV 0.5 ("0.4 Low now"); "Before sunrise" and "Sun is down" only outside those times; without a place's zone (setup's place search always gives one) the old UV rule applies |
| Daylight slots | Whether a slot may be offered in the dark | Default, owner may change (2026-10-28, item 28): no; every window is cut to the day's daylight at the place (sunrise to sunset on 5-minute steps), in the app, the morning alert and the calendar feed, since UV 0 at night is not a "lower-UV slot"; there is no per-activity "fine in the dark" setting (an activity whose preferred hours are all in the dark is told so); without the place's sun times nothing is cut |
| Today is over | When the briefing turns to tomorrow and the hero steps aside | Default, owner may change (2026-10-28, item 28): at the place's sunset, for both; without a place, once no UV of 0.5 or more is left |
| UV 0 wording | What an index of 0 is called | Default, owner may change (2026-10-28, item 28): "Low", the WHO's category for 0-2, as the scale legend says; it keeps its gray shade |
| UV threshold wording | How copy names the UV 3 and 8 thresholds | Default, owner may change (2026-10-28, item 22): the WHO bands stay on the rounded index; copy that sits beside one-decimal values names the band ("moderate or higher", "low", "very high or extreme") instead of "3 or more" |
| Outlook events | Scope, auth and limits for events already in Outlook | Default, owner may change (2026-10-28, item 23): Microsoft Graph `Calendars.ReadBasic` only (`Calendars.Read` only if the build gate finds that ReadBasic hides titles or locations); a hand-rolled PKCE popup without `offline_access` instead of MSAL.js, tokens in memory only; the `common` authority; up to 10 of the person's own calendars (the default one first, as for Google), the next 30 days, at most 200 events a refresh in the 1,000-event key list; disconnect removes the events and links to Microsoft's consent pages (a public client cannot revoke its own grant); shipped without publisher verification; behind `OUTLOOK_CALENDAR_EVENTS_ENABLED` and `MICROSOFT_CLIENT_ID` |
| Outlook account picker | When Microsoft's account picker shows in the Outlook sign-in | Default, owner may change (2026-10-28): only "Show my Outlook events" sends `prompt=select_account`, so someone with a personal and a work account picks one when connecting; Refresh and "Choose calendars" do not, so Microsoft reuses the account it has signed in (usually without a prompt) and a Refresh cannot silently switch to another account's calendar (REVIEW7 L3) |
| Calendar link helper | Which providers the "Add a calendar from..." helper covers | Default, owner may change (2026-10-28, item 24): Apple iCloud, Google, Outlook.com and Yahoo, computer steps first and phone steps where the provider offers them; it recommends a separate calendar for outdoor plans; Yahoo ships without numbered steps if they cannot be confirmed in a real account |
| Calendar link refusals | Which pasted links the helper holds back | Default, owner may change (2026-10-28): only links that certainly are not calendars (a provider's web page, an HTML or embed link); any other link, such as Outlook's `/OWA/` in capitals or another `yahoo.com` host, goes through with a warning; hosts are matched exactly and case-insensitively, and no secret link is ever echoed or logged (REVIEW7 L5) |

### Tiers

| | Guest (no sign-in) | Free account | Pro |
| --- | --- | --- | --- |
| Forecast | Today | Today and tomorrow | 10 days |
| Activities | 1 | 3 | 20 |
| Storage | This device only | Synced | Synced |
| Calendar sync (Google Calendar adding, Scheduled, live feed, .ics export) | - | Yes | Yes |
| Family profiles, morning alerts | - | - | Yes |

Google Calendar adding and Scheduled stay available on Free accounts by owner decision (2026-10-24); `packages/core/src/tiers.ts` keeps `calendar` on for Free, and that one flag also covers the live feed and the .ics export.
Morning alerts are Pro-only and launch with Pro.
Upsell moments: "Save your plan, sign in free" when a guest adds a second activity or returns on a later day; "See the next 10 days with Pro" on the forecast tabs; "Get this as a morning alert" on the recommendation card.
No pop-ups on first arrival.

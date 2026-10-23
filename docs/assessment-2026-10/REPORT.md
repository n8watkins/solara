# Solara assessment - October 2026

Assessed: 2026-10-23, against `origin/main` at `7d9e871` (last change 2026-07-15).
Method: five parallel assessors (backend security, frontend security and privacy, CI/CD and operations, code quality and tests, product/UX/accessibility/performance), followed by a lead review that re-checked the highest-impact claims in code and screenshots.
Companion plan: [PLAN.md](PLAN.md).

## Executive summary

Solara has a strong core.
The billing, account-deletion and notification backends are carefully engineered, every test suite passes with no flakes, and the security headers and Firestore rules are better than most projects this size.
The problems are elsewhere:

1. **The project is frozen.** CI has been red since July and cannot go green: `npm audit --audit-level=high` now fails in both packages (root: 2 critical, 20 high, including a critical Next.js advisory fixed in-range by 16.4.2; functions: 1 critical, 24 high).
   Every PR and every deploy is blocked, including security fixes.
2. **A runtime deadline is 7 days away.** Cloud Functions decommissions Node 20 on 2026-10-30, and `functions/package.json` pins Node 20.
   After that date no Functions deploy works.
3. **There are real user-facing bugs**, including a sun-safety bug (missing UV data reads as UV 0, "safe"), a shared-device data leak between accounts, and a dashboard that recommends windows that contradict each other or have already passed.
4. **A paid feature is silently off.** Nothing has sent morning notifications since 2026-07-15, but Pro pricing still advertises them.
5. **Platform hygiene has lapsed.** One long-lived admin service-account key is shared by deploy and runtime jobs, every GitHub security feature is off, branch protection is unavailable on the private free repo, and there is no error reporting, alerting, backup policy or runbook.
6. **The product funnel leaks.** Visitors must sign in with Google before seeing any value, returning users have no direct sign-in, primary buttons fail WCAG contrast, and the landing page ships about 404 KB gzip of app and Firebase code before rendering anything.

## Health check results

| Check | Result |
| --- | --- |
| Lint (`--max-warnings=0`) | Pass, but six rules are disabled globally (26 hidden violations) |
| Typecheck (`strict`) | Pass |
| Unit tests (190), 3 runs | Pass, no flakes |
| Functions tests (81), 3 runs | Pass, no flakes |
| Production build | Pass, 7.4 s |
| Playwright e2e (8 tests, repeated 5x) | 40/40 pass, but only up to the sign-in boundary |
| Firestore rules tests | Not run locally (no Java); CI runs them |
| `npm audit --audit-level=high` (root and functions) | **Fail**, blocks every PR and deploy |
| Coverage | Not configured; root 40% statements, functions about 90% lines |
| Last production deploy run | Failed 2026-07-15 (missing `roles/datastore.indexAdmin`); Hosting itself did publish |

## Severity legend

- **Critical:** active harm, safety risk, or a blocker with a hard deadline.
- **High:** real security, privacy, correctness or revenue risk.
- **Medium:** meaningful risk or debt with a clear fix.
- **Low / Info:** hygiene and hardening.

Verification: **L** = confirmed by the lead reviewer, **A** = confirmed by the assessor (code read, command run, or browser), **R** = reasoning only, owner should confirm.

## Critical

| ID | Finding | Evidence | Verified |
| --- | --- | --- | --- |
| OPS-1 / BE-3 | CI audit gate fails in both packages; nothing can ship | `ci.yml`, `deploy.yml` audit steps; `npm audit` output | A |
| BE-1 / OPS-2 | Functions pinned to Node 20; Cloud Functions decommissions it 2026-10-30; also keeps functions on vulnerable firebase-admin 13 (admin 14 needs Node 22+) | `functions/package.json:4-6`, backend CI jobs on Node 20 | L |
| CQ-1 | Missing UV values become 0 (reads as "safe") in the client, calendar feed and notifier | `lib/forecast.ts:41`, `functions/lib/sun.js:21`, `scripts/send-notifications.js:77` | L |
| PROD-1 | Sign-in wall before any value; returning users must redo onboarding to reach sign-in | `components/App.tsx:117-125`, `components/Welcome.tsx:78-82` | A |
| A11Y-1 | Primary buttons (white on #F97316, 2.8:1) and secondary text (3.0:1) fail WCAG AA; 85+ axe violations on the dashboard | `app/globals.css:15-16` | L |

## High

| ID | Finding | Evidence | Verified |
| --- | --- | --- | --- |
| FE-3 | Sign-out keeps prefs in localStorage; the next new account on that device is seeded with the previous user's location, skin profile, activities and calendar feed token | `App.tsx:67-79` spreads `...local`; sign-out at `Header.tsx:60`, `PreferencesModal.tsx:398` clears nothing | L |
| BE-2 | CI Functions deploy cannot resolve `STRIPE_PRICE_ID` / `APP_URL` params (env vars are not read; non-interactive mode fails) | `functions/index.js:30-31`, `deploy.yml` functions step; reproduced with the firebase-tools resolver | A |
| OPS-3 | Production deploy red since 2026-07-15; `continue-on-error` hides which step failed | `deploy.yml:134,189-193`; runs 29406661815, 29407310200, 29408483537 | A |
| OPS-4 | Morning notifications have not been sent since 2026-07-15 (cron removed in #13, no replacement), yet pricing and settings advertise them | `notify.yml:3-13`, `functions/index.js:246-284`, `PricingModal.tsx:50` | A |
| OPS-5 / BE-11 | One long-lived Admin SDK SA JSON key is shared by deploy and the notifier, written to disk, never rotated, once copied to Downloads; Functions run as the default compute SA | `deploy.yml:136-183`, `notify.yml:38` | A |
| OPS-6 | Private repo on GitHub Free: no branch protection, rulesets or environments; any push to `main` deploys to production | GitHub API 403 on protection and rulesets | A |
| OPS-7 | Dependabot, CodeQL, secret scanning, SECURITY.md and CODEOWNERS are all absent | GitHub API; `.github/` contents | A |
| UX-1 | Dashboard recommendations conflict and include elapsed windows (hero "6am-11am", cards "4pm-4:45pm", two different "now" burn times) | `Dashboard.tsx:92,95`; screenshot `h01` | L |
| UX-2 | Sun-path chart is stretched on desktop and does not line up with the hourly strip | `SunArc.tsx:115` `preserveAspectRatio="none"`; screenshot `h01` | L |
| UX-3 | Calendar week view: activity lanes overflow their day columns, labels clipped, axis starts after windows start | `CalendarView.tsx`; screenshot `h04` | L |
| PROD-2 | "Now" and "today" use the device time zone instead of the location's; wrong for travel and saved locations | `lib/forecast.ts:69-73`, `Dashboard.tsx:50` | L |
| PROD-3 | Pro upsells lead nowhere (toast only); pricing omits the real differentiators | `Dashboard.tsx:407`, `lib/billing.ts:94-100` | A |
| PROD-4 | Fahrenheit and en-US 12-hour only, in a product whose biggest markets use Celsius | `lib/forecast.ts:42` | L |
| PROD-5 | `/` is client-only (`ssr: false`), so search engines and link previews see an empty page | `app/page.tsx:5` | A |
| A11Y-2 | Modals have no dialog role, focus trap, Escape or focus return | `ActivityModalShell.tsx`, Settings overlay | A |
| A11Y-3 | Sun-path "slider" and tooltips are unreachable by keyboard and screen readers, hiding safety caveats | `SunArc.tsx:117`, `Tooltip.tsx:19-20` | A |
| PERF-1 | Landing page loads about 404 KB gzip (Firebase plus the whole dashboard) before rendering; reCAPTCHA loads pre-sign-in | build output; Lighthouse | A |
| PERF-2 | No offline support or app-shell service worker, although the install prompt promotes the PWA | `scripts/generate-sw.js` | A |
| CQ-10 | 0 component tests; no signed-in e2e; e2e runs against `next dev` instead of the static export that ships | `vitest.config.ts`, `playwright.config.ts:37` | A |

## Medium

| ID | Finding | Evidence |
| --- | --- | --- |
| BE-4 | Client chooses `calendarFeedToken`; a leaked feed URL lets another account hijack that feed (lookup is `where(token).limit(1)` with no uniqueness) | `firestore.rules:26,48`, `functions/lib/calendar-feed.js:62-63` |
| BE-5 | Most user-doc fields have no type or size validation (up to 1 MiB), breaking the feed and notifier and inflating cost | `firestore.rules:60-128` |
| BE-6 / FE-10 | App Check only on notification endpoints, no replay protection, reCAPTCHA v3 instead of Enterprise | `functions/index.js:44-146`, `lib/firebase.ts:323-326` |
| BE-7 | Unauthenticated calendar feed has no timeout, stale fallback, HTTP caching or rate limit | `functions/lib/sun.js:66`, `functions/index.js:286-289` |
| BE-8 / OPS-11 | Every deploy temporarily installs weaker "pre-functions" Firestore rules | `deploy.yml:144-154,178-187` |
| BE-9 | Deletion keeps the Stripe customer; export omits billing summary; server-owned records have no TTL | `functions/lib/account.js` |
| BE-10 | Account deletion can stall forever on a missing Stripe resource, with no alert | `functions/lib/account.js:35-40,300-393` |
| BE-12 / FE-5 | Open-Meteo free tier is non-commercial yet powers paid features; Open-Meteo (CC BY 4.0) and OSM/Nominatim (ODbL) attribution missing; Nominatim called uncached from three components | `lib/forecast.ts:86`, `functions/lib/sun.js:63` |
| FE-1 | CSP allows `'unsafe-inline'` scripts and broad wildcards, with no reporting; hash-based CSP was tested and works | `firebase.json:22` |
| FE-2 | Google Calendar requests `calendar.readonly` and `calendar.events` while code and privacy policy claim "freeBusy only" | `lib/gcal.ts:8,16-17`, `app/privacy/page.tsx:29` |
| FE-4 | Exact device coordinates sent to Nominatim and Open-Meteo and stored unrounded | `LocationPopover.tsx:75-81`, `Onboarding.tsx:54` |
| FE-6 | Google Fonts and reCAPTCHA load before any consent choice and are undisclosed | `app/globals.css:1`, `lib/firebase.ts:321-327` |
| FE-7 | Privacy policy has no operator, contact, rights, legal basis, retention or full processor list | `app/privacy/page.tsx` |
| OPS-8 | No `permissions:` blocks; actions tag-pinned and two majors behind | all workflows |
| OPS-9 | `npx --yes firebase-tools@15` floats at deploy time | `deploy.yml:138,149,161,183` |
| OPS-10 | Quality jobs duplicated; CI runs twice per PR commit; deploy rebuilds an untested artifact | `ci.yml`, `deploy.yml:18-130` |
| OPS-12 | No staging project, preview channels or environment separation | `.firebaserc` |
| OPS-13 | Majors behind: Tailwind 4, TypeScript 7, ESLint 10, Vitest 5, Firebase 13, Stripe 23, @types/node 24+ | `npm outdated` |
| OPS-14 | firebase-admin split (^14 root, ^13 functions); backend-only packages in root `dependencies` | `package.json:22-24` |
| OPS-15 | No error reporting, structured logging, alerts or uptime checks | repo-wide |
| OPS-16 | Backups, PITR, delete protection and budget alert absent or undocumented | docs |
| OPS-17 | No incident runbook or secret rotation procedure | `docs/DEPLOYMENT.md:230-235` |
| CQ-3 | Logic duplicated across `lib/`, `functions/lib/`, `scripts/` and already drifted (weather labels, ICS headers, token length) | see finding |
| CQ-4 | 2,500+ lines of untyped CommonJS in the money and deletion paths | `functions/` |
| CQ-5 | Prefs schema hand-maintained in five places; `schemaVersion` written but never read | `lib/types.ts`, `lib/prefs.ts`, `firestore.rules`, `functions/lib/account.js` |
| CQ-6 | API responses and cache reads are cast, never validated; cache key unversioned | `lib/forecast.ts:93`, `lib/cache.ts:17` |
| CQ-7 | `App.tsx` races: stale auth results, unaborted weather fetches, double fetch, "today" never rolls over | `components/App.tsx` |
| CQ-8 | Strictness stops at `strict`; `noUncheckedIndexedAccess` would have caught CQ-1 (75 errors) | `tsconfig.json` |
| CQ-9 | Six lint rules disabled globally, including the two that catch the CQ-7 races; no type-aware lint, no formatter | `eslint.config.mjs:11-19` |
| CQ-11 / CQ-12 | Large mixed-concern components; 703 inline style objects; Tailwind barely used; UV palette defined four times | `components/` |
| CQ-13 | React Compiler off; no `global-error.tsx`; error boundary reports nowhere | `next.config.ts` |
| PROD-6..8 | Onboarding friction, blocking consent modal, stale and non-converting share links | see finding |
| UX-4..9 | Disabled buttons look active, sticky hover on touch, empty onboarding cards, welcome art defects, bold weights not loaded, dark mode ignores system and flashes, mobile header hides UV | screenshots `d0x`, `m0x`, `h0x` |
| A11Y-4 | Missing h1s, unlabeled select, 6 px targets, missing live regions | axe |
| PERF-3 / PERF-4 | Single-location cache that drops stale data; render-blocking font import | `lib/cache.ts`, `app/globals.css:1` |

## Low and info

| ID | Finding |
| --- | --- |
| BE-13 | Stripe API version implicit (follows SDK) |
| BE-14 | Refunds and disputes keep Pro; auto-cancelled duplicate checkouts are not refunded; no `past_due` grace |
| BE-15 | ICS injection through unvalidated activity `id` (compounds BE-4) |
| BE-16 | Forecast fetch failures cached for the whole notifier run; no timeout in `sun.js` |
| BE-17 | Rules tests lack field coverage; no lint or typecheck on `functions/` and `scripts/` |
| BE-18 | Notification endpoints echo `error.message` |
| BE-19 / BE-20 | Prefer `onSchedule` dispatcher and `onCall` with App Check over hand-rolled HTTP |
| FE-8 | Share page renders arbitrary text on the Solara origin (phishing surface); not indexed-blocked |
| FE-9 | GA page_view leaks `session_id` query strings; cookies kept on opt-out; CSP missing GA4 hosts |
| FE-11 | Service worker imports Firebase compat 10.12 from CDN; opens unchecked notification links |
| FE-12 | `window.open(_blank)` without `noopener` |
| FE-13 | firebase-admin in the app's runtime dependency tree |
| FE-14..16 | `no-store` on every asset, header tweaks, catch-all rewrite returns 200 for unknown paths |
| OPS-18..21 | npm install-script policy, no Node pin, e2e not against export, public values stored as secrets, no deploy timeout, SBOM or provenance |
| OPS-22..24 | No LICENSE, stale `.local-ops.yaml`, stale docs (`DEPENDENCY_RISK.md` claims zero high/critical), local checkout has 13 merged branches and 8 worktrees |
| CQ-14 / CQ-15 | `Math.random` fallback for feed tokens; Playwright reuses stale servers; no axe in e2e |
| A11Y-5 | Weak input focus indicator |
| UX-10 | Copy and icon nits |

## Already done well

- Stripe webhook: signature on raw body, transactional idempotency, out-of-order handling, live re-fetch.
- Clients cannot change `tier`; checkout binds uid, price and mode, with reservations and durable cleanup.
- Every endpoint verifies ID tokens with revocation checks; deletion requires recent auth and typed confirmation.
- Tombstone-based deletion immediately blocks access, revokes sessions and cleans billing with leases and backoff.
- No IDOR: uid always comes from the verified token; rules are owner-scoped with default deny.
- No `dangerouslySetInnerHTML`, `eval` or `postMessage`; no exploitable XSS found.
- Analytics is strictly opt-in, verified in a real browser.
- Strong baseline headers: `frame-ancestors 'none'`, `object-src 'none'`, HSTS, COOP, Permissions-Policy, nosniff.
- Deterministic test suites with 90% backend line coverage and an emulator-backed rules suite in CI.
- Careful safety framing in copy; reduced motion respected; good mobile ergonomics.

## Not verified

The following need the owner's console access: production IAM bindings, App Check enforcement, PITR and backups, budget alerts, the value of `ENABLE_BLAZE_FUNCTIONS` and whether Functions are currently deployed, the Stripe webhook API version, and current Open-Meteo and Nominatim terms.
The Firebase CLI account available to the assessors received 403 on the project.

## Screenshots and raw artifacts

Screenshots, axe output and Lighthouse reports were captured to a temporary scratch directory during the assessment and are not committed.
Re-run them with the signed-in harness described in [PLAN.md](PLAN.md) workstream E.

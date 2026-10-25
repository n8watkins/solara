# Solara status

_Last reviewed: 2026-10-25_

This is the single page for the current state of Solara: what is live, what is built but switched off, how CI/CD runs, and which owner actions are done or open.
Facts were checked against the code, the workflows, GitHub (`gh`) and the live site on the date above.
Items marked "owner reported" depend on a console the repository cannot read.
The plan for the remaining work is in [ROADMAP.md](ROADMAP.md); the owner's steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Live at https://solara-uv.web.app

Solara is served from the Firebase Hosting site `solara-uv` in project `uv-activity-planner`, on the free Spark plan.
The original address, `https://uv-activity-planner.web.app`, permanently redirects every path to the same path on `solara-uv.web.app`, except Firebase's reserved `/__/` paths (#42, #45).
Every merge to `main` deploys; the deploys for #76, #78, #80, #79, #81 and #83 were green (the latest is run 40183440542).
#79 and #81 fixed the findings of the first post-launch code review (Google sign-in popup and quota handling, the Scheduled list query, plan limits in the Firestore rules, the feed limiter's client address).

What users get:

- A static landing page at `/` (no framework JavaScript, nothing from Firebase) and the app at `/app/`; a browser with a signed-in account that opens `/` goes to the app (#71).
- Guest mode: the app works without signing in, on the guest plan (today's forecast, one activity, kept only in this browser).
  Google sign-in is free and syncs to Firestore; a guest plan carries into a brand-new account on its first sign-in and never into an existing one.
- A guest never downloads Firebase: the dashboard shows from the guest plan and cached forecast at once, and Firebase loads only when someone reaches for "Sign in" or the browser already holds a session (#83).
  Lighthouse mobile LCP for `/app/` is about 2.3 s (was 4.4-6.3 s), and a guest's first load is about 236 KB gzip of JavaScript (was over 500 KB).
- The confirmed plans from `lib/tiers.ts`: Guest (today, 1 activity, this device), Free (today and tomorrow, 3 activities, synced, calendar sync) and Pro (10 days, 20 activities, calendar sync, family profiles, morning alerts).
  Pro shows $2.99 a month or $19.99 a year with a 7-day free trial, as a waitlist until billing launches.
  Gentle upsells ("Save your plan, sign in free", "See the next 10 days with Pro", "Get this as a morning alert") open the sign-in or plans dialog and stay dismissed per device.
- UV and weather forecasts from Open-Meteo, in the location's time zone, with Celsius or Fahrenheit and 12- or 24-hour time chosen from the locale or in Settings.
- Personalized activity windows on the dashboard and in the week calendar, within each plan's days.
- Place suggestions while typing a town in setup and in the header's location panel (Open-Meteo place search, at most one request per second, keyboard and screen-reader friendly) (#80).
- Saved locations, share links (`/share/`), a one-off calendar file download from Plan ahead, and family profiles on Pro.
- Opt-in Google Analytics 4.
- The privacy policy and terms with the operator details (#46), the Google user data section (#48) and the Sentry and reCAPTCHA notices (#70).
- Firestore rules and indexes, deployed by every push to `main`.
  The rules also hold each account's activities, saved places and profiles to its plan (Free 3, 3 and 1; Pro 20, 12 and 6), so the limits do not depend on the client; an account back on Free keeps and can shrink what it saved on Pro.

## Built but switched off

These are in the code and tested in CI; each waits for an owner step, not engineering work.

| Feature | Switched on by | Owner step |
| --- | --- | --- |
| Google Calendar connect, adding events and **Scheduled** activities (#55, #56) | `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (not set; no client ID in the live bundle) | [Steps 1-4](OWNER_CHECKLIST.md#next-steps-in-order) |
| **App Check** with reCAPTCHA v3, for signed-in users only | `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` (not set) | [Step 5](OWNER_CHECKLIST.md#next-steps-in-order) |
| **Sentry** error reporting, scrubbed in the browser (#70) | `NEXT_PUBLIC_SENTRY_DSN` (not set; the bundle then contains no Sentry code) | [Step 6](OWNER_CHECKLIST.md#next-steps-in-order) |

The integrations browser suite (`npm run test:e2e:integrations`) builds the export with a fake site key and DSN and proves that signed-out pages make no reCAPTCHA request, that signing in loads reCAPTCHA and exchanges its token, that Firestore sends the App Check token, and that the CSP allows exactly what reCAPTCHA v3 and Sentry need.
The signed-in suite covers Scheduled with a faked Google Calendar.

## Waiting for the Pro launch (Blaze)

- **Cloud Functions are not deployed.**
  The `ENABLE_BLAZE_FUNCTIONS` variable is not set and the build ships an empty `NEXT_PUBLIC_FUNCTIONS_URL`, so the client hides everything that needs Functions: checkout and the billing portal, account export and deletion, the live calendar feed, notification device registration, and the scheduled billing and deletion jobs.
- **Billing:** no `STRIPE_PRICE_ID` variable; the pricing dialog offers a waitlist.
- **Morning alerts** are Pro-only and launch with Pro on a scheduled Function; nothing has been sent since 2026-07-15 and the manual `notify.yml` workflow has no schedule.

The project stays on Spark until Pro launches ([COSTS.md](COSTS.md)).

## CI/CD

- **Repository:** public, with the "Protect main" ruleset: pull requests only, squash merges only, no force pushes or deletion, and 8 required checks from `quality.yml` (lint, types and unit tests; browser tests on the static export; signed-in UI harness; signed-in browser tests on emulators; Functions and Firestore rules; workflow and secret scanning; dependency review; browser tests with Sentry and App Check switched on).
  Dependabot alerts and security updates, secret scanning with push protection, and CodeQL are on; CodeQL has no open alerts (#72, #73).
  There is no `production` environment yet; the deploy and notifier jobs that receive credentials run only from `main`, even when started by hand on another branch ([owner checklist](OWNER_CHECKLIST.md#repository)).
- **Testing policy (#74):** agents run the fast checks locally (lint, typecheck, docs check, unit tests, build and the suites their files touch); the full browser and emulator suites run on GitHub Actions.
  CI runs only the suites a pull request's files can affect (#76); every required check still reports, and the others pass in seconds ([change-aware checks](../README.md#change-aware-checks)).
- **Pull requests** run `.github/workflows/ci.yml`, which calls the reusable `quality.yml` once per commit (older runs are cancelled).
- **Pushes to `main`** run `deploy.yml`: the same quality workflow, then one production build that is checked, smoke-tested on the Hosting emulator and packaged with its SHA-256, SBOMs and a provenance record and attestation.
  Separate jobs then deploy Firestore rules, Firestore indexes, Functions (only when `ENABLE_BLAZE_FUNCTIONS` is `true`) and Hosting, which receives exactly the tested artifact.
- **Credentials:** deploys and the notifier still use the long-lived `FIREBASE_SERVICE_ACCOUNT` key, because Workload Identity Federation is not set up yet.
- **Configuration:** `NEXT_PUBLIC_SITE_URL` is a repository variable; the other public `NEXT_PUBLIC_*` values are still repository secrets, which the build reads as a fallback.
  The `NEXT_PUBLIC_PRO_PRICE` secret is unused since #71 (prices live in `lib/plans.ts`).
- **Dependencies:** Dependabot version updates run weekly with a 7-day cooldown.
  Wave 4 upgraded Vitest 5, Firebase 13, Stripe 23 (API version pinned) and Tailwind 4, kept `@types/node` on the Node 24 line and removed dotenv (#57-#62); ESLint 10 (#35) and TypeScript 7 (#40, #31) wait for upstream support.
  Production dependency audits report zero advisories; accepted development advisories are in [DEPENDENCY_RISK.md](DEPENDENCY_RISK.md).

How deploys work and how to configure them is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Owner actions

### Done

| Action | State |
| --- | --- |
| D1 Functions deployment status | Resolved: not deployed until Pro launch |
| D2 Make the repository public | Done 2026-10-23, with the ruleset and security features above |
| D3 Firestore index role for the deploy identity | Granted 2026-10-23; the Firestore indexes job is green |
| D8 Operator, contact, jurisdiction and license | Nathan Watkins, contact@n8builds.dev, California, all rights reserved (#46) |
| Move to `solara-uv.web.app` | Done (#42, #45); `NEXT_PUBLIC_SITE_URL` variable set |
| Search Console ownership of `https://solara-uv.web.app/` | Verified 2026-10-23 (#43), owner reported |
| Firebase Auth and OAuth authorized domains | Added, owner reported |
| OAuth scopes (`openid`, email, profile, `calendar.freebusy`, `calendar.events.owned`) | Added, owner reported |
| Price and tiers | Confirmed 2026-10-24 ([ROADMAP.md](ROADMAP.md#decisions)) |
| Dependabot alerts and security updates | On |

### Open

The ordered list is [Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order): Google Calendar client ID, OAuth branding resubmission and publishing, calendar scope verification, App Check, Sentry, Workload Identity Federation (D4), moving the public build values to variables and deleting `NEXT_PUBLIC_PRO_PRICE`, counsel review of the governing-law language, and local worktree cleanup (D12).
Blaze, staging and Stripe test mode (D9) and the Open-Meteo commercial plan (D5) come at the Pro launch.

## Known test boundary

The signed-in e2e suite runs the real app, rules and Functions against the Firebase emulators, but CI cannot prove Google OAuth consent, App Check with real reCAPTCHA tokens, delivery to a real Sentry project, FCM, APNs or Android notification presentation, Stripe signatures, or third-party calendar refresh timing.
Those checks stay explicit steps in the [owner checklist](OWNER_CHECKLIST.md#release-verification).

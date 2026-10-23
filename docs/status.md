# Solara status

_Last reviewed: 2026-10-23_

This is the single page for the current state of Solara: what is live, what is not, how CI/CD runs, and which owner actions are done or open.
Facts were checked against the code, the workflows, GitHub (`gh`) and the live site on the date above.
Items marked "owner reported" depend on a console the repository cannot read.
Open engineering work is in [ROADMAP.md](ROADMAP.md); owner steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Live at https://solara-uv.web.app

Solara is served from the Firebase Hosting site `solara-uv` in project `uv-activity-planner`.
The original address, `https://uv-activity-planner.web.app`, permanently redirects every path to the same path on `solara-uv.web.app`, except Firebase's reserved `/__/` paths (#42, #45).
Production runs commit `7b657c8` (PR #52), deployed by run 40034677351.

What users get:

- Google sign-in, required before the dashboard, with preferences synced to Firestore.
- UV and weather forecasts from Open-Meteo, in the location's time zone, with Celsius or Fahrenheit and 12- or 24-hour time chosen from the locale or in Settings.
- Personalized activity windows on the dashboard and in the week calendar, with Free (2-day) and Pro (10-day) limits.
- Saved locations and family profiles, share links (`/share/`), and a one-off `.ics` download from Plan ahead.
- Opt-in Google Analytics 4 (the measurement ID is compiled into the live page).
- The privacy policy and terms with the operator details (D8), and the Search Console ownership file.
- Firestore rules and indexes, deployed by every push to `main`.

## Not live

- **Cloud Functions are not deployed.**
  The Cloud Functions API is not enabled on `uv-activity-planner`, and the `ENABLE_BLAZE_FUNCTIONS` repository variable is not set, so the build ships with an empty `NEXT_PUBLIC_FUNCTIONS_URL` and the client hides or disables everything that needs Functions.
  Unavailable as a result: checkout and the billing portal, account export and deletion, the live calendar feed, notification device registration, and the three scheduled billing and deletion jobs.
  The Firebase billing plan (Spark or Blaze) is owner to confirm.
- **Stripe** is not configured for deploys: no `STRIPE_PRICE_ID` variable exists, and without Functions the pricing dialog offers a waitlist instead of checkout.
  Whether Stripe secrets exist in Secret Manager is owner to confirm.
- **Notifications** have not been sent since 2026-07-15.
  `.github/workflows/notify.yml` has no schedule and can only be started by hand, device registration needs the undeployed Functions, and the app no longer advertises alerts (#24).
  Relaunch is Wave 3, W3-B.
- **Google Calendar** connect and booking are hidden: `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` is not set as a repository secret or variable, and no OAuth client ID is in the live bundle.
- **App Check** is not active: no `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` is configured, and console enforcement is decision D11.
- **Scheduled activities** (Google Calendar events that Solara created, shown as Scheduled in the calendar) are in progress on another branch and not merged.

## CI/CD

- **Pull requests** run `.github/workflows/ci.yml`, which calls the reusable `.github/workflows/quality.yml` once per commit (older runs are cancelled).
  Its jobs: lint, typecheck, unit tests and the production audit; browser tests on the static export served by the Hosting emulator; signed-in browser tests on the Firebase emulators; the signed-in UI harness with screenshots and an axe report; Functions typecheck, tests, deploy params and payload checks, and Firestore rules tests; actionlint, zizmor, gitleaks and the docs link check.
  Dependency review runs only once the repository is public.
- **Pushes to `main`** run `.github/workflows/deploy.yml`: the same quality workflow, then one production build that is checked, smoke-tested on the Hosting emulator and packaged with its SHA-256, SBOMs and a provenance record.
  Separate jobs then deploy Firestore rules, Firestore indexes, Functions (only when `ENABLE_BLAZE_FUNCTIONS` is `true`) and Hosting, which receives exactly the tested artifact.
  Artifact attestation runs only when the repository is public.
  Every deploy since run 40013061416 (commit `2d1ae1e`) has been green.
- **Credentials:** deploys and the notifier authenticate with the long-lived `FIREBASE_SERVICE_ACCOUNT` key, because the Workload Identity Federation variables are not set yet.
- **Configuration:** `NEXT_PUBLIC_SITE_URL` is a repository variable; the other public `NEXT_PUBLIC_*` values are still repository secrets, which the build reads as a fallback.
- **Dependencies:** Dependabot version updates run weekly with a 7-day cooldown; eleven major-version PRs (#31-#41) are open and belong to Wave 4.
  Dependabot alerts and security updates are off.
  Production dependency audits report zero advisories in both packages; accepted development advisories are in [DEPENDENCY_RISK.md](DEPENDENCY_RISK.md).
- **Repository:** private on GitHub Free, so there is no branch protection, ruleset or environment, and any push to `main` deploys to production.

How deploys work and how to configure them is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Owner actions

Decision numbers (D1-D12) come from the October 2026 assessment; the decisions still open are explained in [ROADMAP.md](ROADMAP.md#owner-decisions).

### Done

| Action | State |
| --- | --- |
| D1 Functions deployment status | Resolved: Functions are not deployed (see above) |
| D3 Firestore index role for the deploy identity | Granted on 2026-10-23; the Firestore indexes job is green from run 40013061416 on |
| D8 Operator, contact, jurisdiction and license | Nathan Watkins, contact@n8builds.dev, California, all rights reserved (#46) |
| Move to `solara-uv.web.app` | Done (#42, #45); `NEXT_PUBLIC_SITE_URL` variable set |
| Firebase Auth authorized domain for `solara-uv.web.app` | Owner reported |
| Search Console ownership of `https://solara-uv.web.app/` | File served (#43); verification owner reported |

### Open

| Action | Where the steps are |
| --- | --- |
| Workload Identity Federation, then delete the key (D4) | [WIF_SETUP.md](WIF_SETUP.md) |
| Move the `NEXT_PUBLIC_*` secrets to repository variables and delete the leftover `NEXT_PUBLIC_SITE_URL` secret | [WIF_SETUP.md](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables) |
| Turn on Dependabot alerts and security updates | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#repository) |
| Google OAuth consent screen publishing and scope verification, and the Calendar OAuth client ID | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#google-sign-in-and-calendar) |
| D2 repository visibility (going public is planned) and the settings that come with it | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#repository) |
| D5 forecast provider licensing, D6 notifications relaunch, D7 guest mode, D9 staging and Stripe test mode, D10 error reporting | [ROADMAP.md](ROADMAP.md#owner-decisions) |
| D11 App Check key and enforcement | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#app-check) |
| Blaze plan, budget alert and Stripe setup before Functions | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#functions-and-stripe) |
| Counsel review of the governing-law language | [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md#legal) |
| D12 local branch and worktree cleanup (8 worktrees remain under `projects/polish/`) | Owner's machine |

## Known test boundary

The signed-in e2e suite runs the real app, rules and Functions against the Firebase emulators, but CI cannot prove Google OAuth consent, App Check with real reCAPTCHA tokens, FCM, APNs or Android notification presentation, Stripe signatures, or third-party calendar refresh timing.
Those checks stay explicit steps in the [owner checklist](OWNER_CHECKLIST.md#release-verification) rather than silent assumptions.

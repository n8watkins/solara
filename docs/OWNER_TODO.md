# Solara: what I need from you

Last updated 2026-11-01, with main at `e520699` (#159).
Everything that can be built without you is merged and live.
The full step-by-step detail (exact console links, how to verify each step) is in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md); this file is the short version, in order.
Tick the boxes as you go and tell me when a group is done, so I can do my follow-up part.

## 1. Before you tell anyone about Solara (about 1 hour, all free)

- [ ] **Test sign-in.** Open https://solara-uv.web.app in a private window and sign in with a Google account that is not a test user.
  If Google says "access blocked", do step 2 first, then try again.
- [ ] **Publish the sign-in app.** Google Cloud console, Google Auth Platform: Branding, "View issues", "I have fixed the issues", Proceed.
  Then Audience, "Publish app".
  Done when the status reads "In production".
- [ ] **Sentry (error reports).** Sign up at sentry.io (US region), create project `solara-web`, turn off storing IP addresses.
  Put the DSN in the GitHub repository variable `NEXT_PUBLIC_SENTRY_DSN`.
  Optional: secret `SENTRY_AUTH_TOKEN` and variables `SENTRY_ORG`, `SENTRY_PROJECT` for readable stack traces.
- [ ] **Uptime check.** In a terminal in the repo: `ALERT_EMAIL=you@example.com infra/monitoring.sh --site-only`, read what it prints, then run it again with `--apply`.
  You get an email if the site goes down.
- [ ] **reCAPTCHA and App Check.** Create a reCAPTCHA v3 key for `solara-uv.web.app`.
  Register it in Firebase console, App Check (the secret key goes only there).
  Put the site key in the GitHub variable `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`.
  Watch the App Check metrics for 7 days, then tell me and we enforce it on Firestore only (never on Authentication).
- [ ] **Lock down the browser key and sign-in settings.**
  Google Cloud console, Credentials: add a website restriction `https://solara-uv.web.app/*` to the browser API key.
  Firebase console, Authentication: remove `localhost` from authorized domains, and check that Google is the only enabled sign-in provider.
- [ ] **Cap Firestore and alert on floods.** Google Cloud console, IAM and admin, Quotas, service `firestore.googleapis.com`: lower the per-minute read and write request quotas to well above normal use.
  Cloud Monitoring: add an alert on Firestore document reads and writes per minute that emails you.
- [ ] **Try automatic deletion of old events.** Run `infra/firestore-ttl.sh`, read it, then `--apply`.
  If it works, tell me: I flip one flag so the privacy policy also promises deletion for people who never come back.
  If Firestore refuses it without billing, tell me that too; nothing else breaks.

## 2. Security housekeeping (about 1 hour, free, any time this week)

- [ ] **Keyless deploys.** Follow [WIF_SETUP.md](WIF_SETUP.md) (I can walk you through it).
  Set variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`, confirm a deploy works, then delete the secret `FIREBASE_SERVICE_ACCOUNT`.
- [ ] **GitHub `production` environment.** Settings, Environments, new environment `production`, deployment branches limited to `main`.
  Then tell me and I attach the deploy jobs to it in a PR.
- [ ] **Move public values from secrets to variables.** Copy each `NEXT_PUBLIC_FIREBASE_*` value, the VAPID key and the GA measurement id into repository variables of the same name, then delete those secrets.
  Also delete the secret `NEXT_PUBLIC_PRO_PRICE` and the duplicate `NEXT_PUBLIC_SITE_URL` secret.
- [ ] **Tighten the ruleset and close old alerts.** In the `main` ruleset: require branches to be up to date and add the CodeQL checks as required.
  Turn on private vulnerability reporting.
  Dismiss CodeQL alerts #22 and #23 and secret-scanning alert #1, and mark GitGuardian incident #106 as a false positive.

## 3. Calendar features (free; Google's review takes days to weeks)

- [ ] **Google Calendar.** Enable the Google Calendar API.
  Create an OAuth "Web application" client with authorized origin `https://solara-uv.web.app`, and put its client ID in the variable `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`.
- [ ] **Google verification.** In the Verification Center, request verification for the calendar scopes, with one justification per scope (texts are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md)) and a demo video (I script it for you).
  For events from Google Calendar, also add `calendar.events.readonly` and `calendar.calendarlist.readonly`, then set `GOOGLE_CALENDAR_EVENTS_ENABLED=true` once verified.
- [ ] **Outlook.** Create a free Azure account and an Entra app registration: single-page app redirect `https://solara-uv.web.app/auth/microsoft/`, permission `Calendars.ReadBasic` only.
  Set the variable `MICROSOFT_CLIENT_ID`, do the live sign-in check in checklist steps 9 and 10, then set `OUTLOOK_CALENDAR_EVENTS_ENABLED=true`.

## 4. Before any promotion (pay as you go, cents a month at small scale)

- [ ] **Blaze plan with the $25 kill switch.** Firebase console, Usage and billing: attach a billing account.
  Run `infra/budget.sh` (read it, then `--apply`) and put the printed `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT` into repository variables.
  On the free plan, a busy day (about 1,000 visitors) switches the site off; on Blaze it costs cents instead, and backups become possible.

## 5. Staging, then the Pro launch (when you are ready to charge)

- [ ] **Staging project.** Create a second Firebase project (for example `solara-staging`) on Blaze with its own budget.
  Follow checklist steps B1 and B1a: a GitHub `staging` environment, the `STAGING_*` variables and the staging deploy identity, which must have no role in the production project.
  Create the environment before adding its secret.
- [ ] **Stripe in test mode on staging,** then we run every Pro check there together (about 2 to 3 hours with me): payments, alerts on a real phone, a restore drill, the budget kill switch at a tiny budget, a compressed request getting refused, a reminder arriving on time.
- [ ] **Production Pro launch, in this order:**
  1. Create the live Stripe webhook first; its address is known in advance: `https://us-central1-uv-activity-planner.cloudfunctions.net/stripeWebhook`.
  2. Set the four Functions secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPEN_METEO_API_KEY`, `TRIAL_HISTORY_KEY`.
  3. First Functions deploy (`NEXT_PUBLIC_FUNCTIONS_URL`, then `ENABLE_BLAZE_FUNCTIONS=true`).
  4. Buy the Open-Meteo Standard plan (about $29 a month) the same day billing goes on, then `FORECAST_PROXY_ENABLED=true`, then `BILLING_ENABLED=true`.
  5. Alerts: enable the Cloud Tasks API, give the deploy identity `roles/cloudtasks.queueAdmin`, rerun `infra/firestore-ttl.sh`, confirm the Firestore region is `nam5` or `us-central1`, then `ALERTS_ENABLED=true`.
  6. I run a final review on the release commit; you do the release checks on a real phone.

## Ongoing rules for you

- Act on an emailed export or deletion request only after the person replies from the account's own email address (the RUNBOOK and `infra/account-request.mjs` walk you through it).
- Before a Google Play listing, check on a real Android device that prices are hidden however the app is opened (launcher, shortcut, notification, share).

## Decisions I took as defaults (tell me to change any)

| Decision | Default |
| --- | --- |
| Launch | Quiet launch on the free plan now; Blaze before any promotion |
| Linked calendars | Pro only |
| Android payments | Pro is sold on the web only; the app unlocks it but never sells it |
| React Compiler | Off (saves about 8 KB of first load; no measurable speed difference) |
| Cloudy days | Protection advice uses clear-sky UV, so it does not relax when clouds may break |
| Hosting download floods on the free plan | Accepted and documented; Blaze or Cloudflare in front fixes it |

## Later, no rush

- Find a native Spanish speaker to review the safety wording (burn times, SPF advice, "seek shade") once the Spanish translation is ready; the language plan is [ROADMAP item 46](ROADMAP.md#46-languages-setup-and-the-app-in-spanish-built); the sheet to review is [i18n/es-review.md](i18n/es-review.md).

- A lawyer reviews the governing-law terms.
- Pick the next feature after languages: a sun exposure log with a vitamin D tally.

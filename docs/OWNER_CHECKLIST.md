# Solara owner checklist

_Last reviewed: 2026-10-28_

This checklist holds what only the owner can do: decisions, credentials, provider consoles, legal facts and real-device evidence, plus the manual checks for each release.
Which items are already done is tracked in [status.md](status.md#owner-actions); the decisions and the roadmap items that need them are in [ROADMAP.md](ROADMAP.md#decisions).
How deploys and configuration work is in [DEPLOYMENT.md](DEPLOYMENT.md).

Never paste a secret into an issue, pull request, repository file or chat message.
When an item is done, tell the repository agent which section changed, without the secret values; the agent can then redeploy, inspect logs and run the automated checks.

## Next steps, in order

_As of 2026-10-28, checked against `deploy.yml`, `check-public-env.mjs`, `functions/.env` and the live GitHub variables and secrets (REVIEW8)._
Do these from the top, in four groups: **A** anytime (free, no Blaze), **B** staging (before the Pro launch), **C** the Pro launch in production, and **D** one row per feature switch.
Each step says what it unlocks, where to go, what to copy where, how long it takes, what it costs and how to check it worked.
Everything sent to the agent here is a public identifier, not a secret.

Already done: the domain move to `solara-uv.web.app`, the Firestore index role (D3), the operator details (D8), making the repository public with its ruleset (D2), Search Console verification, the second authorized domain, the OAuth scopes, Dependabot alerts, confirming the price and tiers, and the local branch and worktree clean-up (D12: only the main clone and the current review worktrees remain).

Two things apply to every step that sets a repository variable:

- **Trigger a deploy:** merge anything to `main`, or run `gh workflow run deploy.yml --repo n8watkins/solara --ref main`.
- **Check a build value made it:** the Deploy run's "Check the public build configuration" step is green, then the live site shows the new feature.
  That step fails the deploy when a value is missing or contradicts another one (for example Functions without the App Check site key, alerts without the VAPID key, or any App Check debug token), so a red step names what to fix.

### Anytime: free, no Blaze

A1. **Check that anyone can sign in (5 minutes, free).**
   - Unlocks: the whole Free plan; while the Google sign-in app is in **Testing**, only listed test users can sign in and everyone else gets Google's "Access blocked" page, so Free silently becomes guest-only (REVIEW8 QA M5).
   - Do: in a private window, open https://solara-uv.web.app/app/, press **Sign in** and use a Google account that is **not** listed as a test user at https://console.cloud.google.com/auth/audience?project=uv-activity-planner.
   - Verify: the account signs in and the dashboard shows it; if Google blocks it, do A5 (Publish) now and try again, and treat it as a launch blocker until it works.

A2. **Enable the Google Calendar API (1 minute, free).**
   - Unlocks: Scheduled activities and adding events to Google Calendar (with A3).
   - Where: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=uv-activity-planner, click **Enable**.
   - Verify: the page shows **Manage**, which means it is on.

A3. **Create the OAuth web client and set its ID (5 minutes, free).**
   - Unlocks: "Connect Google Calendar" and Scheduled for Free and Pro accounts.
   - Where: https://console.cloud.google.com/auth/clients?project=uv-activity-planner, open the **Web application** client (or **Create client**, type **Web application**, name "Solara web").
   - Copy: under **Authorized JavaScript origins**, make sure `https://solara-uv.web.app` is the only origin and save; then copy the **Client ID** (it ends in apps.googleusercontent.com) to the repository variable: `gh variable set NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID --repo n8watkins/solara --body "<client id>"`.
     It is a public client ID; there is no client secret to store.
   - Verify: after the next deploy, a signed-in dashboard offers **Connect Google Calendar**.

A4. **Resubmit branding (2 minutes, free).**
   - Unlocks: Google's review of the app name, logo and links, which scope verification (A6) needs.
   - Where: first confirm https://solara-uv.web.app/privacy/ shows the operator and the "How Solara uses Google user data" section, then at https://console.cloud.google.com/auth/branding?project=uv-activity-planner choose **View issues**, **I have fixed the issues**, **Proceed**.
   - Verify: the branding status reads **Verified** or **In review**.

A5. **Publish the sign-in app (1 minute, free).**
   - Unlocks: sign-in for every Google account, not only test users.
   - Where: https://console.cloud.google.com/auth/audience?project=uv-activity-planner; if the status is **Testing**, click **Publish app** and confirm.
   - Verify: the status reads **In production**; send the agent a screenshot, and repeat A1.

A6. **Request verification of the two Calendar scopes (15 minutes, then days to weeks; free).**
   - Unlocks: Scheduled without Google's "unverified app" warning and without the 100-user cap on unverified sensitive scopes.
   - Where: Google Auth Platform, **Verification Center**, after A4 passes.
   - Copy: request `calendar.freebusy` and `calendar.events.owned`, with the demo video (the agent can script it) and one justification per scope, both in [Google sign-in and Calendar](#google-sign-in-and-calendar).
   - Verify: the Verification Center shows **Verified**.
   - Showing events already in Google Calendar is a separate, later request ([D](#per-feature-switch)), so it cannot delay this one.

A7. **Turn on App Check with reCAPTCHA v3 (15 minutes, then a week of watching).**
   - Unlocks: bot protection for Firestore; it is also a hard prerequisite for every Function (C1), because each one refuses requests without an App Check token.
   - Cost: free up to 10,000 reCAPTCHA assessments a month, then a flat $8 up to 100,000 ([COSTS.md](COSTS.md)).
     App Check starts only after sign-in and its token lasts an hour, so assessments are roughly signed-in session-hours: about 3,000 a month at 100 daily users, about 30,000 ($8) at 1,000.
   1. Create the key at https://www.google.com/recaptcha/admin/create while signed in as the owner: label `Solara web`, type **Score based (v3)**, domain `solara-uv.web.app` (only that one; local development uses App Check debug tokens instead of `localhost`), Google Cloud project `uv-activity-planner`. Submit, then copy the **site key** and the **secret key**.
   2. Register it with Firebase at https://console.firebase.google.com/project/uv-activity-planner/appcheck, **Apps** tab: open the web app, choose **reCAPTCHA**, paste the **secret key** (it goes only here), keep the token time to live at **1 hour**, and **Save**.
   3. Set the public **site key** as a repository variable: `gh variable set NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY --repo n8watkins/solara --body "<site key>"`.
      Leave `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` unset; v3 is the default.
      The next deploy turns App Check on for signed-in users.
   4. Monitor before enforcing: in App Check, **APIs** tab, open **Cloud Firestore** and watch the request metrics for at least 7 days.
      Verified requests should be nearly all signed-in traffic; "Unverified: outdated client" should fall toward zero as old tabs and installed copies update.
   5. Do not click **Enforce** until the agent has checked the metrics with you.
      Then enforce **Cloud Firestore** only.
      Never enforce **Authentication**: App Check starts after sign-in, so enforcing it there would block sign-in itself.
      Cloud Functions enforce App Check in their code already.
   - Verify: App Check, **APIs**, **Cloud Firestore** shows verified requests after the deploy.

A8. **Create a Sentry project and a free uptime check (15 minutes, free).**
   - Unlocks: error reports from real browsers and an email when the site is down; today nothing tells you when the site breaks (REVIEW8 QA H2).
   - Cost: Sentry's free Developer plan covers 5,000 errors a month and keeps events for 30 days.
   1. Sign up at https://sentry.io/signup/ and choose the **United States** data storage location (the privacy policy says providers process data in the United States).
   2. Create a project: platform **Next.js**, name `solara-web`, alert on every new issue.
   3. In the project's **Settings**, **Security & Privacy**: keep **Data Scrubber** and **Use Default Scrubbers** on, turn on **Prevent Storing of IP Addresses**, and set **Allowed Domains** to `solara-uv.web.app`, so events from anywhere else are dropped.
   4. In **Settings**, **Client Keys (DSN)**, copy the **DSN** (public) to the repository variable: `gh variable set NEXT_PUBLIC_SENTRY_DSN --repo n8watkins/solara --body "<DSN>"`.
   5. For readable stack traces, create an organization token in **Settings**, **Developer Settings**, **Organization Tokens** (name `solara-deploy`), then:
      `gh secret set SENTRY_AUTH_TOKEN --repo n8watkins/solara` (paste the token when asked; it is a secret),
      `gh variable set SENTRY_ORG --repo n8watkins/solara --body "<organization slug>"` and
      `gh variable set SENTRY_PROJECT --repo n8watkins/solara --body solara-web`.
      With all four set, each deploy uploads source maps to Sentry and removes them from the published site.
   6. The uptime check, which needs no Functions: `ALERT_EMAIL=<your email> infra/monitoring.sh --site-only` prints the commands for one check on `https://solara-uv.web.app/app/` every 5 minutes and its email alert; read them, then run it again with `--apply` from a shell signed in as the owner (`gcloud auth login`).
      If Google Cloud asks for a billing account, use any free external monitor on the same page with an email alert instead ([runbook](RUNBOOK.md#watching-the-site)).
   - Verify: the deploy log says "Source maps will be uploaded"; the agent sends a test error, which arrives with no personal data in it; the uptime check at https://console.cloud.google.com/monitoring/uptime?project=uv-activity-planner is green and its email channel is verified.

A9. **Restrict the browser API key to Solara's sites (5 minutes, free).**
   - Unlocks: other websites can no longer spend the project's Auth and Firestore quotas with the public key (REVIEW8 SEC L8); the key already has API restrictions.
   - Where: https://console.cloud.google.com/apis/credentials?project=uv-activity-planner, open the **Browser key** (the one whose value is `NEXT_PUBLIC_FIREBASE_API_KEY`).
   - Copy: under **Application restrictions**, choose **Websites** and add `https://solara-uv.web.app/*` and `https://uv-activity-planner.firebaseapp.com/*` (the sign-in helper's address); keep the **API restrictions** as they are; save.
     For development against the real project, create a separate key restricted to `http://localhost/*`, and put only that one in `.env.local`.
   - Verify: after about 5 minutes, sign in on production in a private window; the agent can confirm that a request with another site's `Referer` is now refused.

A10. **Tighten Firebase Authentication (3 minutes, free).**
   - Unlocks: a sign-in can no longer complete on a page served from someone's own machine, and no other way to create an account exists.
   - Where: https://console.firebase.google.com/project/uv-activity-planner/authentication/settings, **Authorized domains**.
   - Copy: remove `localhost` (development uses the Auth emulator); keep `solara-uv.web.app`, `uv-activity-planner.firebaseapp.com` and `uv-activity-planner.web.app`.
     Then open **Sign-in method** (https://console.firebase.google.com/project/uv-activity-planner/authentication/providers) and check that **Google** is the only enabled provider: no **Anonymous**, no **Email/Password**.
   - Verify: sign-in on production still works; tell the agent which providers were listed.

A11. **Cap Firestore traffic and get an email when it spikes (15 minutes, free).**
   - Unlocks: today any signed-in account can loop reads and writes on its own data until the project's free Firestore quota (20,000 writes and 50,000 reads a day) is gone for everyone (REVIEW8 SEC M2); a cap limits the damage and the alert tells you within minutes.
   - Where: https://console.cloud.google.com/apis/api/firestore.googleapis.com/quotas?project=uv-activity-planner.
   - Copy: lower the per-minute request quotas listed there to a level well above real use (ask the agent for the numbers from the Firestore usage page; if the page does not let you edit them on Spark, do it right after C2).
     Then at https://console.cloud.google.com/monitoring/alerting?project=uv-activity-planner, **Create policy**: metric `firestore.googleapis.com/document/write_count`, rolling 5 minutes, above a threshold the agent suggests from normal traffic, with your email as the notification channel; add a second condition for `document/read_count`.
   - Verify: the policy is listed as enabled, and the quota page shows your new values.

A12. **Try the record expiry (TTL) policies now (5 minutes, free).**
   - Unlocks: Firestore deletes imported events 30 days after they end even for people who never come back, which the privacy policy promises (REVIEW8 SEC M3).
   - Where: a shell signed in as the owner (`gcloud auth login`): `infra/firestore-ttl.sh` prints the commands; read them, then `infra/firestore-ttl.sh --apply`.
   - Verify: `gcloud firestore fields ttls list --project uv-activity-planner` lists `expireAt` for each collection group in the script.
     Then tell the agent, who sets `PRODUCTION_DATA_STEPS.firestoreTtl` in `lib/privacy-retention.ts`, so the privacy policy adds that Firestore deletes ended events even for people who never come back.
     If gcloud refuses because the project has no billing, nothing else is needed now: the policy already promises only deletion on the next signed-in visit, and C8 runs the script again.

A13. **Create the GitHub `production` environment (5 minutes plus a PR, free).**
   - Unlocks: GitHub itself keeps the deploy credentials away from every branch except `main`; today any pushed branch could read the repository-level deploy key with a changed workflow (REVIEW8 SEC M5).
   - Where: https://github.com/n8watkins/solara/settings/environments, **New environment**, name `production`, **Deployment branches and tags** set to `main` only (optionally a required reviewer).
   - Then ask the agent to attach the deploy jobs to it, and once that is merged, move `FIREBASE_SERVICE_ACCOUNT` (while it is still used) and `SENTRY_AUTH_TOKEN` into the environment and delete the repository-level copies.
   - Verify: the environment is listed, and the next deploy's jobs show "production".

A14. **Keyless deploys, then delete the old key (15-30 minutes with the agent, free).**
   - Unlocks: no long-lived Google key in GitHub at all (D4).
   - Where: follow [WIF_SETUP.md](WIF_SETUP.md) together; it ends by setting the variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`.
   - Then delete the `FIREBASE_SERVICE_ACCOUNT` key in Google Cloud and the secret in GitHub.
   - Verify: the deploy jobs log "Authenticating with Workload Identity Federation" and no key warning.

A15. **Move public build values to GitHub variables (10 minutes, free).**
   - Unlocks: readable deploy logs and fewer secrets; public values do not need hiding.
   - Where: `firebase apps:sdkconfig web --project uv-activity-planner` prints the Firebase web values; the VAPID key is at Firebase **Project settings**, **Cloud Messaging**, **Web Push certificates**; the GA id at Google Analytics **Admin**, **Data streams**.
   - Copy: set the variables `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY` and `NEXT_PUBLIC_GA_MEASUREMENT_ID`, then delete each secret of the same name and the leftover `NEXT_PUBLIC_SITE_URL` secret ([steps](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables)).
   - Verify: `gh secret list --repo n8watkins/solara` shows only real secrets, and the next deploy is green.

A16. **Delete the unused `NEXT_PUBLIC_PRO_PRICE` secret (1 minute, free).**
   - Prices live in `lib/plans.ts` since #71, so nothing reads it: `gh secret delete NEXT_PUBLIC_PRO_PRICE --repo n8watkins/solara`.
   - Verify: it is gone from `gh secret list` (it is still there on 2026-10-28).

A17. **Harden the "Protect main" ruleset and Actions settings (10 minutes, free).**
   - Unlocks: a pull request can no longer merge on green checks from an older `main` (this broke `main` once), CodeQL can no longer be skipped, and GitHub enforces the pinned actions (REVIEW8 SEC L6, QA L10).
   - Where: https://github.com/n8watkins/solara/settings/rules, open **Protect main**.
   - Copy: under **Require status checks to pass**, tick **Require branches to be up to date before merging**, and add `Analyze (javascript-typescript)` and `Analyze (actions)` to the required checks; save.
     Then at https://github.com/n8watkins/solara/settings/actions, under **Actions permissions**, tick **Require actions to be pinned to a full-length commit SHA** (every action already is); save.
   - Cost: up-to-date branches mean a pull request reruns its checks after each merge ahead of it, which is the point.
   - Verify: the ruleset lists 10 required checks; the next pull request shows "This branch is out-of-date" when `main` moved.

A18. **Turn on private vulnerability reporting (1 minute, free).**
   - Unlocks: reporters can use GitHub's private form instead of email ([SECURITY.md](../SECURITY.md)).
   - Where: https://github.com/n8watkins/solara/settings/security_analysis, **Private vulnerability reporting**, **Enable**.
   - Verify: https://github.com/n8watkins/solara/security shows **Report a vulnerability**.

A19. **Close the three open security alerts (5 minutes, free; after A9).**
   - Unlocks: open alerts that are never closed train everyone to ignore new ones.
   - Where and what:
     - https://github.com/n8watkins/solara/security/code-scanning/22 (`lib/microsoft-redirect.ts`): **Dismiss alert**, **False positive**, comment "The prefix is the constant solara-microsoft-auth:, not user input."
     - https://github.com/n8watkins/solara/security/code-scanning/23 (`tests/e2e/microsoft-sign-in.spec.ts`): **Dismiss alert**, **Used in tests**, comment "Test code; same constant prefix."
     - https://github.com/n8watkins/solara/security/secret-scanning/1 (the Firebase web key in an old service worker commit): **Close as**, **Won't fix**, comment "Public Firebase web API key, shipped to every browser by design; API and website restrictions are on."
   - Verify: https://github.com/n8watkins/solara/security shows no open alerts.

A20. **Small clean-ups (5 minutes, free).**
   - In the GitGuardian dashboard, mark incident #106 as a false positive.
   - Optionally delete the `notificationDevices.enabled` field override at https://console.firebase.google.com/project/uv-activity-planner/firestore/indexes (**Single field** tab).
   - The `GCP_NOTIFIER_SERVICE_ACCOUNT` variable is already gone; at https://console.cloud.google.com/iam-admin/serviceaccounts?project=uv-activity-planner, delete the `solara-notifier` service account if it exists.

A21. **Have counsel review the governing-law language** in the terms ([Legal](#legal)); a lawyer's fee, no other cost.

Optional at any time: [Events from Outlook](#events-from-outlook-only-for-the-outlook-connection) (group D) needs nothing else first.

### Staging: before the Pro launch

**B0 is engineering, not an owner step, and must be done first.**
Today nothing can deploy to a second project: `firebase.json` fixes the Hosting site to production's `solara-uv`, `.firebaserc` and `deploy.yml` know one project, and `functions/.env` hard-codes production's `APP_URL`, so the Functions' exact-origin CORS would refuse a staging site (REVIEW8 PLAN H1).
Ask an agent for [ROADMAP item 34](ROADMAP.md#34-staging-deploy-before-the-pro-launch-next-up) (a Hosting target and `APP_URL` per project, and a workflow that deploys `main` to the staging project), plus PR preview channels (D9); "test in staging first" means testing in production until it is merged.

B1. **Create the staging Firebase project on Blaze (15 minutes, free within quotas).**
   - Where: https://console.firebase.google.com, **Add project** (for example `solara-staging`), then **Upgrade** to Blaze with the same billing account.
   - Copy: its web app config (`firebase apps:sdkconfig web --project solara-staging`) to the agent, as staging values, never as production's repository variables.
   - Verify: the project is listed with the Blaze plan.

B2. **Budget for staging (10 minutes, free).**
   - Where: `PROJECT_ID=solara-staging BILLING_ACCOUNT=<billing account id> DEPLOY_SA=<staging deploy service account> infra/budget.sh`, read the commands, then the same with `--apply`.
   - Copy: the two printed values go into the staging configuration the agent sets up in B0, not production's variables.
   - Verify: the budget is listed at https://console.cloud.google.com/billing.

B3. **Staging sign-in and keys (20 minutes, free).**
   - Where: in the staging project, Firebase **Authentication** (enable only the **Google** provider, add the staging site as an authorized domain), App Check (its own reCAPTCHA v3 key for the staging domain, as in A7) and **Cloud Messaging** (its own Web Push certificate, the VAPID key).
   - Copy: the reCAPTCHA site key and the VAPID key to the agent; the reCAPTCHA secret key goes only into the staging App Check page.
   - Verify: sign-in works on the staging site.

B4. **Stripe test mode: product, webhook first, then its secrets (30 minutes, free in test mode).**
   - Where: https://dashboard.stripe.com/test/products and https://dashboard.stripe.com/test/webhooks.
   - Copy, in this order:
     1. Product **Solara Pro** with two recurring prices, **$2.99 per month** and **$19.99 per year** (no trial on the prices; checkout adds the 7-day trial); the two price ids to the agent for staging.
     2. **Add endpoint** before any Functions deploy: its address is known in advance, `https://us-central1-solara-staging.cloudfunctions.net/stripeWebhook` (use the staging project's id), API version `2026-09-30.endive`, and the seven events listed in [DEPLOYMENT.md](DEPLOYMENT.md#refunds-disputes-and-failed-payments).
        Deliveries fail until the Functions exist, which is harmless while there is no checkout.
     3. Copy the endpoint's **Signing secret** (`whsec_...`) and the test **Secret key** (`sk_test_...`) into the staging project's Secret Manager: `npx firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project solara-staging` and the same for `STRIPE_SECRET_KEY`.
   - Verify: Stripe lists the endpoint; later, in B6, a test checkout grants Pro.

B5. **The other Functions secrets in staging (5 minutes).**
   - Where: `npx firebase functions:secrets:set OPEN_METEO_API_KEY --project solara-staging` (type `unset`), and `openssl rand -base64 48 | npx firebase functions:secrets:set TRIAL_HISTORY_KEY --data-file=- --project solara-staging`.
   - Cost: Secret Manager keeps 6 secret versions free, then about $0.06 per version a month.
   - Verify: the first staging Functions deploy succeeds (a deploy fails while any secret is missing).

B6. **Run the staging checks (2-3 hours with the agent, cents).**
   - With the agent: the [Functions and Stripe](#functions-and-stripe), [Notifications](#notifications) and [Linked calendars](#linked-calendars) checks, `infra/check-client-address.sh` (it must end with `OK`), each `infra/` script from C8, one alert fired from a forced failure, the budget kill switch fired once at a tiny budget, and one restore drill recorded in the [runbook](RUNBOOK.md#backups-and-restore).
   - Verify: every check in those sections is ticked.

### At Pro launch: Blaze

This is group C, in production, after B6.
Compared with the old order, the Open-Meteo key now comes before billing (REVIEW8 PLAN M1), the Stripe webhook endpoint before the first Functions deploy (M2), and App Check is a hard prerequisite (M3, also enforced by the deploy's env check).
Account download and deletion already work on Spark: the account page does both in the browser ([ROADMAP item 33](ROADMAP.md#33-account-download-and-deletion-without-functions-fix8b-built)), and from C7 the Functions take over, which also end billing.
An emailed request, for example from an account the browser path refuses, is answered with `infra/account-request.mjs` as the [runbook](RUNBOOK.md#an-emailed-export-or-deletion-request) describes.

C1. **Prerequisites.**
   - A7 (App Check) is done and live, and A14 (keyless deploys) is done, because C3 and C4 need the deploy service account.
   - Verify: `gh variable list --repo n8watkins/solara` shows `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` and `GCP_DEPLOY_SERVICE_ACCOUNT`.

C2. **Upgrade to Blaze (5 minutes; pay as you go).**
   - Where: https://console.firebase.google.com/project/uv-activity-planner/usage/details, attach the billing account.
   - Cost: a few cents a month below about 300 daily users ([COSTS.md](COSTS.md)).
   - C2 and C3 can come earlier, without any Functions, if a promoted free launch is planned: on Spark a busy day stops the site instead of costing cents (REVIEW8 QA H1).
   - Verify: the usage page shows the Blaze plan.

C3. **Budget and kill switch (15 minutes, free).**
   1. From a shell signed in as the owner (`gcloud auth login`), print the commands first, read them, then run them: `BILLING_ACCOUNT=<billing account id> DEPLOY_SA=<deploy service account email> infra/budget.sh`, then the same with `--apply`.
      The billing account id is on https://console.cloud.google.com/billing; the deploy service account is the one from [WIF_SETUP.md](WIF_SETUP.md).
      It creates a **$25** monthly budget with emails at 50%, 90%, 100% and 300% (defaults, owner may change: `BUDGET_AMOUNT=40USD` for another amount).
   2. Copy the two printed values, `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT`, to repository variables, so the kill switch acts only on this budget and runs as the identity that alone may detach billing.
   3. The kill switch then warns at 50% of the budget, pauses the traffic-driven paths at 100% until the next month, and detaches billing at 300% ($75 by default), which stops the Functions while Hosting keeps serving the site ([runbook](RUNBOOK.md#budget-kill-switch)).
      That hard stop is on by default (default, owner may change); to keep spending instead, run the script with `DETACH_BILLING=false` and set the `COST_GUARD_DETACH_BILLING` repository variable to `false`.
      Know what it costs: a sustained flood can spend about $550 a day ([worst case under a flood](COSTS.md#worst-case-under-a-flood)), so $75 can be reached within hours, and a detach stops every Function, checkout and the Stripe webhook included, until billing is re-attached.
      Stripe retries a failed webhook for only 3 days, so after a detach follow [within 3 days of a detach](RUNBOOK.md#budget-kill-switch) in the runbook: re-attach, redeploy, then resend the failed webhook events.
   - Verify: the budget at https://console.cloud.google.com/billing shows $25 with the four thresholds.
   - If A11's quota page could not be edited on Spark, do A11 now.

C4. **Extra deploy roles and log exclusions (10 minutes, free).**
   1. Grant the deploy identity the extra Functions roles ([WIF_SETUP.md](WIF_SETUP.md#extra-roles-when-functions-are-enabled)).
   2. Run `infra/logging.sh`, read the commands, then `--apply`, so calendar feed links never reach the request logs and most rejected-request logs are dropped ([Keep feed tokens out of request logs](DEPLOYMENT.md#keep-feed-tokens-out-of-request-logs)).
   - Verify: the first Functions deploy (C7) reports no permission error, and the Logs Router page shows the exclusions on the `_Default` sink.

C5. **Stripe live mode: product, portal and webhook endpoint (30 minutes).**
   - Where: https://dashboard.stripe.com/products and https://dashboard.stripe.com/webhooks, in live mode.
   - Copy: the same as B4, with the production address `https://us-central1-uv-activity-planner.cloudfunctions.net/stripeWebhook` (known in advance; create it now, before C7, so its signing secret exists), API version `2026-09-30.endive` and the seven events.
     The two live price ids go to the variables: `gh variable set STRIPE_PRICE_ID --repo n8watkins/solara --body <monthly price id>` and the same for `STRIPE_YEARLY_PRICE_ID`.
   - Also: the customer portal and the Smart Retries settings in [Functions and Stripe](#functions-and-stripe).
   - Cost: 2.9% + $0.30 per card payment, plus 0.7% for Stripe Billing, about $0.41 of each $2.99.
   - Verify: Stripe lists the endpoint (its deliveries fail until C7, which is harmless).

C6. **The four Functions secrets (5 minutes, free).**
   - `npx firebase functions:secrets:set STRIPE_SECRET_KEY --project uv-activity-planner` (the live `sk_live_...` key) and the same for `STRIPE_WEBHOOK_SECRET` (the `whsec_...` signing secret of C5's endpoint).
   - `OPEN_METEO_API_KEY` with the value `unset` for now (C9 replaces it).
   - The trial history's random key: `openssl rand -base64 48 | npx firebase functions:secrets:set TRIAL_HISTORY_KEY --data-file=- --project uv-activity-planner` (never rotate it unless it leaks: a new key forgets every recorded trial).
   - Verify: `npx firebase functions:secrets:get STRIPE_WEBHOOK_SECRET --project uv-activity-planner` (and the same for the other three) shows a version.

C7. **First Functions deploy (20 minutes, free within quotas).**
   - Copy: set the repository variables `NEXT_PUBLIC_FUNCTIONS_URL` (`https://us-central1-uv-activity-planner.cloudfunctions.net`) and then `ENABLE_BLAZE_FUNCTIONS=true`; leave `BILLING_ENABLED` and `FORECAST_PROXY_ENABLED` unset.
     The next deploy publishes the Functions (it sets the Artifact Registry cleanup policy itself); checkout still shows the waitlist and forecasts still come straight from Open-Meteo.
   - Verify: the deploy is green; the account page's download and deletion now go through the Functions; `infra/check-client-address.sh` ends with `OK` ([Check the client address](DEPLOYMENT.md#check-the-client-address-at-the-first-deploy)); then run the calendar feed token migration ([Calendar feed tokens](DEPLOYMENT.md#calendar-feed-tokens)).

C8. **Monitoring, backups and record expiry (20 minutes, cents for backups).**
   From a shell signed in as the owner, print each script's commands, read them, then run it again with `--apply`:
   1. `CHANNEL=<the channel's name> infra/monitoring.sh --functions-only`: the Functions' uptime check and the error alert policy, on the email channel A8's `--site-only` run created (`gcloud beta monitoring channels list --project uv-activity-planner` shows its name); without A8's run, `ALERT_EMAIL=<your email> infra/monitoring.sh` creates everything at once ([runbook](RUNBOOK.md#alerts)).
   2. `infra/backups.sh`: point-in-time recovery, delete protection, daily backups and the image cleanup policy; then tell the agent, who sets `PRODUCTION_DATA_STEPS.backups` in `lib/privacy-retention.ts`, so the privacy policy names the backups.
   3. `infra/firestore-ttl.sh`: the TTL policies that delete expired records ([runbook](RUNBOOK.md#record-retention)), if A12 could not apply them; then the same `PRODUCTION_DATA_STEPS.firestoreTtl` change as in A12.
   - Verify: the uptime checks are green; the `maintenance` job runs without `maintenance task ... failed` errors and its indexes are `READY`.

C9. **Buy the Open-Meteo Standard plan and set its key, before billing (10 minutes, about $29 a month).**
   - Why now: once `BILLING_ENABLED` is true, the calendar feed stops using the free API; with the key still `unset`, every Free and Pro feed serves only what is cached and then fails until the key arrives, and Pro alerts cannot be switched on (REVIEW8 PLAN M1).
     So the plan starts a few days before the first subscriber instead of after it (D5).
   - Where: https://open-meteo.com/en/pricing, then `npx firebase functions:secrets:set OPEN_METEO_API_KEY --project uv-activity-planner` and paste the API key from the Open-Meteo dashboard.
   - Copy: then `gh variable set FORECAST_PROXY_ENABLED --repo n8watkins/solara --body true`.
     The next deploy redeploys the Functions with the key and builds the app to fetch through the proxy.
   - With the proxy on, guests load App Check too, so reCAPTCHA assessments grow with guest traffic ([COSTS.md](COSTS.md)); the privacy policy's reCAPTCHA line follows this switch by itself.
   - Verify: the dashboard still loads a forecast and setup still suggests places in a private window, and the `forecast` Function's logs show no `forecast served from the last good copy` warnings.

C10. **Switch Pro billing on (2 minutes).**
   - Copy: `gh variable set BILLING_ENABLED --repo n8watkins/solara --body true`, and let the next deploy run.
     Setting it to anything else brings the waitlist back.
   - Verify: the plans dialog offers the 7-day trial instead of the waitlist.

C11. **Pro alerts (10 minutes, FCM is free).**
   - Optionally give them their own least-privilege identity: `DEPLOY_SA=<deploy service account email> infra/alerts-identity.sh` (print, read, then `--apply`) and `gh variable set ALERTS_SERVICE_ACCOUNT --repo n8watkins/solara --body solara-alerts@uv-activity-planner.iam.gserviceaccount.com`.
   - Then `gh variable set ALERTS_ENABLED --repo n8watkins/solara --body true` and let the next deploy run ([Pro alerts](DEPLOYMENT.md#pro-alerts)); the env check refuses it without the VAPID key.
   - Verify: a real phone gets exactly one morning alert ([Notifications](#notifications)).

C12. **Release checks (30 minutes).**
   Run [Release verification](#release-verification), plus [Functions and Stripe](#functions-and-stripe) and [Notifications](#notifications) on production.

### Per feature switch

Group D: each optional feature, what it needs first and how to switch it on.

| Switch | Needs first | Owner steps | Value and where | Time | Cost | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| Google Calendar (Scheduled) | A2, A3 | A4-A6 | Variable `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | See A | Free | [Google sign-in and Calendar](#google-sign-in-and-calendar) checks |
| Events from Google Calendar | A6 verified | [Events from Google Calendar](#events-from-google-calendar) items 1-6: two more scopes, a video on a preview or staging build, verification | Variable `GOOGLE_CALENDAR_EVENTS_ENABLED=true`, no Blaze | 20 min, then days to weeks | Free | Item 7 there |
| Events from Outlook | Nothing else | [Events from Outlook](#events-from-outlook-only-for-the-outlook-connection) items 1-10: free Azure account, app registration, a dev registration and the live checks (`npm ci` and `npm ci --prefix functions` first) | Variables `MICROSOFT_CLIENT_ID`, then `OUTLOOK_CALENDAR_EVENTS_ENABLED=true`, no Blaze | 45 min | Free (a temporary $1 card hold) | Items 9-11 there |
| Linked calendars and heads-ups | C7, C11 | [Linked calendars](#linked-calendars) checks in staging | Variable `EVENTS_SUBSCRIPTIONS_ENABLED=true` | 10 min | Cents | Those checks on production |
| Pro alerts | C7, C9 (the key) | C11 | Variable `ALERTS_ENABLED=true` | 10 min | Free | [Notifications](#notifications) |

Values with no owner step, fine as they are: `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` (leave unset), `COST_GUARD_DETACH_BILLING` (optional), and the committed per-hour and per-day limits in `functions/.env`.

### Later: mobile app (Wave 6)

- Create a Google Play developer account ($25 once) and, for iOS later, an Apple Developer account ($99 per year).
- A new personal Play account must run a closed test with at least 12 testers for 14 days before its first production release, so start that clock early; [integrations/ANDROID.md](integrations/ANDROID.md) has the Android plan and the owner steps it will need.

## Repository

- [x] Make the repository public (D2, 2026-10-23).
- [x] "Protect main" ruleset: pull requests, squash merges only, 8 required checks.
- [x] Secret scanning with push protection, CodeQL default setup, Dependabot alerts and security updates.
- [ ] Require up-to-date branches, add the two CodeQL checks to the required checks, and require SHA-pinned actions ([A17](#anytime-free-no-blaze)).
- [ ] Private vulnerability reporting ([A18](#anytime-free-no-blaze)).
- [ ] Close CodeQL alerts #22 and #23 and secret scanning alert #1 ([A19](#anytime-free-no-blaze)).
- [ ] A `production` environment limited to `main` ([A13](#anytime-free-no-blaze)); ask the agent to attach the deploy jobs to it, and once that is merged, move the `FIREBASE_SERVICE_ACCOUNT` and `SENTRY_AUTH_TOKEN` secrets into the environment.
      The deploy workflow already refuses to deploy from any other branch, but a repository secret can still be read by a changed workflow on any pushed branch; the environment closes that.

## Credentials

- [ ] Run [WIF_SETUP.md](WIF_SETUP.md) so deploys use short-lived credentials.
- [ ] Delete the `FIREBASE_SERVICE_ACCOUNT` key and secret once deploys run on WIF (D4).
- [x] The GitHub Actions notifier is retired, and its `GCP_NOTIFIER_SERVICE_ACCOUNT` variable is gone.
- [ ] Delete the `solara-notifier` service account in Google Cloud if it exists ([A20](#anytime-free-no-blaze)).
- [ ] Restrict the browser API key to Solara's two sites ([A9](#anytime-free-no-blaze)).
- [ ] Move every `NEXT_PUBLIC_*` secret to a repository variable, then delete the secret, including the leftover `NEXT_PUBLIC_SITE_URL` secret ([steps](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables)).
- [ ] Delete the unused `NEXT_PUBLIC_PRO_PRICE` variable or secret ([A16](#anytime-free-no-blaze)).

## Google sign-in and Calendar

- [x] `solara-uv.web.app` and `uv-activity-planner.firebaseapp.com` are authorized domains (owner reported).
- [ ] `localhost` is removed from the authorized domains, and Google is the only enabled sign-in provider ([A10](#anytime-free-no-blaze)).
- [ ] A Google account that is not a test user can sign in on production ([A1](#anytime-free-no-blaze)).
- [x] Search Console verifies `https://solara-uv.web.app/` for the OAuth branding review (2026-10-23, owner reported).
- [x] The OAuth scopes are added: `openid`, `userinfo.email`, `userinfo.profile`, `calendar.freebusy`, `calendar.events.owned` (owner reported).
- [ ] Finish the OAuth consent screen: data access lists only `https://www.googleapis.com/auth/calendar.freebusy` and `https://www.googleapis.com/auth/calendar.events.owned`, the privacy policy link points at `https://solara-uv.web.app/privacy/`, and the app is published.
- [ ] Submit the two Calendar scopes for verification and answer Google's review.
      For `calendar.freebusy`, the justification is: Solara reads only busy and free times on the calendars the person connects, to suggest lower-UV windows when they are free; it never reads event details.
      For `calendar.events.owned`, the justification is: Solara creates an event for a lower-UV window the person picks, stores its id, time, title and link to show it as Scheduled, and later reads, moves or deletes only events it created (found by a private extended property).
- [ ] Create a Google OAuth web client with `https://solara-uv.web.app` as an Authorized JavaScript origin, and store its client ID as the `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` repository variable.
      This is a public client ID; there is no client secret to store.
- [ ] With a controlled Google account on production:
  - connecting asks only for `calendar.freebusy`, and only busy times are read;
  - creating an event asks for `calendar.events.owned` at that moment, and the event has the expected date, time, time zone and description;
  - the window then shows as Scheduled; "Open in Google Calendar" opens that event, "Change time" moves it, and "Remove from calendar" deletes it;
  - moving or deleting the event in Google Calendar shows in Solara after "Reconnect to sync", and a second signed-in device shows the same Scheduled items;
  - revoking access leaves Solara in a clean disconnected state.

## App Check

Decision D11 is reCAPTCHA v3; the steps are [A7](#anytime-free-no-blaze) above, and how it works is in [App Check](DEPLOYMENT.md#app-check).
The code also supports reCAPTCHA Enterprise through `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER=recaptcha-enterprise`, if that is ever needed.
Functions require App Check in code, so the site key is needed before any Function-backed surface is turned on; the deploy's env check refuses `ENABLE_BLAZE_FUNCTIONS=true` without it.

- [ ] Create the reCAPTCHA v3 key and register it for the web app under App Check in the Firebase console.
- [ ] Store the site key as the `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` variable.
- [ ] Enforce App Check for Cloud Firestore only after the metrics show legitimate traffic is verified.

## Error reporting

Decision D10 is Sentry; the steps are [A8](#anytime-free-no-blaze) above, and how it works is in [Error reporting](DEPLOYMENT.md#error-reporting-sentry).

- [ ] Create the Sentry project, with IP storage off and allowed domains set, and store its DSN as the `NEXT_PUBLIC_SENTRY_DSN` variable.
- [ ] Optionally add `SENTRY_AUTH_TOKEN` (secret), `SENTRY_ORG` and `SENTRY_PROJECT` (variables) for source maps.
- [ ] After the first deploy with the DSN, confirm with the agent that a test error arrives with no personal data in it.

## Functions and Stripe

Everything in this section waits for the Pro launch (roadmap item 9); see [Firebase Functions and Stripe](DEPLOYMENT.md#firebase-functions-and-stripe) for the commands.

- [ ] Upgrade `uv-activity-planner` to Blaze, attach the billing account, and create the budget and the kill switch's identity first (`infra/budget.sh`, C2 and C3).
- [ ] D9: the staging deploy is built (B0), the staging project exists and Stripe test mode runs there first (B1-B6).
- [ ] Grant the deploy identity the extra Functions roles ([WIF_SETUP.md](WIF_SETUP.md#extra-roles-when-functions-are-enabled)).
- [ ] In Stripe (test mode first), create the product **Solara Pro** with two recurring prices, **$2.99 per month** and **$19.99 per year** (no trial on the prices; checkout adds the 7-day trial), and set their ids as the `STRIPE_PRICE_ID` (monthly) and `STRIPE_YEARLY_PRICE_ID` (yearly) repository variables.
- [ ] Create the webhook endpoint before the first Functions deploy (its address is known in advance: `https://us-central1-<project id>.cloudfunctions.net/stripeWebhook`), with API version `2026-09-30.endive` and the events listed in DEPLOYMENT.md (seven, including `charge.refunded` and `charge.dispute.created`); its signing secret is `STRIPE_WEBHOOK_SECRET`.
- [ ] Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and a random `TRIAL_HISTORY_KEY` ([trial history](DEPLOYMENT.md#trial-history)) in Firebase Secret Manager, and create `OPEN_METEO_API_KEY` with the value `unset` (`npx firebase functions:secrets:set OPEN_METEO_API_KEY --project uv-activity-planner`, then type `unset`) so the first Functions deploy can start before the forecast plan is bought.
- [ ] Configure the customer portal (Stripe **Settings**, **Billing**, **Customer portal**): allow updating payment methods and viewing invoices; allow cancellations **at the end of the billing period**; allow switching plans between the two Pro prices only; set the default return link to `https://solara-uv.web.app/account/`.
- [ ] Set `NEXT_PUBLIC_FUNCTIONS_URL` and then `ENABLE_BLAZE_FUNCTIONS=true` as repository variables.
- [ ] Set the real `OPEN_METEO_API_KEY` before billing (C9): with billing on and the key still `unset`, the calendar feed fails for everyone.
- [ ] Switch billing on last: set the `BILLING_ENABLED` repository variable to `true` and let the next deploy run; the plans dialog then shows checkout instead of the waitlist.
      Set it to anything else to go back to the waitlist.
- [ ] In Stripe **Settings**, **Billing**, **Subscriptions and emails**, keep Smart Retries on and, when all retries fail, **cancel the subscription**; Solara keeps Pro for 7 days after the first failed renewal either way.
- [ ] Turn on the Firestore TTL policies: `infra/firestore-ttl.sh`, read the commands, then `infra/firestore-ttl.sh --apply`; try it now (A12), and again after Blaze (C8) if it needed billing.
- [ ] After the first Functions deploy, run the calendar feed token migration ([Calendar feed tokens](DEPLOYMENT.md#calendar-feed-tokens)).
- [ ] Before offering the calendar feed, add the Cloud Logging exclusions that keep feed links out of request logs and drop most rejected-request logs: `infra/logging.sh`, read the commands, then `--apply` ([Keep feed tokens out of request logs](DEPLOYMENT.md#keep-feed-tokens-out-of-request-logs)).
- [ ] On the first Functions deploy (staging first), run `infra/check-client-address.sh`; it must end with `OK` ([Check the client address](DEPLOYMENT.md#check-the-client-address-at-the-first-deploy)).
- [ ] Confirm the `maintenance` job runs cleanly (no `maintenance task ... failed` errors) and its indexes are `READY` before turning on checkout or deletion.
- [ ] Verify Stripe in test mode with a controlled account:
  - checkout is bound to the signed-in account, and a second checkout is refused while a subscription is active or reserved;
  - a paid event grants Pro once, a replayed event changes nothing, and out-of-order events cannot restore cancelled access;
  - a returning subscriber whose earlier subscription ended can subscribe again and keeps Pro whichever of the subscription update and the checkout event Stripe delivers first;
  - asynchronous payment success grants access and failure does not;
  - changing the subscription away from the Pro price, cancelling, or a failed payment revokes or restricts Pro as designed;
  - a failed post-creation checkout cleanup is eventually neutralized by the `maintenance` job;
  - the customer portal updates payment details, shows invoices and cancels;
  - an invalid webhook signature changes nothing in Firestore;
  - a failed renewal (test card `4000 0000 0000 0341` attached after a trial) keeps Pro and shows "Your last payment failed" on the account page, and a successful retry clears it;
  - refunding a payment in full in the dashboard ends that subscription and Pro; a partial refund does not;
  - a duplicate checkout that loses the race is canceled and refunded in full.
- [ ] Verify the account lifecycle:
  - the export holds portable preferences and safe device metadata only, without capability tokens, notification tokens or Stripe identifiers;
  - deletion requires a recent Google reauthentication and the exact `DELETE` confirmation;
  - the export includes the billing summary (plan, status and dates) and no Stripe identifier;
  - deleting an account with an active test subscription signs the user out, confirms the deletion on the account page, leaves no `solara_` entries in the browser's local storage, cancels the subscription, deletes the Stripe customer, removes notification ownership and feed entries, deletes the user data and the Auth user, and the tombstone reaches `cleanupStatus = completed` with an `expireAt`.
- [ ] Verify the calendar feed from a real calendar client: it refreshes after forecast or preference changes, it shows two days on Free and ten on Pro, rotating the link stops the old URL, and the feed's requests do not appear in Logs Explorer.

## Notifications

Pro's morning and UV alerts are built and switched off (`ALERTS_ENABLED`, [Pro alerts](DEPLOYMENT.md#pro-alerts)); record this real-device evidence in staging before switching them on in production.

- [ ] Provide a real phone that can receive web push and a controlled Pro test account; on an iPhone, add Solara to the Home Screen and open it from there.
- [ ] In Settings, **Sun profile**, turn alerts on for the phone, then set **Morning alert** to the current hour.
- [ ] Within 15 minutes exactly one notification appears while the app is in the background, and tapping it opens the app.
- [ ] Wait for two more runs: no second morning alert arrives, and `users/<uid>/alertState/daily` shows `morning.status` `delivered`.
- [ ] Choose a **UV alert** level today's forecast reaches, with quiet hours that do not cover now: exactly one UV alert arrives that day.
- [ ] Register the same phone to a second controlled account; ownership moves instead of producing two deliveries.
- [ ] Move the test account to Free (or cancel its test subscription): no alert arrives the next morning.
- [ ] Turn alerts off on the phone, then sign out; the device record is gone either time.

## Events from Google Calendar

Showing the UV at events already in the person's Google Calendar (events phase 2b) is built and switched off: it needs the OAuth client ID from A3 **and** the `GOOGLE_CALENDAR_EVENTS_ENABLED` repository variable ([DEPLOYMENT.md](DEPLOYMENT.md#events-from-google-calendar)).
It runs in the browser, needs no Blaze and stores no Google token.
It asks for `calendar.events.readonly` when the person turns it on, and `calendar.calendarlist.readonly` only if they choose calendars other than their main one; both are sensitive scopes that need their own verification, so keep them out of the A6 request (default, owner may change).

1. Wait until A6's verification of `calendar.freebusy` and `calendar.events.owned` has passed, so this request cannot delay Scheduled.
2. Wait until REVIEW5 M3's rule (heads-ups only for outdoor events, de-duplicated across sources; lane FIX5B) is on `main`, so events from a work calendar never send Pro heads-ups, and until REVIEW6's lane FIX6B is too: only the town of a location written as an address is searched, and the privacy policy names every place event data goes, which is what the verification compares with the video.
3. At https://console.cloud.google.com/auth/scopes?project=uv-activity-planner (**Data Access**), click **Add or remove scopes** and add `https://www.googleapis.com/auth/calendar.events.readonly` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`; save.
   The page lists both under **Your sensitive scopes**.
4. Switch it on in staging only, or ask the agent for a preview build, and record the demo video (the agent can script it): turning it on and the consent screen, the events with their UV, choosing calendars, and Disconnect.
5. In the **Verification Center**, request verification for the two scopes with the video and this justification: "Solara shows the UV index during the person's upcoming events. With calendar.events.readonly, the browser reads the next 30 days of events on the calendars the person chose and keeps only events whose location is written as an address or that match one of their outdoor activities: each one's title, time, time zone and location text, to forecast the UV there. To find the place, only the town of an address (such as Los Angeles, CA) is sent to Open-Meteo's place search; other location text, such as a person's name or a room, is never sent. calendar.calendarlist.readonly lists the person's calendars so they can choose which to use. Nothing is read on a server, no token is stored, and Disconnect deletes the stored events and revokes access."
   Google's review of sensitive scopes takes from a few days to a few weeks.
6. Once approved: `gh variable set GOOGLE_CALENDAR_EVENTS_ENABLED --repo n8watkins/solara --body true`, and let the next deploy run.
   With `ALERTS_ENABLED` on, this also turns on Pro event heads-ups, even while linked calendars stay off (REVIEW6 L1).
7. With a controlled Google account on production:
   - [ ] The Events section shows **Google Calendar** with **Show my Google Calendar events**; pressing it asks only for "View events on all your calendars".
   - [ ] Events with an address (and ones whose title matches an activity) appear, marked "From Google Calendar"; meetings with only a video link or dial-in, events whose location is only a name or a room ("Dr Patel", "Room 2"), all-day events and declined events do not.
   - [ ] **Choose calendars** asks for "See the list of Google calendars you're subscribed to" and lists your calendars; ticking another one adds its events.
   - [ ] Move an event in Google Calendar, then press **Refresh**: Solara follows; a second signed-in device shows the same events and calendars.
   - [ ] **Disconnect** removes the events, and Solara disappears from https://myaccount.google.com/connections (Google ends all of Solara's calendar access at once, so Scheduled asks to connect again).
   - [ ] Press **Refresh** on one device and **Disconnect** on another at the same moment: both end disconnected, with no Google events.
   - [ ] No CSP violation shows in the console while disconnecting.

## Events from Outlook (only for the Outlook connection)

Needed only for the Outlook connection ([ROADMAP item 23](ROADMAP.md#23-events-already-in-outlook-built-and-switched-off), as built in [integrations/OUTLOOK.md](integrations/OUTLOOK.md#owner-steps-in-azure)); nothing else in Solara uses Microsoft, so skip this section unless you want Outlook events.
The feature is built and switched off; it stays hidden until both repository variables below are set.
Everything here is free: the Azure free account charges nothing at sign-up (a temporary one-dollar card hold verifies identity), the app registration costs nothing, and Microsoft Graph calendar reads are not metered.
No Microsoft review is needed for the one permission Solara asks for.

1. Create a free Azure account at https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account (a phone number and a non-prepaid card for verification), or sign in if you have one; its **Default Directory** is the tenant the app lives in.
2. At https://entra.microsoft.com, open **Entra ID**, **App registrations**, **New registration**:
   - **Name:** `Solara`.
   - **Supported account types:** **Any Entra ID Tenant + Personal Microsoft accounts**.
   - **Redirect URI:** platform **Single-page application (SPA)**, `https://solara-uv.web.app/auth/microsoft/` (exactly, with the trailing slash).
3. In the new app, **API permissions**: remove `User.Read`, then **Add a permission**, **Microsoft Graph**, **Delegated permissions**, tick `Calendars.ReadBasic`, **Add permissions**.
   Do not press **Grant admin consent**.
4. **Authentication:** leave the implicit grant boxes (**Access tokens**, **ID tokens**) unticked and **Allow public client flows** set to **No**.
5. **Branding & properties:** home page `https://solara-uv.web.app/`, terms of service `https://solara-uv.web.app/terms/`, privacy statement `https://solara-uv.web.app/privacy/`, and the Solara logo; the consent prompt shows them.
6. Optional, for local development: register a second app, `Solara (dev)`, the same way with the SPA redirect URI `http://localhost/auth/microsoft/` (Microsoft ignores the port for localhost), and put its client ID in `.env.local` as `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` with `NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED=1`.
7. Set the **Application (client) ID** from the app's **Overview** (public, not a secret): `gh variable set MICROSOFT_CLIENT_ID --repo n8watkins/solara --body <client id>`.
   On its own it changes nothing visible; the deploy's env check refuses a value that is not a GUID.
8. Leave publisher verification alone: it needs a Microsoft AI Cloud Partner Program account and a custom domain, which Solara does not have; without it the consent prompt shows the publisher as unverified, and some work or school accounts will need their IT admin's approval.
9. Live check before switching on, with the dev registration on `npm run dev` (step 6; preview channels have their own addresses, which a registration cannot match by wildcard): these settle what the build could only test against Microsoft's documented answers ([open questions](integrations/OUTLOOK.md#open-questions)).
   With a controlled Outlook.com account, and a work or school account if you have one:
   - [ ] The popup asks only for "Read basic details of user calendars" (and, for a work account whose organization blocks user consent, Solara then says the organization needs to approve it).
   - [ ] Events with a place (and ones whose title matches an activity) appear with their **title** and **place**, marked "From Outlook": this confirms `Calendars.ReadBasic` returns `subject` and `location`; if titles are empty or places missing, tell the agent (the fallback is `Calendars.Read`, with a privacy policy change).
   - [ ] Teams meetings without a place, all-day, cancelled and declined events do not appear; a recurring event shows each occurrence.
   - [ ] An event whose place you picked from Outlook's place suggestions shows that place's name without "Using your place".
   - [ ] **Choose calendars** lists your own calendars (not ones others share with you) without asking for anything new; note whether internet calendars you subscribed to in Outlook.com appear, and whether choosing one shows its events or "no longer shared".
   - [ ] Closing the sign-in popup without signing in leaves the button ready again within a few seconds, with no error.
   - [ ] Move an event in Outlook, then press **Refresh**: Solara follows.
   - [ ] **Disconnect** removes the events, and the link to your Microsoft account's app permissions (https://account.live.com/consent/Manage) lists Solara and removes it; for a work account, My Apps (https://myapplications.microsoft.com/) does.
   - [ ] No CSP violation shows in the browser console.
   - [ ] **Refresh** after a reload goes through without Microsoft's account picker (only "Show my Outlook events" shows it).
   - [ ] The token answer carries no `refresh_token` (DevTools, **Network**, the `token` request's **Response**): this confirms the privacy policy's "Solara keeps no refresh token" with Microsoft's own answer.
10. After the REVIEW7 sign-in fix (FIX7A) is merged, and before switching on: one sign-in with production's headers, the cache cleared and the network throttled, because `npm run dev` sends none of production's headers and the bug REVIEW7 M1 found appears only with them.
    Production itself shows the Outlook panel only once it is switched on, so build production's way with the dev registration from step 6: in a fresh clone first run `npm ci` and `npm ci --prefix functions` (the test server needs the Functions' copy of firebase-tools), then `npm run build` with the `.env.local` of step 6, then `E2E_SITE_DIR=out node tests/e2e/serve-export.mjs 5050`, which serves the build on the Hosting emulator with firebase.json's headers.
    - [ ] Open `http://localhost:5050/app/` in Chrome, sign in to Solara, open DevTools, and on **Network** tick **Disable cache** and pick **Slow 4G** (or **3G**).
    - [ ] Press **Show my Outlook events** and sign in to Microsoft: the popup closes and the events appear. If the popup closes and nothing happens, with no message, do not switch on; tell the agent.
11. Switch it on: `gh variable set OUTLOOK_CALENDAR_EVENTS_ENABLED --repo n8watkins/solara --body true`, and let the next deploy run (it also turns on Pro event heads-ups with `ALERTS_ENABLED`, as the Google switch does); repeat the first and last checks on production.

## Linked calendars

Linked calendars and Pro event heads-ups are built and switched off (`EVENTS_SUBSCRIPTIONS_ENABLED`, [Linked calendars and event heads-ups](DEPLOYMENT.md#linked-calendars-and-event-heads-ups)); check them in staging before switching them on in production.

- [ ] In the Events section, link a public Meetup group feed (for example `https://www.meetup.com/<group>/events/ical/`, or the `webcal://` form): its upcoming events appear, marked "From a linked calendar", and the link shows its site and "Updated just now".
- [ ] Link the same address again: refused as already linked; link `http://` or a private address such as `https://10.0.0.1/a.ics`: refused with a clear message.
- [ ] In the Firestore console, `users/<uid>/private/eventSubscriptions` shows the host and label but no address; `eventSubscriptions/<id>` holds the address.
- [ ] Press **Refresh**, then again at once: the second is refused for 10 minutes.
- [ ] Wait for the `eventSubscriptionsRefresh` job after the next refresh time (6 hours): its log line `linked calendar refresh completed` counts the link.
- [ ] With a Pro test account with alerts on a phone, add an event with high UV starting in about 4 hours and set its activity (for example Running): one heads-up arrives about 3 hours before it; an event left on "No activity" gets none.
- [ ] **Remove** the link: it and its events disappear on every device.

## Legal

The operator, contact, jurisdiction and license are published (D8).

- [ ] Have qualified counsel review the governing-law language in the terms.

## Release verification

CI blocks every deploy on the quality workflow and deploys the exact artifact it tested, so the local preflight is the README's [quality checks](../README.md#quality-checks).
After a release that changes user-facing behavior, check production by hand:

- [ ] The Deploy run is green, and the Hosting release history in the Firebase console shows the commit.
- [ ] The site loads in a private desktop window and on a real phone with no console errors, CSP violations or failed requests.
      One message is expected and harmless: pressing **Sign in** logs "Cross-Origin-Opener-Policy policy would block the window.closed call" (once or twice), from Firebase's own popup check.
- [ ] A Google account that is not a test user signs in.
- [ ] Onboarding completes through Google sign-in; a reload keeps the account's preferences, and a returning account signing in from setup keeps its saved activities.
- [ ] Dashboard and Calendar show the same window for the same activity; neither shows elapsed windows.
- [ ] Changing, saving and removing locations updates the forecast and the saved-location count, and Free and Pro limits block saving without blocking a change of the active location.
- [ ] Creating and editing an activity round-trips, including weekday and weekend presets.
- [ ] A failed forecast request shows a recoverable error instead of a blank screen.
- [ ] The PWA manifest installs on supported platforms.
- [ ] Every section above that the release turns on has its checks done.

If anything is wrong, roll Hosting back from the Firebase console's release history and see [Operational rollback](DEPLOYMENT.md#operational-rollback).

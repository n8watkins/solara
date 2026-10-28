# Solara owner checklist

_Last reviewed: 2026-10-28_

This checklist holds what only the owner can do: decisions, credentials, provider consoles, legal facts and real-device evidence, plus the manual checks for each release.
Which items are already done is tracked in [status.md](status.md#owner-actions); the decisions and the roadmap items that need them are in [ROADMAP.md](ROADMAP.md#decisions).
How deploys and configuration work is in [DEPLOYMENT.md](DEPLOYMENT.md).

Never paste a secret into an issue, pull request, repository file or chat message.
When an item is done, tell the repository agent which section changed, without the secret values; the agent can then redeploy, inspect logs and run the automated checks.

## Next steps, in order

_As of 2026-10-24._
Do these from the top; each step says what to send the repository agent.
Everything sent here is a public identifier, not a secret.

Already done: the domain move to `solara-uv.web.app`, the Firestore index role (D3), the operator details (D8), making the repository public with its ruleset (D2), Search Console verification, the second authorized domain, the OAuth scopes, Dependabot alerts, and confirming the price and tiers.

### Now: free, no Blaze

1. **Turn on Google Calendar for adding events and Scheduled (about 10 minutes).**
   1. Enable the Google Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=uv-activity-planner (click **Enable**; "Manage" means it is already on).
   2. Open https://console.cloud.google.com/auth/clients?project=uv-activity-planner and open the **Web application** client (or **Create client**, type **Web application**, name "Solara web").
   3. Under **Authorized JavaScript origins**, make sure `https://solara-uv.web.app` is listed; save.
   4. Send the agent the **Client ID** (it ends in apps.googleusercontent.com), or set it yourself: `gh variable set NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID --repo n8watkins/solara --body "<client id>"`.
      The next deploy shows Google Calendar to Free and Pro accounts.
2. **Resubmit branding (2 minutes).** Confirm https://solara-uv.web.app/privacy/ shows the operator and the "How Solara uses Google user data" section, then at https://console.cloud.google.com/auth/branding?project=uv-activity-planner choose **View issues**, **I have fixed the issues**, **Proceed**.
3. **Publish sign-in (1 minute).** At https://console.cloud.google.com/auth/audience?project=uv-activity-planner, if the status is **Testing**, click **Publish app** and confirm. Send a screenshot of the result.
4. **Request calendar scope verification (15 minutes, after step 2 passes).** In Google Auth Platform, **Verification Center**, start verification for `calendar.freebusy` and `calendar.events.owned` using the justification text in [Google sign-in and Calendar](#google-sign-in-and-calendar). The agent can script a short demo video.
   Showing events already in Google Calendar is a separate, optional request made after this one passes; its steps are in [Events from Google Calendar](#events-from-google-calendar).
5. **Turn on App Check with reCAPTCHA v3 (about 15 minutes, then a week of watching).**
   Cost: free up to 10,000 reCAPTCHA assessments a month, then a flat $8 up to 100,000 ([COSTS.md](COSTS.md)).
   App Check starts only after sign-in and its token lasts an hour, so assessments are roughly signed-in session-hours: about 3,000 a month at 100 daily users, about 30,000 ($8) at 1,000.
   1. Create the key at https://www.google.com/recaptcha/admin/create while signed in as the owner: label `Solara web`, type **Score based (v3)**, domain `solara-uv.web.app` (only that one; local development uses App Check debug tokens instead of `localhost`), Google Cloud project `uv-activity-planner`. Submit, then copy the **site key** and the **secret key**.
   2. Register it with Firebase at https://console.firebase.google.com/project/uv-activity-planner/appcheck, **Apps** tab: open the web app, choose **reCAPTCHA**, paste the **secret key** (it goes only here), keep the token time to live at **1 hour**, and **Save**.
   3. Set the public **site key** as a repository variable, or send it to the agent: `gh variable set NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY --repo n8watkins/solara --body "<site key>"`.
      Leave `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` unset; v3 is the default.
      The next deploy turns App Check on for signed-in users.
   4. Monitor before enforcing: in App Check, **APIs** tab, open **Cloud Firestore** and watch the request metrics for at least 7 days.
      Verified requests should be nearly all signed-in traffic; "Unverified: outdated client" should fall toward zero as old tabs and installed copies update.
   5. Do not click **Enforce** until the agent has checked the metrics with you.
      Then enforce **Cloud Firestore** only.
      Never enforce **Authentication**: App Check starts after sign-in, so enforcing it there would block sign-in itself.
      Cloud Functions enforce App Check in their code already.
6. **Create a Sentry project (about 10 minutes).**
   Sentry's free Developer plan covers 5,000 errors a month and keeps events for 30 days.
   1. Sign up at https://sentry.io/signup/ and choose the **United States** data storage location (the privacy policy says providers process data in the United States).
   2. Create a project: platform **Next.js**, name `solara-web`, alert on every new issue.
   3. In the project's **Settings**, **Security & Privacy**: keep **Data Scrubber** and **Use Default Scrubbers** on, turn on **Prevent Storing of IP Addresses**, and set **Allowed Domains** to `solara-uv.web.app`, so events from anywhere else are dropped.
   4. In **Settings**, **Client Keys (DSN)**, copy the **DSN** (public) and set it as a repository variable, or send it to the agent: `gh variable set NEXT_PUBLIC_SENTRY_DSN --repo n8watkins/solara --body "<DSN>"`.
      The next deploy turns error reporting on.
   5. For readable stack traces, create an organization token in **Settings**, **Developer Settings**, **Organization Tokens** (name `solara-deploy`), then:
      `gh secret set SENTRY_AUTH_TOKEN --repo n8watkins/solara` (paste the token when asked; it is a secret),
      `gh variable set SENTRY_ORG --repo n8watkins/solara --body "<organization slug>"` and
      `gh variable set SENTRY_PROJECT --repo n8watkins/solara --body solara-web`.
      With all four set, each deploy uploads source maps to Sentry and removes them from the published site.
7. **Keyless deploys, then delete the old key (about 15 minutes with the agent).** Follow [WIF_SETUP.md](WIF_SETUP.md) together, then delete the `FIREBASE_SERVICE_ACCOUNT` key and secret (D4).
8. **Move public build values to GitHub variables (about 5 minutes).** The agent provides exact `gh variable set` commands; you fill in the values, then delete each matching secret, including the leftover `NEXT_PUBLIC_SITE_URL` secret ([steps](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables)).
9. **Delete the unused `NEXT_PUBLIC_PRO_PRICE` secret (1 minute).** Prices live in `lib/plans.ts` since #71, so nothing reads it: `gh secret delete NEXT_PUBLIC_PRO_PRICE --repo n8watkins/solara` (and `gh variable delete NEXT_PUBLIC_PRO_PRICE --repo n8watkins/solara` if a variable exists).
10. **Have counsel review the governing-law language** in the terms ([Legal](#legal)).
11. **Clean up local branches and worktrees (D12).** The merged worktrees under `projects/polish/` on your machine can go; ask the agent for the exact commands.

### At Pro launch: Blaze

12. **Upgrade to Blaze with a budget and the kill switch (about 20 minutes).**
    1. Upgrade the Firebase project to **Blaze** at https://console.firebase.google.com/project/uv-activity-planner/usage/details and attach the billing account.
    2. Create the budget, its Pub/Sub topic and the kill switch's own identity.
       From a shell signed in as the owner (`gcloud auth login`), print the commands first, read them, then run them:
       `BILLING_ACCOUNT=<billing account id> DEPLOY_SA=<deploy service account email> infra/budget.sh`, then the same with `--apply`.
       The billing account id is on https://console.cloud.google.com/billing; the deploy service account is the one from [WIF_SETUP.md](WIF_SETUP.md).
       It creates a **$25** monthly budget with emails at 50%, 90%, 100% and 300% (defaults, owner may change: `BUDGET_AMOUNT=40USD` for another amount).
    3. Set the two repository variables the script prints, `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT`, so the kill switch acts only on this budget and runs as the identity that alone may detach billing.
    4. The kill switch then warns at 50% of the budget, pauses the traffic-driven paths at 100% until the next month, and detaches billing at 300% ($75 by default), which stops the Functions while Hosting keeps serving the site ([runbook](RUNBOOK.md#budget-kill-switch)).
       That hard stop is on by default (default, owner may change); to keep spending instead, run the script with `DETACH_BILLING=false` and set the `COST_GUARD_DETACH_BILLING` repository variable to `false`.
       Know what it costs: a sustained flood can spend about $550 a day ([worst case under a flood](COSTS.md#worst-case-under-a-flood)), so $75 can be reached within hours, and a detach stops every Function, checkout and the Stripe webhook included, until billing is re-attached.
       Stripe retries a failed webhook for only 3 days, so after a detach follow [within 3 days of a detach](RUNBOOK.md#budget-kill-switch) in the runbook: re-attach, redeploy, then resend the failed webhook events.
    5. App Check order: Functions enforce App Check in their code from their first deploy, so the site key from step 5 must be live first; Firestore enforcement stays the console switch from step 5, after a week of metrics; never enforce **Authentication**.
13. **Staging and Stripe test mode first (D9, about an hour with the agent).** Create a staging Firebase project (Blaze, with its own budget from step 12) and use Stripe in **test mode**; do steps 14-16 there first, run the checks in [Functions and Stripe](#functions-and-stripe), then repeat them for `uv-activity-planner` with live Stripe keys.
14. **First Functions deploy (about 20 minutes).**
    1. Grant the deploy identity the extra Functions roles ([WIF_SETUP.md](WIF_SETUP.md#extra-roles-when-functions-are-enabled)).
    2. Create the four secrets: `npx firebase functions:secrets:set STRIPE_SECRET_KEY --project uv-activity-planner`, the same for `STRIPE_WEBHOOK_SECRET`, `OPEN_METEO_API_KEY` with the value `unset` for now, and the trial history's random key with `openssl rand -base64 48 | npx firebase functions:secrets:set TRIAL_HISTORY_KEY --data-file=- --project uv-activity-planner` (never rotate it unless it leaks: a new key forgets every recorded trial).
    3. Set the repository variables `NEXT_PUBLIC_FUNCTIONS_URL` (`https://us-central1-uv-activity-planner.cloudfunctions.net`) and then `ENABLE_BLAZE_FUNCTIONS=true`; leave `BILLING_ENABLED` and `FORECAST_PROXY_ENABLED` unset.
       The next deploy publishes the Functions (it sets the Artifact Registry cleanup policy itself); checkout still shows the waitlist and forecasts still come straight from Open-Meteo.
    4. Then the follow-ups in [Functions and Stripe](#functions-and-stripe): the feed token migration, the log exclusions (`infra/logging.sh`) and the client address check (`infra/check-client-address.sh`).
15. **Monitoring, backups and record expiry (about 15 minutes).** From a shell signed in as the owner, print each script's commands, read them, then run it again with `--apply`:
    1. `ALERT_EMAIL=<your email> infra/monitoring.sh`: two uptime checks and the two alert policies ([runbook](RUNBOOK.md#alerts)).
    2. `infra/backups.sh`: point-in-time recovery, delete protection, daily backups and the image cleanup policy.
    3. `infra/firestore-ttl.sh`: the TTL policies that delete expired records ([runbook](RUNBOOK.md#record-retention)).
    4. With the agent, run a restore drill in staging and record it in the [runbook](RUNBOOK.md#backups-and-restore).
16. **Switch Pro billing on.** With the Stripe product, prices, portal settings and webhook from [Functions and Stripe](#functions-and-stripe) in place: `gh variable set STRIPE_PRICE_ID --repo n8watkins/solara --body <monthly price id>`, the same for `STRIPE_YEARLY_PRICE_ID`, then `gh variable set BILLING_ENABLED --repo n8watkins/solara --body true`, and let the next deploy run.
    The plans dialog then offers the 7-day trial instead of the waitlist; setting `BILLING_ENABLED` to anything else brings the waitlist back.
17. **Buy the Open-Meteo Standard commercial plan** (about $29 per month) once the first subscription is live (D5), then switch forecasts to it:
    1. Set the key: `npx firebase functions:secrets:set OPEN_METEO_API_KEY --project uv-activity-planner` and paste the API key from the Open-Meteo dashboard.
    2. Set the `FORECAST_PROXY_ENABLED` repository variable to `true`: `gh variable set FORECAST_PROXY_ENABLED --repo n8watkins/solara --body true`.
    3. The next deploy redeploys the Functions with the key and builds the app to fetch through the proxy; check that the dashboard still loads a forecast and setup still suggests places in a private window, and that the `forecast` Function's logs show no `forecast served from the last good copy` warnings.
    4. Switch Pro's morning and UV alerts on (they need the key), staging first with the [Notifications](#notifications) checks:
       optionally give them their own least-privilege identity with `DEPLOY_SA=<deploy service account email> infra/alerts-identity.sh` (print, read, then `--apply`) and `gh variable set ALERTS_SERVICE_ACCOUNT --repo n8watkins/solara --body solara-alerts@uv-activity-planner.iam.gserviceaccount.com`;
       then `gh variable set ALERTS_ENABLED --repo n8watkins/solara --body true` and let the next deploy run ([Pro alerts](DEPLOYMENT.md#pro-alerts)).
    5. Optional, once alerts work: switch on linked calendars and Pro event heads-ups, staging first with the [Linked calendars](#linked-calendars) checks: `gh variable set EVENTS_SUBSCRIPTIONS_ENABLED --repo n8watkins/solara --body true` and let the next deploy run ([Linked calendars and event heads-ups](DEPLOYMENT.md#linked-calendars-and-event-heads-ups)).
       The refresh job is the third free Cloud Scheduler job; nothing else needs setting up.
18. Run the release checks in [Release verification](#release-verification), plus [Functions and Stripe](#functions-and-stripe) and [Notifications](#notifications).

### Later: mobile app (Wave 6)

19. Create an Apple Developer account ($99 per year) and a Google Play developer account ($25 once).

## Repository

- [x] Make the repository public (D2, 2026-10-23).
- [x] "Protect main" ruleset: pull requests, squash merges only, 8 required checks.
- [x] Secret scanning with push protection, CodeQL default setup, Dependabot alerts and security updates.
- [ ] Optional: private vulnerability reporting.
- [ ] Recommended: a `production` environment (**Settings**, **Environments**) with **Deployment branches** set to `main` only and optionally a required reviewer; ask the agent to attach the deploy and notifier jobs to it, and once that is merged, move the `FIREBASE_SERVICE_ACCOUNT` and `SENTRY_AUTH_TOKEN` secrets into the environment.
      The deploy workflow already refuses to deploy from any other branch, so this is a second guard that GitHub enforces.

## Credentials

- [ ] Run [WIF_SETUP.md](WIF_SETUP.md) so deploys use short-lived credentials.
- [ ] Delete the `FIREBASE_SERVICE_ACCOUNT` key and secret once deploys run on WIF (D4).
- [ ] The GitHub Actions notifier is retired: delete the `GCP_NOTIFIER_SERVICE_ACCOUNT` variable and the `solara-notifier` service account if they were created.
- [ ] Move every `NEXT_PUBLIC_*` secret to a repository variable, then delete the secret, including the leftover `NEXT_PUBLIC_SITE_URL` secret ([steps](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables)).
- [ ] Delete the unused `NEXT_PUBLIC_PRO_PRICE` variable or secret ([step 9](#now-free-no-blaze)).

## Google sign-in and Calendar

- [x] `solara-uv.web.app` and `uv-activity-planner.firebaseapp.com` are authorized domains (owner reported).
- [x] Search Console verifies `https://solara-uv.web.app/` for the OAuth branding review (2026-10-23, owner reported).
- [x] The OAuth scopes are added: `openid`, `userinfo.email`, `userinfo.profile`, `calendar.freebusy`, `calendar.events.owned` (owner reported).
- [ ] Finish the OAuth consent screen: data access lists only `https://www.googleapis.com/auth/calendar.freebusy` and `https://www.googleapis.com/auth/calendar.events.owned`, the privacy policy link points at `https://solara-uv.web.app/privacy/`, and the app is published.
- [ ] Submit the two Calendar scopes for verification and answer Google's review.
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

Decision D11 is reCAPTCHA v3; the steps are [step 5](#now-free-no-blaze) above, and how it works is in [App Check](DEPLOYMENT.md#app-check).
The code also supports reCAPTCHA Enterprise through `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER=recaptcha-enterprise`, if that is ever needed.
Functions require App Check in code, so the site key is needed before any Function-backed surface is turned on.

- [ ] Create the reCAPTCHA v3 key and register it for the web app under App Check in the Firebase console.
- [ ] Store the site key as the `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` variable.
- [ ] Enforce App Check for Cloud Firestore only after the metrics show legitimate traffic is verified.

## Error reporting

Decision D10 is Sentry; the steps are [step 6](#now-free-no-blaze) above, and how it works is in [Error reporting](DEPLOYMENT.md#error-reporting-sentry).

- [ ] Create the Sentry project, with IP storage off and allowed domains set, and store its DSN as the `NEXT_PUBLIC_SENTRY_DSN` variable.
- [ ] Optionally add `SENTRY_AUTH_TOKEN` (secret), `SENTRY_ORG` and `SENTRY_PROJECT` (variables) for source maps.
- [ ] After the first deploy with the DSN, confirm with the agent that a test error arrives with no personal data in it.

## Functions and Stripe

Everything in this section waits for the Pro launch (roadmap item 9); see [Firebase Functions and Stripe](DEPLOYMENT.md#firebase-functions-and-stripe) for the commands.

- [ ] Upgrade `uv-activity-planner` to Blaze, attach the billing account, and create the budget and the kill switch's identity first (`infra/budget.sh`, step 12).
- [ ] Decide D9: create a staging Firebase project and use Stripe test mode there first.
- [ ] Grant the deploy identity the extra Functions roles ([WIF_SETUP.md](WIF_SETUP.md#extra-roles-when-functions-are-enabled)).
- [ ] In Stripe (test mode first), create the product **Solara Pro** with two recurring prices, **$2.99 per month** and **$19.99 per year** (no trial on the prices; checkout adds the 7-day trial), and set their ids as the `STRIPE_PRICE_ID` (monthly) and `STRIPE_YEARLY_PRICE_ID` (yearly) repository variables.
- [ ] Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and a random `TRIAL_HISTORY_KEY` ([trial history](DEPLOYMENT.md#trial-history)) in Firebase Secret Manager, and create `OPEN_METEO_API_KEY` with the value `unset` (`npx firebase functions:secrets:set OPEN_METEO_API_KEY --project uv-activity-planner`, then type `unset`) so the first Functions deploy can start before the forecast plan is bought.
- [ ] Configure the customer portal (Stripe **Settings**, **Billing**, **Customer portal**): allow updating payment methods and viewing invoices; allow cancellations **at the end of the billing period**; allow switching plans between the two Pro prices only; set the default return link to `https://solara-uv.web.app/account/`.
- [ ] Switch billing on last: set the `BILLING_ENABLED` repository variable to `true` and let the next deploy run; the plans dialog then shows checkout instead of the waitlist. Set it to anything else to go back to the waitlist.
- [ ] Set `NEXT_PUBLIC_FUNCTIONS_URL` and then `ENABLE_BLAZE_FUNCTIONS=true` as repository variables.
- [ ] Register the deployed webhook endpoint in Stripe test mode with the events listed in DEPLOYMENT.md (seven, including `charge.refunded` and `charge.dispute.created`).
- [ ] In Stripe **Settings**, **Billing**, **Subscriptions and emails**, keep Smart Retries on and, when all retries fail, **cancel the subscription**; Solara keeps Pro for 7 days after the first failed renewal either way.
- [ ] After Blaze, turn on the Firestore TTL policies: `infra/firestore-ttl.sh`, read the commands, then `infra/firestore-ttl.sh --apply`.
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

Showing the UV at events already in the person's Google Calendar (events phase 2b) is built and switched off: it needs the OAuth client ID from step 1 **and** the `GOOGLE_CALENDAR_EVENTS_ENABLED` repository variable ([DEPLOYMENT.md](DEPLOYMENT.md#events-from-google-calendar)).
It runs in the browser, needs no Blaze and stores no Google token.
It asks for `calendar.events.readonly` when the person turns it on, and `calendar.calendarlist.readonly` only if they choose calendars other than their main one; both are sensitive scopes that need their own verification, so keep them out of the step 4 request (default, owner may change).

1. Wait until step 4's verification of `calendar.freebusy` and `calendar.events.owned` has passed, so this request cannot delay Scheduled.
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
10. Switch it on: `gh variable set OUTLOOK_CALENDAR_EVENTS_ENABLED --repo n8watkins/solara --body true`, and let the next deploy run (it also turns on Pro event heads-ups with `ALERTS_ENABLED`, as the Google switch does); repeat the first and last checks on production.

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
- [ ] Onboarding completes through Google sign-in; a reload keeps the account's preferences, and a returning account signing in from setup keeps its saved activities.
- [ ] Dashboard and Calendar show the same window for the same activity; neither shows elapsed windows.
- [ ] Changing, saving and removing locations updates the forecast and the saved-location count, and Free and Pro limits block saving without blocking a change of the active location.
- [ ] Creating and editing an activity round-trips, including weekday and weekend presets.
- [ ] A failed forecast request shows a recoverable error instead of a blank screen.
- [ ] The PWA manifest installs on supported platforms.
- [ ] Every section above that the release turns on has its checks done.

If anything is wrong, roll Hosting back from the Firebase console's release history and see [Operational rollback](DEPLOYMENT.md#operational-rollback).

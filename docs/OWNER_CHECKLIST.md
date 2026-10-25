# Solara owner checklist

_Last reviewed: 2026-10-24_

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

12. Upgrade the Firebase project to **Blaze** and create a **$5 per month budget alert** in Google Cloud Billing.
13. Create a staging Firebase project and a Stripe account in **test mode** (D9); the agent guides both.
14. Buy the Open-Meteo **Standard** commercial plan (about $29 per month) once the first subscription is live (D5).
15. Run the release checks in [Release verification](#release-verification), plus [Functions and Stripe](#functions-and-stripe) and [Notifications](#notifications).

### Later: mobile app (Wave 6)

16. Create an Apple Developer account ($99 per year) and a Google Play developer account ($25 once).

## Repository

- [x] Make the repository public (D2, 2026-10-23).
- [x] "Protect main" ruleset: pull requests, squash merges only, 8 required checks.
- [x] Secret scanning with push protection, CodeQL default setup, Dependabot alerts and security updates.
- [ ] Optional: private vulnerability reporting, and a `production` environment with a required reviewer for the deploy jobs.

## Credentials

- [ ] Run [WIF_SETUP.md](WIF_SETUP.md) so deploys and the notifier use short-lived credentials with separate identities.
- [ ] Delete the `FIREBASE_SERVICE_ACCOUNT` key and secret once both workflows run on WIF (D4).
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

- [ ] Upgrade `uv-activity-planner` to Blaze, attach the billing account, and create a budget alert first.
- [ ] Decide D9: create a staging Firebase project and use Stripe test mode there first.
- [ ] Grant the deploy identity the extra Functions roles ([WIF_SETUP.md](WIF_SETUP.md#extra-roles-when-functions-are-enabled)).
- [ ] Create or choose the Stripe Pro price, store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Firebase Secret Manager, and set the `STRIPE_PRICE_ID` repository variable.
- [ ] Set `NEXT_PUBLIC_FUNCTIONS_URL` and then `ENABLE_BLAZE_FUNCTIONS=true` as repository variables.
- [ ] Register the deployed webhook endpoint in Stripe test mode with the events listed in DEPLOYMENT.md.
- [ ] After the first Functions deploy, run the calendar feed token migration ([Calendar feed tokens](DEPLOYMENT.md#calendar-feed-tokens)).
- [ ] Confirm the three scheduled jobs (`backfillStripeBillingResources`, `cleanupDeletedAccountBilling`, `cleanupFailedCheckouts`) run cleanly and their indexes are `READY` before turning on checkout or deletion.
- [ ] Verify Stripe in test mode with a controlled account:
  - checkout is bound to the signed-in account, and a second checkout is refused while a subscription is active or reserved;
  - a paid event grants Pro once, a replayed event changes nothing, and out-of-order events cannot restore cancelled access;
  - a returning subscriber whose earlier subscription ended can subscribe again and keeps Pro whichever of the subscription update and the checkout event Stripe delivers first;
  - asynchronous payment success grants access and failure does not;
  - changing the subscription away from the Pro price, cancelling, or a failed payment revokes or restricts Pro as designed;
  - a failed post-creation checkout cleanup is eventually neutralized by `cleanupFailedCheckouts`;
  - the customer portal updates payment details, shows invoices and cancels;
  - an invalid webhook signature changes nothing in Firestore.
- [ ] Verify the account lifecycle:
  - the export holds portable preferences and safe device metadata only, without capability tokens, notification tokens or Stripe identifiers;
  - deletion requires a recent Google reauthentication and the exact `DELETE` confirmation;
  - deleting an account with an active test subscription signs the user out, cancels the subscription, removes notification ownership and feed entries, deletes the user data and the Auth user, and the tombstone reaches `cleanupStatus = completed`.
- [ ] Verify the calendar feed from a real calendar client: it refreshes after forecast or preference changes, and rotating the link stops the old URL.

## Notifications

Morning alerts are Pro-only and stay off until they launch with Pro on a scheduled Function (D6, roadmap item 10) and this real-device evidence is recorded.

- [ ] Provide a real phone that can receive web push and a controlled paid test account.
- [ ] Run the dispatcher as a dry run and confirm it selects the expected user, activity, device, local date and time zone.
- [ ] Approve one real send; exactly one system notification appears while the app is in the background, and tapping it opens the intended page.
- [ ] Repeat the dispatch; no second notification appears.
- [ ] Register the same phone to a second controlled account; ownership moves instead of producing two deliveries.
- [ ] Turn notifications off, then sign out; the device is no longer selected either time.

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

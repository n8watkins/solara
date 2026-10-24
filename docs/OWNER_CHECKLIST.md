# Solara owner checklist

_Last reviewed: 2026-10-23_

This checklist holds what only the owner can do: decisions, credentials, provider consoles, legal facts and real-device evidence, plus the manual checks for each release.
Which items are already done is tracked in [status.md](status.md#owner-actions); the decisions still open, and the roadmap lane that needs each one, are in [ROADMAP.md](ROADMAP.md#owner-decisions).
How deploys and configuration work is in [DEPLOYMENT.md](DEPLOYMENT.md).

Never paste a secret into an issue, pull request, repository file or chat message.
When an item is done, tell the repository agent which section changed, without the secret values; the agent can then redeploy, inspect logs and run the automated checks.

## Next steps, in order (as of 2026-10-23)

Each step says what to send the repository agent.
Everything sent here is a public identifier, not a secret.

### Now: free, no Blaze

1. **Turn on Google Calendar for the Scheduled feature (about 10 minutes).**
   1. Enable the Google Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=uv-activity-planner (click **Enable**; "Manage" means it is already on).
   2. Open https://console.cloud.google.com/auth/clients?project=uv-activity-planner and open the **Web application** client (or **Create client**, type **Web application**, name "Solara web").
   3. Under **Authorized JavaScript origins**, make sure `https://solara-uv.web.app` is listed; save.
   4. Send the agent the **Client ID** (it ends in apps.googleusercontent.com).
2. **Check the OAuth scopes (2 minutes).** At https://console.cloud.google.com/auth/scopes?project=uv-activity-planner the list should be exactly `openid`, `userinfo.email`, `userinfo.profile`, `calendar.freebusy`, `calendar.events.owned`. Send a screenshot.
3. **Add the second authorized domain (1 minute).** At https://console.cloud.google.com/auth/branding?project=uv-activity-planner add `uv-activity-planner.firebaseapp.com` next to `solara-uv.web.app` under **Authorized domains**; save.
4. **Resubmit branding (2 minutes, at least 24 hours after Search Console verification).** Confirm https://solara-uv.web.app/privacy/ shows the operator and the "How Solara uses Google user data" section, then on the Branding page choose **View issues**, **I have fixed the issues**, **Proceed**.
5. **Publish sign-in (1 minute).** At https://console.cloud.google.com/auth/audience?project=uv-activity-planner, if the status is **Testing**, click **Publish app** and confirm. Send a screenshot of the result.
6. **Request calendar scope verification (15 minutes, after step 4 passes).** In Google Auth Platform, **Verification Center**, start verification for `calendar.freebusy` and `calendar.events.owned` using the justification text in [Google sign-in and Calendar](#google-sign-in-and-calendar). The agent can script a short demo video.
7. **Create a reCAPTCHA v3 key for App Check (about 10 minutes).**
   1. Open https://console.firebase.google.com/project/uv-activity-planner/appcheck and choose the web app.
   2. Choose **reCAPTCHA** (v3), follow the link to create a key for the domain `solara-uv.web.app` (also add `localhost` for testing), and paste the secret into Firebase only.
   3. Send the agent the **site key** (public). Do not click **Enforce** yet; the agent will monitor traffic first and tell you when.
8. **Create a Sentry project (about 5 minutes).** Sign up at https://sentry.io (free Developer plan), create a project of type **Next.js** named `solara-web`, and send the agent the **DSN** (public).
9. **Confirm the price and tiers.** Pro at $2.99 per month or $19.99 per year with a 7-day trial, and the guest, free and Pro tiers in [ROADMAP.md](ROADMAP.md#tiers-proposed-owner-to-confirm). Reply "confirmed" or give changes.
10. **Keyless deploys, then delete the old key (about 15 minutes with the agent).** Follow [WIF_SETUP.md](WIF_SETUP.md) together, then delete the `FIREBASE_SERVICE_ACCOUNT` key (D4).
11. **Move public build values to GitHub variables (about 5 minutes).** The agent will provide exact `gh variable set` commands; you fill in the values.

### At Pro launch: Blaze

12. Upgrade the Firebase project to **Blaze** and create a **$5 per month budget alert** in Google Cloud Billing.
13. Create a staging Firebase project and a Stripe account in **test mode** (D9); the agent guides both.
14. Buy the Open-Meteo **Standard** commercial plan (about $29 per month) once the first subscription is live (D5).
15. Run the release checks in [Release verification](#release-verification).

### Later: mobile app (Wave 6)

16. Create an Apple Developer account ($99 per year) and a Google Play developer account ($25 once).

## Repository

- [ ] Turn on Dependabot alerts and Dependabot security updates (Settings, Code security).
  They work on private repositories too.
- [ ] Decide D2: make the repository public, or buy GitHub Pro.
  CI already scans every pull request with gitleaks and every push to `main` over the full history.
- [ ] Once it is public (or on Pro), turn on:
  - a ruleset for `main` that requires pull requests and the CI checks to pass;
  - a `production` environment with a required reviewer for the deploy jobs;
  - secret scanning with push protection, and private vulnerability reporting;
  - CodeQL default setup for JavaScript and TypeScript.

  Dependency review and build provenance attestation turn on by themselves when the repository is public.

## Credentials

- [ ] Run [WIF_SETUP.md](WIF_SETUP.md) so deploys and the notifier use short-lived credentials with separate identities.
- [ ] Delete the `FIREBASE_SERVICE_ACCOUNT` key and secret once both workflows run on WIF (D4).
- [ ] Move every `NEXT_PUBLIC_*` secret to a repository variable, then delete the secret, including the leftover `NEXT_PUBLIC_SITE_URL` secret ([steps](WIF_SETUP.md#move-public-build-values-from-secrets-to-variables)).

## Google sign-in and Calendar

The sign-in domain `solara-uv.web.app` is an authorized Firebase Auth domain, and Search Console verifies the site for the OAuth branding review.

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

The code supports reCAPTCHA Enterprise and reCAPTCHA v3; `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER` selects one, and v3 is the default.
Functions require App Check in code, so a site key is needed before any Function-backed surface is turned on.

- [ ] Decide D11: a new reCAPTCHA Enterprise key (recommended) or a v3 key.
- [ ] Register the production web app with that provider under App Check in the Firebase console.
- [ ] Store the site key as the `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` variable, and for Enterprise set `NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER=recaptcha-enterprise`.
- [ ] Choose when to enforce App Check for Firestore, after the metrics show legitimate traffic is verified ([App Check](DEPLOYMENT.md#app-check)).

## Functions and Stripe

Everything in this section waits for Wave 3 (W3-A); see [Firebase Functions and Stripe](DEPLOYMENT.md#firebase-functions-and-stripe) for the commands.

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

Notifications stay off until Wave 3 (W3-B) relaunches them on a scheduled Function (D6) and this real-device evidence is recorded.

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

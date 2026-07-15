# Solara Owner Actions

_Last reviewed: 2026-07-15_

This checklist contains only decisions, credentials, provider-console changes, legal facts, and physical-device evidence that the repository agent cannot supply safely.
The technical implementation is complete for the features listed below, but those features must remain disabled until their applicable owner actions and verification steps are complete.

## Immediate deployment unblock

- [ ] Confirm the `client_email` in the GitHub `FIREBASE_SERVICE_ACCOUNT` secret.
- [ ] Grant that service account the Google Cloud role `roles/datastore.indexAdmin` in project `uv-activity-planner`.
- [ ] Tell the repository agent that the role is granted.

The project-local credential found in Downloads identified `firebase-adminsdk-fbsvc@uv-activity-planner.iam.gserviceaccount.com`, but confirm that the GitHub secret uses the same identity before changing IAM.
The local JSON credential has been removed from Downloads.

After the role is granted, the repository agent can rerun deployment, wait for every declared index to become ready, run the notification workflow in dry-run mode, and inspect the result without needing another credential from you.

## Firebase Functions and billing

- [ ] Upgrade `uv-activity-planner` to the Firebase Blaze plan.
- [ ] Attach the intended billing account.
- [ ] Create a budget alert before enabling Functions.
- [ ] Approve enabling Function-backed account, billing, notification-registration, and calendar-feed surfaces after their provider configuration is ready.

After those actions, the repository agent can deploy Functions, determine the deployed Functions URL, configure the non-secret `ENABLE_BLAZE_FUNCTIONS` repository variable, redeploy the static client, and verify the deployment sequence.

## Stripe test configuration

- [ ] Create or choose the Stripe test-mode Pro price.
- [ ] Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Firebase Secret Manager.
- [ ] Store `STRIPE_PRICE_ID` in GitHub Actions secrets.
- [ ] Register the deployed webhook endpoint in Stripe test mode when its URL exists.
- [ ] Provide controlled test customer approval for checkout, webhook, portal, cancellation, and account-deletion verification.

Do not paste Stripe secrets into an issue, pull request, repository file, or chat message.
The repository agent can run the end-to-end test matrix and inspect provider logs after the values are stored in their intended consoles.

## App Check

- [ ] Register the production web app with the selected reCAPTCHA provider.
- [ ] Store the public site key as `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` in GitHub Actions secrets.
- [ ] Choose when enforcement may begin after monitoring shows legitimate production traffic is accepted.

The repository agent can redeploy and verify token attachment and failure behavior after registration.

## Google Calendar

- [ ] Create a Google OAuth web client.
- [ ] Add the production origin to its Authorized JavaScript origins.
- [ ] Store the client ID as `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` in GitHub Actions secrets.
- [ ] Provide a controlled Google account for consent, free/busy, event creation, and revocation verification.

Do not provide or expose an OAuth client secret because this browser integration uses a public client ID.

## Legal identity and licensing

- [ ] Provide the legal operator name for the Privacy Policy and Terms of Use.
- [ ] Provide a support and privacy contact email address or URL.
- [ ] Provide the governing jurisdiction and governing-law language to be reviewed by qualified counsel.
- [ ] Choose the repository license.
- [ ] Provide the copyright holder and year if the chosen license requires them.

The repository agent can insert and format the approved facts, but it must not invent legal identity, contact, jurisdiction, or license ownership.

## Physical notification verification

- [ ] Provide a real phone that can receive web push notifications.
- [ ] Provide or approve a controlled eligible paid test account.
- [ ] Approve one manual real notification send after the dry run is correct.
- [ ] Observe whether exactly one system notification appears and whether tapping it opens the intended route.
- [ ] Approve repeating the same dispatch to verify that no second notification appears.
- [ ] Approve ownership-transfer, disable-notification, and sign-out cleanup checks on the controlled device.

Scheduled notification delivery must remain disabled until this evidence is recorded.

## Completion handoff

When an item is complete, tell the repository agent which section changed without sharing secret values.
The agent can then perform every remaining deployment, log inspection, automated test, and safe production verification listed in [GO_LIVE.md](./GO_LIVE.md).

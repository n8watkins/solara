# Solara Go-Live Runbook

_Last reviewed: 2026-07-14_

Use this checklist for each production release.
The release is not complete until the automated gates and relevant real-service checks pass.

## 1. Local preflight

- [ ] Confirm the intended commits and a clean worktree.
- [ ] Run `npm ci` with Node.js 24.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build` with the intended public environment configuration.
- [ ] Run `npx playwright install chromium` if Chromium is not installed.
- [ ] Run `npm run test:e2e`.
- [ ] Review `npm audit` and document any accepted transitive advisories.

## 2. Configuration preflight

- [ ] Confirm all required Firebase client variables exist in GitHub Actions secrets.
- [ ] Confirm `FIREBASE_SERVICE_ACCOUNT` is valid and narrowly scoped.
- [ ] Confirm the production domain is an authorized Firebase Authentication domain.
- [ ] Confirm the VAPID key is present when notifications are enabled.
- [ ] Confirm App Check registration is monitored before enabling enforcement.
- [ ] Confirm optional Calendar, Stripe, Functions, and analytics variables match the features being released.
- [ ] Confirm Firestore indexes and rules are ready for the new code.
- [ ] Confirm a Firebase billing budget alert exists before deploying Functions.

## 3. Deploy

- [ ] Push the reviewed commits to `main`.
- [ ] Confirm the frontend and backend jobs pass every automated quality gate.
- [ ] Confirm the Hosting deployment succeeds.
- [ ] Confirm the Firestore rules deployment succeeds.
- [ ] Confirm the Functions deployment succeeds before the Hosting deployment starts.
- [ ] Record the deployed commit and Firebase release.

## 4. Production smoke test

- [ ] Load the production site on a private desktop browser session.
- [ ] Load the production site on a real phone.
- [ ] Complete onboarding through Google sign-in.
- [ ] Reload and confirm account preferences persist.
- [ ] Confirm the dashboard and calendar show consistent recommendations.
- [ ] Change location and confirm the forecast updates.
- [ ] Create and edit an activity.
- [ ] Verify Free and Pro gates with accounts controlled for testing.
- [ ] Check browser developer tools for errors and failed requests.
- [ ] Verify the PWA manifest and install behavior on supported platforms.

## 5. Notification verification

- [ ] Enable notifications on a controlled paid test account and device.
- [ ] Run the notification workflow with `dry_run = true`.
- [ ] Confirm the expected local date, timezone, activity, and device are selected.
- [ ] Run one real manual send, using `force_send = true` only if local-time eligibility must be bypassed.
- [ ] Confirm exactly one notification appears while the app is backgrounded.
- [ ] Confirm tapping it opens the intended route.
- [ ] Confirm a repeated dispatch does not duplicate the delivery.
- [ ] Disable notifications and confirm the device is no longer selected.
- [ ] Sign out and confirm the previous account is no longer associated with that device.

## 6. External integrations

Complete only the sections activated for this release.

### Stripe

- [ ] Use Stripe test mode first.
- [ ] Confirm checkout is bound to the authenticated account.
- [ ] Confirm a paid event grants the expected entitlement once.
- [ ] Replay the event and confirm idempotency.
- [ ] Confirm cancellation and payment failure revoke or restrict entitlement as designed.
- [ ] Open the authenticated customer portal and verify payment updates, invoices, and cancellation.
- [ ] Confirm webhook signature failures do not mutate Firestore.

### Google Calendar

- [ ] Complete OAuth consent on the production origin.
- [ ] Confirm only free/busy data is used.
- [ ] Create a test event and verify its date, time, timezone, and description.
- [ ] Revoke access and confirm Solara handles the disconnected state.

### Calendar feed

- [ ] Subscribe from a real calendar client.
- [ ] Confirm the feed refreshes after forecast or preference changes.
- [ ] Rotate the feed token and confirm the old URL stops working.

## 7. Post-release

- [ ] Review Firebase, GitHub Actions, Stripe, and browser error telemetry.
- [ ] Confirm notification dispatch metrics do not show duplicate or repeated sends.
- [ ] Confirm no secrets or full device tokens appear in logs.
- [ ] Keep the previous Hosting release available for rollback.
- [ ] Record external checks that could not be completed and assign a follow-up owner.

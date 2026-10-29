# Android readiness

_Summarised 2026-10-28 from the eighth review's Android readiness assessment (REVIEW8 PLAN, part 3), checked against `main` at #144._
_This is a plan, not built code: nothing Android-specific exists in the repository yet._

[ROADMAP item 13](../ROADMAP.md#13-wave-6-mobile-app-owners-learning-project) makes the Expo (React Native) app the owner's own learning project.
This page lists what the web app and the backend need so that project is easy, the decisions it depends on, and the owner steps it will add.
Overall, the backend is ready for a native client; the work is in four places: Play's billing rules, the push payload shape, OAuth clients per platform, and moving more pure logic into `packages/core`.

## Decision: Pro is bought on the web, the app is consumption only

_Default, owner may change (2026-10-28)._

- The Android app reads Pro from the same Firestore account (`tier` and `subscriptionStatus`) and unlocks it, but never shows a price, a checkout or an "upgrade" button; Pro is bought on the web with Stripe.
- Play's payments policy normally requires Google Play Billing for digital subscriptions sold inside an app, but allows apps that let people use what they bought elsewhere, as long as the app does not steer them to buy outside Play.
- In the United States, since the Epic ruling took effect in October 2025, apps may also link out to web payments, with a Google service fee on those transactions from mid-2026; other regions (the EEA, the UK) have their own alternative billing programs with fees.
  The details differ between sources, so check Google's Play Console help pages before choosing anything other than consumption only.
- If in-app purchase is wanted later: Play Billing (or RevenueCat on top of it) plus a Function that verifies purchases and Play's real-time notifications and writes the same entitlement.
  `functions/src/billing/entitlement.ts` reads only Stripe's fields today; a `subscriptionProvider` field (`stripe` by default) would let a Play or Apple source be added without touching every check, and the account page and export would then name the store, to catch someone subscribed on both.

## Sharing `packages/core`

- `packages/core` is an npm workspace published as TypeScript source with only Valibot as a dependency, so Expo's Metro bundler can use it from the same monorepo (`watchFolders` and the workspace root's `node_modules`).
- `packages/core/src/events.ts` uses `crypto.subtle` for a SHA-256 digest, which React Native's Hermes engine does not have; pass the hash function in, or use `expo-crypto` or a small pure SHA-256.
- `packages/core/src/zoned-time.ts` and `packages/core/src/alerts.ts` use `Intl.DateTimeFormat` with time zones and `formatToParts`; recent Hermes versions support these, but test it early.
- Much pure planning logic still lives in the web app's `lib/` and would otherwise be copied: `lib/tiers.ts` (which `firestore.rules` mirrors), `lib/planner.ts`, `lib/scheduler.ts`, `lib/next-slot.ts`, `todayOver` in `lib/dashboard-view.ts`, `lib/skin-quiz.ts`, `lib/reapply.ts`, `lib/uv-strip.ts`, `lib/weather.ts`, and the key-list maths in `lib/key-index.ts` (the rules enforce the event and scheduled caps through key lists the client must write exactly right).
  Moving these into core is the single most useful preparation.
- Keep the offline cache record shapes as Valibot schemas in core too, so both clients read and migrate the same format (the native app would use Firestore's offline cache and MMKV or AsyncStorage for the forecast).

## Firebase Auth: native OAuth clients

- The web signs in with `signInWithPopup`; the native app gets a Google ID token from Credential Manager (or Google Sign-In) and calls `signInWithCredential`.
- The same Google account gives the same Firebase uid, so data, Pro and the trial history (keyed on the Google id) carry over.
- **Google Calendar:** the web's token client in `lib/gcal.ts` is browser-only; Android asks for the Calendar scopes through Google's Android authorization API with the Android OAuth client, which returns an access token with no client secret and no redirect to register.
  Scope verification belongs to the Google Cloud project and its consent screen, so the scopes verified for the web should cover the Android client; Google may ask for a video of the Android flow.
  The Calendar REST calls can be shared if they move from `lib/gcal.ts` into core with the token passed in.
- **Outlook:** add a "Mobile and desktop applications" (Android) platform to the same Entra app registration, with a redirect such as `msauth://<package>/<signature hash>`; PKCE stays, and the app still never asks for `offline_access`, so there is still no refresh token, as the privacy policy promises.
  The web's SPA redirect `https://solara-uv.web.app/auth/microsoft/` stays web-only.

## App Check: Play Integrity

- Every Function is plain HTTPS with `Authorization: Bearer <Firebase ID token>` and `X-Firebase-AppCheck`; React Native Firebase provides both, including the limited-use tokens that checkout and deletion require.
- The Functions verify App Check tokens whichever provider minted them, so Play Integrity works with no server change.
- A native request sends no `Origin` header, and the Functions refuse only a wrong `Origin`, so their CORS check lets native requests through.
- Ship App Check in the first Android build: once Firestore enforcement is on (owner checklist A7), it applies to every app of the project.
- Play Integrity's standard tier is free up to 10,000 calls a day.
- Worth adding before the first build: a client version header on Function calls, logged now, so the server can later refuse a too-old build cleanly.

## Push payloads

- The web already uses Firebase Cloud Messaging, and the server already accepts `platform: 'android'` and `'ios'` device registrations and sends with `messaging.sendEach`, so native tokens can register at the same endpoint.
- Today's messages are data-only (`functions/src/notifications/alerts.ts`: title and body inside `data`, shown by the web push worker).
  On Android a data-only message is shown only if the app's own background handler runs, which is unreliable after the app is swiped away or in battery saver, and normal priority can be delayed in Doze.
- Change when the app starts: for `platform: 'android'` tokens, add `android.notification` (title, body, channel) and `priority: 'high'` for UV alerts, keep the `collapseKey`, and keep data-only for the web; the platform is already stored per device.
- iOS later: use React Native Firebase messaging (Expo's notification library gives an APNs token, not an FCM one) and upload an APNs key to Firebase.

## Android App Links (assetlinks.json)

- Needed: `https://solara-uv.web.app/.well-known/assetlinks.json` with the package name and the SHA-256 of Play's app signing key, served from `public/.well-known/` (new).
- `firebase.json` ignores `**/.*`, but the review's probe ran firebase-tools' own upload list and confirmed that `.well-known/` files are uploaded, and Hosting serves .json files as `application/json`, which Android checks.
  An iOS `apple-app-site-association` file (no extension) would need a `Content-Type` header in `firebase.json`.
- Paths to claim: `/app/*` and `/share/*`; never `/auth/microsoft/`, whose sign-in hand-back must stay in the browser.
  Push links already open `/app/`, so they open the app once App Links verify.

## A Trusted Web Activity as the first Play listing

A Trusted Web Activity (TWA) wraps the live PWA in Chrome full-screen; Bubblewrap or PWABuilder produce one in about a day.
It is a sensible first listing: it reuses the offline shell, web push through Chrome and Google sign-in, starts the closed-testing clock, and teaches the Play Console before the Expo app exists, which can later replace it under the same package name.
It cannot give home-screen widgets, local notifications without a server, or native Calendar sign-in.

What the PWA needs first:

- `/.well-known/assetlinks.json` (above).
- A store build that hides every price, upsell and checkout inside the Play listing (for example a `start_url` of `/app/?source=twa` remembered for the session, or a referrer starting with `android-app://`); a TWA that shows Stripe checkout outside the US programs would break Play's payments policy.
- Manifest polish: an `id`, `shortcuts`, `share_target` (which also gives the deferred Web Share Target for .ics files) and `screenshots`.
- Optionally a same-site auth domain: setting `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to `solara-uv.web.app` (Hosting serves `/__/auth/` on every site of the project) plus the redirect URI `https://solara-uv.web.app/__/auth/handler` on the OAuth client makes sign-in same-site, which helps inside Custom Tabs and Safari.
- Account deletion from the web without the app, which Play requires as well as an in-app option: the account page does it in the browser on Spark, and through the Functions once they run ([ROADMAP item 33](../ROADMAP.md#33-account-download-and-deletion-without-functions-fix8b-built)).

## Play Store requirements

- **Closed testing:** a personal developer account created after November 13, 2023 must run a closed test with at least 12 testers for 14 days in a row before its first production release; an organisation account (it needs a D-U-N-S number) is exempt.
  Start this clock early, even with a TWA.
- **Target SDK:** new apps and updates must target Android 16 (API 36) since August 31, 2026; a current Expo SDK does this.
- **Privacy policy:** `/privacy/` exists and will need an Android section (Play Integrity, FCM on the device, device identifiers).
- **Data safety form:** name, email, approximate and possibly precise location, calendar events (titles, times, places), device identifiers (the FCM token), crash logs (Sentry), optional analytics, and purchase history (through the web).
- **Account deletion:** an option inside the app and a web link that works without the app.
- **Health features declaration:** may apply to a skin-type and sun-exposure app; check the form.
- **Cost:** the developer account is $25 once.

## Owner steps it will add

These join the [owner checklist](../OWNER_CHECKLIST.md#later-mobile-app-wave-6) when the Android work starts:

1. Create the Google Play developer account and start the 12-tester closed test.
2. Add the Android app to the Firebase project (package name, and the SHA-1 and SHA-256 of the debug key, the upload key and Play's app signing key), download google-services.json, and create the Android OAuth client for that package and SHA-1.
3. Register the app for App Check with Play Integrity, and link the Play Console app to the Google Cloud project.
4. Add the Android platform to the Entra app registration if Outlook events are on.
5. Send the agent Play's app signing SHA-256 for assetlinks.json.

## Web changes worth making now, ranked

1. Done: self-service account download and deletion work without the Functions (#147), so the web deletion link Play needs exists.
2. Move the pure logic listed above from `lib/` into `packages/core`, including the Google Calendar and Microsoft Graph REST calls with the token passed in.
3. Replace or inject `crypto.subtle` in `packages/core/src/events.ts`, and add a Hermes-like test of `Intl` time-zone parts.
4. A `subscriptionProvider` field on the entitlement, defaulting to `stripe`.
5. Platform-aware push payloads for Android tokens, tested in the alerts emulator test.
6. A store build flag that hides every price, upsell and checkout.
7. A client version header on Function calls.
8. Manifest `id`, `shortcuts` and `share_target`, and a test that the export ships `/.well-known/` files with the right type.
9. The same-site auth domain, an owner step plus one variable.

# Android readiness

_Summarised 2026-10-28 from the eighth review's Android readiness assessment (REVIEW8 PLAN, part 3), checked against `main` at #144._
_The web-side groundwork is built ([ROADMAP item 38](../ROADMAP.md#38-android-groundwork-in-the-web-repo-androidprep-built)); there is no Android app or Play listing yet._

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
  Built: the account has a server-owned `subscriptionProvider` (`SUBSCRIPTION_PROVIDERS` in `packages/core/src/subscription.ts`), which the Stripe webhook writes as `stripe` and every reader takes as `stripe` when it is absent.
  `hasProEntitlement` (`functions/src/billing/entitlement.ts`) applies Stripe's statuses only to a Stripe subscription and grants nothing for a provider it does not know, so a Play or Apple source needs its own check there and an entry in that list.
  The account page offers the Stripe portal only for a Stripe subscription, and the export names the provider, to catch someone subscribed on both; the rules keep the field server-only.

## Sharing `packages/core`

- `packages/core` is an npm workspace published as TypeScript source with only Valibot as a dependency, so Expo's Metro bundler can use it from the same monorepo (`watchFolders` and the workspace root's `node_modules`).
  Every module is its own entry point (`@solara/core/<module>`, for example `@solara/core/planner`), and Functions load the same files as `#core/<module>`.
- Built: the planning logic now lives in core, with its tests: plan limits (`tiers.ts`, which `firestore.rules` mirrors and `PREFS_LIMITS` reads), the forecast day shapes (`forecast-days.ts`), per-day activity windows (`weather.ts`), the next actionable slot (`next-slot.ts`), the scheduler, the planner, today's state at the place (`day-view.ts`: `todayOver`, `sunDown`), the skin quiz, the reapply timer, the UV strip's layout and wording, and the key-list maths (`key-lists.ts`: caps, `fitToCap`, `reconcilePlan`), which the linked-calendar Function now uses too.
  The web's `lib/` files re-export them; only browser code stays there (localStorage for the reapply timer, CSS colors, the Google Calendar link, Firestore reads and writes).
  `packages/core/src/portable.test.ts` fails if core uses `window`, `document`, browser storage, `navigator`, Web Crypto, `TextEncoder`, `Buffer` or `process`, or imports anything but its own modules and Valibot.
- Built: `packages/core/src/events.ts` hashes keys with core's own SHA-256 (`sha256.ts`), because Hermes has no `crypto.subtle`; `sha256.test.ts` proves the digests equal Node's and Web Crypto's on the FIPS 180-4 vectors, every length to 300 bytes, a million bytes, Unicode and lone surrogates, and that every stored event key is unchanged.
- Built: core reads a time zone's wall clock with `formatToParts` where the engine has it and from `format()` of a fixed en-US pattern where it does not (`packages/core/src/zoned-time.ts`; `alerts.ts` now uses the same function).
  What was checked: Hermes's own list of Intl APIs (`doc/IntlAPIs.md` in facebook/hermes, read 2026-10-28) lists `Intl.DateTimeFormat` with `format`, `resolvedOptions` and `supportedLocalesOf` on Android and iOS, but `formatToParts` only for `NumberFormat` on Android, and refuses `dayPeriod`, `fractionalSecondDigits` and `formatMatcher` (Android) and `numberingSystem` and `formatMatcher` (iOS); `hourCycle` is not mentioned.
  `packages/core/src/hermes-intl.test.ts` runs the wall clock, local times, zone offsets, instants, dates, sunrise, sunset and the sun's phase in ten zones (half-hour and 45-minute offsets, both hemispheres' daylight saving changes) on an `Intl.DateTimeFormat` with only that surface and `hourCycle` ignored, and gets the same answers as with the full Intl.
  Still worth running core's tests on a real Hermes build once the Expo app exists.
- Still to do: keep the offline cache record shapes as Valibot schemas in core too, so both clients read and migrate the same format (the native app would use Firestore's offline cache and MMKV or AsyncStorage for the forecast), and move the Google Calendar and Microsoft Graph REST calls into core with the token passed in.

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
- Built: every Function call names its build in `X-Solara-Client: <platform>/<version>` (`packages/core/src/client-version.ts`; the web sends `web/<commit>`, from `GITHUB_SHA` at build time).
  The Functions validate it, allow it in CORS, log each build once a minute per instance after App Check passes, and name it on every rejection (`functions/src/shared/http.ts`), so a too-old native build can later be refused cleanly; a native app sends `android/<version>`.

## Push payloads

- The web already uses Firebase Cloud Messaging, and the server already accepts `platform: 'android'` and `'ios'` device registrations and sends with `messaging.sendEach`, so native tokens can register at the same endpoint.
- Today's messages are data-only (`functions/src/notifications/alerts.ts`: title and body inside `data`, shown by the web push worker).
  On Android a data-only message is shown only if the app's own background handler runs, which is unreliable after the app is swiped away or in battery saver, and normal priority can be delayed in Doze.
- Built: for a device registered with `platform: 'android'`, `functions/src/notifications/alerts.ts` sends `android.notification` (title, body, the channel `solara-alerts` from `packages/core/src/push.ts`, and the delivery key as its tag) with `priority: 'high'` and the same `collapseKey`; web devices stay data-only, as the push worker needs.
  The native app must create the `solara-alerts` channel (`ANDROID_ALERT_CHANNEL` has its name and description) before Android shows these.
  `functions/test/emulator/alerts.test.js` checks both shapes for one account with a web and an Android device.
- iOS later: use React Native Firebase messaging (Expo's notification library gives an APNs token, not an FCM one) and upload an APNs key to Firebase.

## Android App Links (assetlinks.json)

- Needed: `https://solara-uv.web.app/.well-known/assetlinks.json` with the package name and the SHA-256 of Play's app signing key, served from `public/.well-known/` (new).
- `firebase.json` ignores `**/.*`, but firebase-tools' own upload list includes `.well-known/` files, and Hosting serves .json files as `application/json`, which Android checks.
  Built: `tests/well-known.test.ts` runs that upload list with `firebase.json`'s ignore and checks no header rule changes the type, and `scripts/check-well-known.mjs` (after every build) fails when a file in `public/.well-known/` (new) is missing from the export, changed, not valid JSON or without an extension.
  The assetlinks.json file itself waits for the package name and Play's signing key.
  An iOS `apple-app-site-association` file (no extension) would need a `Content-Type` header in `firebase.json`.
- Paths to claim: `/app/*` and `/share/*`; never `/auth/microsoft/`, whose sign-in hand-back must stay in the browser.
  Push links already open `/app/`, so they open the app once App Links verify.

## A Trusted Web Activity as the first Play listing

A Trusted Web Activity (TWA) wraps the live PWA in Chrome full-screen; Bubblewrap or PWABuilder produce one in about a day.
It is a sensible first listing: it reuses the offline shell, web push through Chrome and Google sign-in, starts the closed-testing clock, and teaches the Play Console before the Expo app exists, which can later replace it under the same package name.
It cannot give home-screen widgets, local notifications without a server, or native Calendar sign-in.

What the PWA needs first:

- `/.well-known/assetlinks.json` (above).
- Built: a store build that hides every price, upsell and checkout (`lib/store-build.ts`); a TWA that showed Stripe checkout outside the US programs would break Play's payments policy.
  It is on for a build with `NEXT_PUBLIC_STORE_BUILD=1`, or for a session whose first page had a referrer starting with `android-app://` or `?source=twa` in its URL (use `/app/?source=twa` as the TWA's start URL), remembered in sessionStorage for the session.
  Then the plans dialog offers a guest only free sign-in (no Pro column, price or waitlist) and never opens for an account; the locked forecast days, "Get this as a morning alert", the family profiles offer, the events' "See Pro", the Calendar's "Go Pro" note, Settings' "See Pro plans", the activity limit's "Upgrade to Pro", checkout and the account page's Stripe portal are gone; the landing page goes straight to `/app/`.
  Pro bought on the web still shows and unlocks everything; `tests/harness/store-build.spec.ts` checks each surface against the same screen on the web.
- Manifest: built, an `id` (`/app/`, the start URL browsers used as the id before, so existing installs stay the same app) and `shortcuts` (today's plan, typical UV by city), checked by `tests/manifest.test.ts`; still to do, `share_target` (which also gives the deferred Web Share Target for .ics files) and `screenshots`.
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
2. Done (item 38): the pure planning logic is in `packages/core`; still to move, the Google Calendar and Microsoft Graph REST calls with the token passed in, and the offline cache shapes.
3. Done (item 38): core's own SHA-256 instead of `crypto.subtle`, and a Hermes-like test of `Intl` time zones.
4. Done (item 38): a `subscriptionProvider` field on the entitlement, defaulting to `stripe`.
5. Done (item 38): platform-aware push payloads for Android tokens, tested in the alerts emulator test.
6. Done (item 38): a store build flag that hides every price, upsell and checkout.
7. Done (item 38): a client version header on Function calls, logged now.
8. Done (item 38): manifest `id` and `shortcuts`, and checks that the export and the upload ship `/.well-known/` files as JSON; still to do, `share_target` and `screenshots`.
9. The same-site auth domain, an owner step plus one variable.

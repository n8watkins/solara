# Solara status

_Last reviewed: 2026-11-01_

This is the single page for the current state of Solara: what is live, what is built but switched off, how CI/CD runs, and which owner actions are done or open.
Facts were checked against the code, the workflows, GitHub (`gh`) and the live site on the date above.
Items marked "owner reported" depend on a console the repository cannot read.
The plan for the remaining work is in [ROADMAP.md](ROADMAP.md); the owner's steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Live at https://solara-uv.web.app

Solara is served from the Firebase Hosting site `solara-uv` in project `uv-activity-planner`, on the free Spark plan.
The original address, `https://uv-activity-planner.web.app`, permanently redirects every path to the same path on `solara-uv.web.app`, except Firebase's reserved `/__/` paths (#42, #45).
Every merge to `main` deploys; every deploy from #126 to #155 was green, the deploy for #154 was cancelled twice when the UI harness hit its 20-minute limit (REVIEW9 QA H1), and since #157 runs the harness in four parallel shards, the deploy for #157 (run 40910709133, 2026-10-29, about 8 minutes) shipped #154 and #157.
The deploy for #159 (run 41280087014) stopped before Hosting on a flaky signed-in test, so #159 went live with #160; that test and the flaky Microsoft redirect test are fixed (ROADMAP item 50).
#79 and #81 fixed the findings of the first post-launch code review (Google sign-in popup and quota handling, the Scheduled list query, plan limits in the Firestore rules, the feed limiter's client address).

What users get:

- A static landing page at `/` (no framework JavaScript, nothing from Firebase) and the app at `/app/`; a browser with a signed-in account that opens `/` goes to the app (#71).
- Guest mode: the app works without signing in, on the guest plan (today's forecast, one activity, kept only in this browser, which Solara asks to keep its storage; Safari can still clear it after 7 days without a visit, so the landing offers sign-in instead of promising it stays, ROADMAP item 51).
  A guest changes skin type, theme, units and the rest of Settings from the header's Settings button or "Edit" beside the skin type on the burn card (ROADMAP item 37).
  Google sign-in is free and syncs to Firestore; a guest plan carries into a brand-new account on its first sign-in and never into an existing one.
  A guest who signs in to an existing account is told once that the account kept its own plan, and which activities, place and skin type from the guest plan were not added.
- A guest never downloads Firebase: the dashboard shows from the guest plan and cached forecast at once, and Firebase loads only when someone reaches for "Sign in" or the browser already holds a session (#83).
  Lighthouse mobile LCP for `/app/` is 2.2-2.4 s on the live site (measured 2026-10-29; was 4.4-6.3 s), and a guest's first load is about 187.8 KB gzip of JavaScript in English and 193.2 KB in Spanish on a build configured like production (192.5 KB and 198.1 KB before ROADMAP item 52, 190.7 KB and 196.1 KB before item 51, 192.4 KB and 218.5 KB before item 50; about 185 KB before the language setup) (was over 500 KB; 192.1 KB after ROADMAP item 38), with Valibot instead of Zod, a small forecast store instead of TanStack Query and more parts loaded on demand (#83, #93), including the install prompt and the dashboard's activity plan, which a new guest's plan never shows (#127).
  ROADMAP item 39 took off about 10 KB: the React Compiler is off (8 KB), the slot planning loads with the activity plan and the analytics code loads only when it has something to do.
  ROADMAP item 52 took Valibot out of it: the forecast, its cache and a plan in the form the app saves (a guest's, or an account's copy in this browser) are checked by hand-written code, and the preferences schema loads only to repair a plan in any other form (once; it is then saved repaired).
  `tests/e2e/budget/first-load.budget.ts` (`npm run test:e2e:budget`, in CI's static export job) holds them under 190 KB and 196 KB, and fails if Valibot, Firebase or Google Analytics is among those scripts.
- A returning account's dashboard shows at once from this browser's copy of it while Firebase loads and Auth confirms the session, and accepts no input until then; signed-in start-up LCP went from about 5.5 s to the same as a guest's (#93).
  Auth's sign-in popup helper (an iframe and Google's scripts) starts only when a sign-in or reauthentication is about to happen.
- The installed app opens offline (#94): the app-shell service worker (`/sw.js`) precaches `/` and `/app/` with every file they load, and the app shows the last forecast for the place from this browser's cache with an offline notice that says when it was updated.
  A signed-in account opens read-only from this browser's copy and goes live once the browser is back online.
  Pages always come from the network while online, a deploy installs a new worker that takes over at once and deletes the old caches, a tab left open across a deploy reloads once to the new version when code it asks for is gone from the server and says why (ROADMAP item 51), and the worker never handles or stores anything cross-origin (Open-Meteo, Firestore, Auth, Functions) or account-specific; the one thing it keeps besides the shell is a calendar file or link shared to the app, for up to 30 minutes (ROADMAP item 42).
  Lighthouse 11's installability and PWA checks pass.
- The confirmed plans from `packages/core/src/tiers.ts`: Guest (today, 1 activity, this device), Free (today and tomorrow, 3 activities, synced, calendar export, and once alerts are on the daily UV push and reapply reminders by push) and Pro (10 days, 20 activities, calendar export, family profiles, morning alerts); "calendar export" reads "calendar sync" once Google Calendar or the live feed is switched on (`calendarFeatureLabel` in `lib/plans.ts`).
  Pro shows $2.99 a month or $19.99 a year with a 7-day free trial, as a waitlist until billing launches.
  Gentle upsells ("Save your plan, sign in free", "See the next 10 days with Pro", "Get this as a morning alert") open the sign-in or plans dialog and stay dismissed per device.
- Skin types named by the Fitzpatrick scale (types I to V-VI) in setup, Settings and profiles, with an optional five-question quiz from the standard Fitzpatrick questionnaire that suggests one and says it is an estimate, not medical advice.
- A sunscreen reapply timer on today's dashboard, free on every plan including guests (`components/dashboard/ReapplyTimer.tsx`, `lib/reapply.ts`): started when heading out, it reminds every 2 hours, or every 80 minutes while swimming or sweating.
  It lives in this browser; the reminder is the card itself, which turns into an alert, plus a system notification while Solara is open in the background where the browser allows one.
  Built and switched off with the alerts (ROADMAP item 40): for a signed-in account the timer also keeps one "remind me at" record (`users/{uid}/reminders/reapply`, validated by the rules), and the server sends the reminder as a push at its time through Cloud Tasks, with the `alerts` job as a backstop, so it arrives with every tab closed; the push and the tab share one tag, so a device shows it once, and Stop deletes the record ([Free pushes](DEPLOYMENT.md#free-pushes-the-daily-uv-push-and-reapply-reminders)).
  Until `ALERTS_ENABLED` is on, nothing arrives once every Solara tab is closed.
- Sunscreen coaching (ROADMAP item 45, `packages/core/src/sunscreen.ts`, sources in [SUNSCREEN.md](SUNSCREEN.md)): the timer's "How much sunscreen?" gives today's SPF for the skin type (SPF 30+ broad spectrum from UV 3, SPF 50+ from UV 8 or for types I and II), about a teaspoon per body part and 7 (35 mL) for the whole body, and when to reapply; each activity card planned for UV 3 or more says how much its usual clothing leaves to cover ("about 5 tsp for face, arms, legs"), and Settings, Sun profile, gives the SPF rule for the chosen skin type.
  An activity planned without sunscreen that lasts longer than the skin's burn time at its UV limit (Running, 45 min at UV 4, for fair skin that burns in about 38) says so wherever its window is offered: the recommended slot or the card, the hero and the daily briefing (decision "Burn-time warning", ROADMAP item 50).
  Nothing new is stored.
- Vitamin D log (ROADMAP item 48), kept only in this browser and on by default (`VITAMIN_D_LOG=false` hides it): a "Vitamin D log" button under the dashboard's estimate cards opens it on demand, and an activity card that is done for today offers "Log it", which logs the slot the plan recommended.
  Each session (date, start, length, the skin in the sun from four presets, sunscreen; the UV from today's forecast, or typed in for an earlier day) shows its estimated vitamin D and how close it came to the burn time, from the same calculation as the dashboard card (`packages/core/src/vitamin-d.ts`); today's and the last 7 days' totals sit beside a commonly cited daily amount (600 IU, US National Academies 2011), with a 7-day chart that reads as a table to a screen reader.
  No goals, streaks or badges; time past the burn time adds no vitamin D, and age is not modelled (the help text says so).
  Entries are pruned after a year, kept per owner (a guest, or each account: a sign-out hides an account's log until it signs back in, and a guest's moves to the account that signs in), removed by "Delete all" or the account's deletion, included in the account page's download, and downloadable from the log.
- Languages (ROADMAP item 46, [how it works](i18n/README.md)): the app, the account page and shared plans in English and Latin American Spanish, from the device's language or the choice in Settings, Display (synced for an account).
  English is built into the code; Spanish downloads the opening screen's translations before the app shows, so nothing changes language on screen, and each other part's translations with that part ([how it works](i18n/README.md)).
  The place search and the reverse lookup ask in the page's language, so a Spanish speaker finds "Ciudad de México" and "Nueva York", and same-named places are ranked with the most populous first.
  The landing page, the privacy policy, the terms and the city pages have Spanish addresses under `/es/` (`/es/`, `/es/privacy/`, `/es/terms/`, `/es/uv/`, `/es/uv/<city>/`), static like their English pages, with `<html lang="es">`, `hreflang` links both ways (English as x-default), sitemap entries and a link to the other language on each page; the Spanish legal pages are full translations that say the English version prevails.
  Pushes and the calendar feed follow the account's `language` when one is chosen in Settings, else (on Automatic) its `deviceLanguage`, the language the app last resolved from a device (only `en` or `es`, saved only when it changes, so the last device to open the app wins), else English; the privacy policy says so.
  The icon picker's search understands Spanish words.
  The Spanish safety wording and the Spanish legal pages wait for a native speaker's review ([es-review.md](i18n/es-review.md)), and the legal pages for counsel's too.
- UV and weather forecasts from Open-Meteo, in the location's time zone, with Celsius or Fahrenheit and 12- or 24-hour time chosen from the locale or in Settings.
  When Open-Meteo does not answer, the app says the forecast service is not answering and tries again every minute; without any forecast the dashboard shows "No forecast yet" with "Try again now" (ROADMAP item 37).
- Personalized activity windows on the dashboard and in the week calendar, within each plan's days.
  Each activity can account for its typical shade and the surface around it (grass, pavement, water, sand, snow), which scale the UV it is planned against with cited, cautious factors; the card says so ("Sand, some shade · 90% of forecast UV").
  Plans assume a clear sky, which stays safe if forecast clouds break; an activity with "Account for cloud cover" on plans with the forecast's clouds instead, counted once (#114), and the calendar feed plans the same way.
  Windows and slots also skip likely rain (a 50% or higher chance) and hours that feel hotter than the activity's limit (ROADMAP item 41, `packages/core/src/weather-fit.ts`), from the same Open-Meteo request: water sports go ahead in rain, running and other strenuous activities stop at a feels-like 90°F (32°C), the rest at 100°F (38°C), and each activity can change both under "Rain and heat".
  Where the weather moved a slot or took it away, the hero, the card, the briefing and the morning alert say so in plain words ("Rain likely 6pm–7pm", "Too hot 4pm–6pm, feels like 93°F"), the UV readout names likely rain for its hour, and an event heads-up adds a line when the event will feel too hot.
- A daily briefing at the top of the dashboard (#108): the day's peak UV and time (and the clear-sky peak when clouds lower it), the lowest-UV window for the plan, the burn time at the peak and one line of advice, shareable; after sunset it briefs tomorrow (on the guest plan it offers sign-in instead).
  Its advice says when to use sun protection from one shared calculation (`packages/core/src/protection.ts`, ROADMAP item 44), the same times as the Pro alerts and the free daily UV push, and leans on the clear sky as the plans do, so a cloudy day whose clouds may break never reads "little sun protection" (the decision "Cloudy days" in [ROADMAP.md](ROADMAP.md#decisions)).
  Durations read "45 min" or "2 h 47 min" and time ranges "9am–10:30am" everywhere (ROADMAP item 44).
  The hero above the UV card names the activity's next slot ("Next slot for Running"), so the two never both claim to be the "best".
  Both turn the page at the same moment, the place's sunset (`todayOver` in `packages/core/src/day-view.ts`, ROADMAP item 28): until then the briefing covers today and the hero stays.
  The hero's time stays on one line and its detail line reads in full from 320 px, with "Start now" on the label's row.
  The UV card's line under its reading wraps after a dot instead of cutting the weather off at 320 px, and the current hour's chip shows the live reading as "Now", the same value as the reading above it (ROADMAP item 30).
- From 320 px (ROADMAP item 31): the header's place name wraps to a second line instead of being cut off ("San Luis Obispo, California" reads in full; under 360 px the header shows the Solara mark without its wordmark), the day chips share one row with the refresh button, and "Best day this week" never splits a time range.
  The vitamin D card says what its minutes stand for, about 1,000 IU on arms and legs, with the rule of thumb and its source in its help text (owner, 2026-11-01).
  While the sun is up but UV is under 0.5, the burn and vitamin D cards say "No burn risk" and "UV too low" in words on the number's line, with when that changes ("Until 9am tomorrow"), instead of a large "None"; a screen reader hears their minutes as "21 minutes".
- No slot is ever offered in the dark (ROADMAP item 28): every window is cut to the day's daylight at the place, from the first 5-minute step after sunrise to the last before sunset (`daylightHours` in `packages/core/src/sun-times.ts`), in the hero, the activity cards, the week calendar, the briefing, the morning alert and the calendar feed, though the UV there is 0.
  An activity whose preferred hours fall in the dark is told so, and "% of daylight hours fit" counts only hours with the sun up.
- After dark the UV card says once when UV returns (no burn and vitamin D cards repeating it), and the hour strip opens where UV returns, also in the hour right after sunset.
  Whether the sun is up comes from the place's sunrise and sunset, worked out for its own date and time zone (`packages/core/src/sun-times.ts`), not from the UV: a low morning or evening sun shows its reading ("0.4 Low now"), in the UV card and in setup's UV preview, instead of "Before sunrise" or "Sun is down" (REVIEW6 L7).
- Every UV value is written with one decimal (`formatUV` in `packages/core/src/uv-scale.ts`): hour chips, briefing, alerts, calendar feed and city pages quote the same number.
  Every UV category is the WHO's (`uvLabel`): an index of 0 reads "Low", as the scale legend says (Low is 0-2), never "None" (ROADMAP item 28).
- Cloud-aware forecasts (#110): the dashboard and the week view say when the forecast clouds lower UV, against the clear-sky UV, and how much to trust each day (fair confidence from day 4, low from day 7).
- Forecast hours are read on the place's own clock, so the days after a daylight saving change are not an hour off, and a day is planned from 6:00 to 20:59 or longer while the sun is up (polar day); the hourly strip is one Tab stop with the arrow keys between hours; each language has its own social card (ROADMAP item 51).
- City pages for search (#111): `/uv/` and `/uv/<city>/` for 50 cities, static with no framework JavaScript, with the typical UV by month from checked-in CAMS data and a link that opens setup on the city; listed in the sitemap and linked from the landing page.
  Each city page carries structured data (JSON-LD), hashed into its CSP at build time; the landing and city pages follow an OS theme change while open, like the app.
- Place suggestions while typing a town in setup, the header's location panel and Settings (Open-Meteo place search based on GeoNames, at most one request per second, keyboard and screen-reader friendly) (#80, #95), in the page's language and with the most populous places first (ROADMAP item 50).
- Saved locations, share links (`/share/`), a one-off calendar file download from Plan ahead, and family profiles on Pro.
- Imported events for signed-in accounts (Wave 5 item 9, phase 1): the dashboard's Events section imports an .ics file (Meetup, Eventbrite, race sites, any calendar), read in the browser, and shows each upcoming event with the UV during it at its place, the burn time for the planning skin type (the most sensitive person in a group), the activity's shade and surface, and sunscreen timing.
  Places come from the event's coordinates or its location text at city level, else the person's place with a "Set the place" fix; events are kept in `users/{uid}/events` (rules-checked, in the account export, deleted with the account, and expiring 30 days after they end).
  The file is parsed in a Web Worker within a fixed work allowance, so no file can freeze the page; an account keeps at most 1,000 imported events (and 500 scheduled activities), enforced by the rules; the list shows the soonest upcoming events however many are stored, "Remove imported events" removes every imported one (keeping linked and Google Calendar events, which their next refresh would bring back, REVIEW5 L2), and a re-import removes events the calendar cancelled (REVIEW4 M2, M3, M4, L1-L3).
  On Android, an .ics file or a calendar link can be shared to the installed app from Gmail, a ticket app or any other (ROADMAP item 42, [EVENTS.md](integrations/EVENTS.md#sharing-to-solara-as-built)): the service worker keeps it on the device for up to 30 minutes, and the dashboard shows its events for the person to import (a guest signs in first, and the file waits); a calendar link fills the linked calendars form on Pro.
  On Pro, "Plan for a group" makes plans and burn estimates use the most sensitive of the people ticked; the profile switcher is in the header on phones too, and on Free it explains family profiles and offers the Pro waitlist.
- Self-service account data (ROADMAP item 33): a signed-in person can download a JSON copy of their account and delete it from the account page, with no Functions deployed.
  The download is the same file the `exportAccountData` Function makes; deletion asks them to type DELETE and confirm with Google again, deletes every document of `users/{uid}`, then their sign-in, and clears what Solara kept in that browser.
  An account the browser cannot fully delete (billing or server-only records, which the Spark plan never writes) is told before anything is deleted to email contact@n8builds.dev, and a deletion that stops half way says so and finishes when retried.
- Opt-in Google Analytics 4, asked by a banner at the top of the app's pages, in the page flow, so it never covers anything.
- The privacy policy and terms with the operator details (#46), the Google user data section (#48) and the Sentry and reCAPTCHA notices (#70); each has its own last-updated date (`lib/legal.ts`).
- Firestore rules and indexes, deployed by every push to `main`.
  Since #148 (ROADMAP item 36) the rules also bound key lists to record keys and group selection to 768 characters, and tests prove every server-only collection and collection group is refused to clients.
  The rules also hold each account's activities, saved places and profiles to its plan (Free 3, 3 and 1; Pro 20, 12 and 6), so the limits do not depend on the client; an account back on Free keeps and can shrink what it saved on Pro.

- Android groundwork (ROADMAP item 38, [integrations/ANDROID.md](integrations/ANDROID.md)): the planning logic is shared from `packages/core` (each module its own entry point, free of browser and Node APIs, with its own SHA-256 and time zone reading that Hermes can run), Function calls send `X-Solara-Client: web/<commit>`, which the Functions log, and the manifest has an `id` and two shortcuts.
  There is no Android app or Play listing yet.

## Built but switched off

These are in the code and tested in CI; each waits for an owner step, not engineering work.

| Feature | Switched on by | Owner step |
| --- | --- | --- |
| Google Calendar connect, adding events and **Scheduled** activities (#55, #56) | `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (not set; no client ID in the live bundle) | [Steps A2-A6](OWNER_CHECKLIST.md#anytime-free-no-blaze) |
| **Events from Google Calendar** (events phase 2b): the Events section reads the next 30 days of chosen calendars in the browser with a read-only scope and shows the UV at events with an address (only its town is searched, never names, rooms or dial-ins) or an activity; a disconnect on one device wins over a refresh on another (the rules refuse Google events without the connection), and counts and duplicates cover every stored event (REVIEW6 M2, L4, L5) | `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_CALENDAR_EVENTS_ENABLED` (neither set) | [Events from Google Calendar](OWNER_CHECKLIST.md#events-from-google-calendar), after steps A2-A6 |
| **Events from Outlook** (ROADMAP item 23): the Events section signs in to Microsoft in a popup (PKCE by hand, `Calendars.ReadBasic` only, no refresh token, the token in memory only) and reads the next 30 days of up to 10 own calendars from Microsoft Graph in the browser, with the same UV cards, caps, duplicate rules, place rule and connection check as Google Calendar events (`source: 'outlook'`, `users/{uid}/meta/outlookCalendar`) | `MICROSOFT_CLIENT_ID` and `OUTLOOK_CALENDAR_EVENTS_ENABLED` (neither set) | [Events from Outlook](OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection): register the free Azure app, then the live check, including one sign-in with production's headers, the cache cleared and the network throttled (REVIEW7 M1, fixed in ROADMAP item 29) |
| **App Check** with reCAPTCHA v3, for signed-in users only | `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` (not set) | [Step A7](OWNER_CHECKLIST.md#anytime-free-no-blaze) |
| **App store build** (ROADMAP item 38): no price, upsell or checkout anywhere, for a Trusted Web Activity under Play's payments policy; a guest may still sign in free, and Pro bought on the web still unlocks everything | `NEXT_PUBLIC_STORE_BUILD=1`, or at runtime for a session opened by an Android app (`android-app://` referrer or `?source=twa`) | None until a Play listing exists ([ANDROID.md](integrations/ANDROID.md)) |
| **Sentry** error reporting, scrubbed in the browser (#70) | `NEXT_PUBLIC_SENTRY_DSN` (not set; the bundle then contains no Sentry code) | [Step A8](OWNER_CHECKLIST.md#anytime-free-no-blaze) |

The integrations browser suite (`npm run test:e2e:integrations`) builds the export with a fake site key and DSN and proves that signed-out pages make no reCAPTCHA request, that signing in loads reCAPTCHA and exchanges its token, that Firestore sends the App Check token, and that the CSP allows exactly what reCAPTCHA v3 and Sentry need.
The signed-in suite covers Scheduled and events from Google Calendar with a faked Google Calendar, and events from Outlook with a faked Microsoft sign-in and Graph (the real popup, redirect page and rules).

## Waiting for the Pro launch (Blaze)

- **Cloud Functions are not deployed.**
  The budget kill switch, `budgetAlert`, can now deploy on its own on Blaze, before the others and without their secrets: the `ENABLE_BUDGET_GUARD` variable switches on the **Budget guard** deploy job, which refuses to run without `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT`, and `infra/budget-dry-run.sh` tests it with a fake budget message (ROADMAP item 49, [Budget guard on its own](DEPLOYMENT.md#budget-guard-on-its-own)); it is not switched on, since the project is still on Spark.
  The `ENABLE_BLAZE_FUNCTIONS` variable is not set and the build ships an empty `NEXT_PUBLIC_FUNCTIONS_URL`, so the client hides everything that needs Functions: checkout and the billing portal, the live calendar feed, notification device registration, and the scheduled billing and deletion jobs.
  Account download and deletion do not wait for them: the account page does both in the browser until the Functions are deployed (ROADMAP item 33).
- **Billing:** built and switched off: monthly and yearly checkout with a 7-day trial, the billing portal and an account billing summary are in the code and tested against a fake Stripe; the pricing dialog offers the waitlist until the `BILLING_ENABLED`, `STRIPE_PRICE_ID` and `STRIPE_YEARLY_PRICE_ID` variables are set.
  The account names where its subscription was bought (`subscriptionProvider`, written by the webhook, read as `stripe` when absent); entitlement applies Stripe's statuses only to a Stripe subscription and grants nothing for an unknown provider, ready for a Play or App Store source.
  The trial is once per person: a keyed-hash trial history that survives account deletion (2 years) stops a recreated account, the same verified email or the same card from getting it again ([trial history](DEPLOYMENT.md#trial-history)).
- **Pro alerts:** built and switched off: the scheduled `alerts` Function sends Pro accounts one morning alert per local morning and, when they choose a level, one UV alert on days the UV reaches it (under a clear sky, like all protection advice), outside their quiet hours ([Pro alerts](DEPLOYMENT.md#pro-alerts)); Settings offers them once the `ALERTS_ENABLED` variable is set, and says they are coming until then.
  The alerts and the calendar feed read each account's activities and profiles through the app's own schemas (`parsePlanningPreferences` in `packages/core/src/planning.ts`), so a bad stored value falls back to the app's default, and the morning alert's burn time is for whom the dashboard plans: in group mode, the group's most sensitive person (`planningFor` in `packages/core/src/prefs.ts`).
  Nothing has been sent since 2026-07-15; the manual GitHub Actions notifier is retired.
  A device registered as Android gets a high-priority notification on the `solara-alerts` channel; web devices get the data-only message the push worker shows.
- **Free daily UV push:** built and switched off with the alerts (ROADMAP item 40): a Free account with a device turned on gets "Protect from 10:10am to 3:40pm today" with the day's peak at its morning hour, outside quiet hours, on days the UV reaches 3 under a clear sky; Pro gets the personalised morning plan instead.
  Its times are the dashboard briefing's, from one calculation (`packages/core/src/protection.ts`, ROADMAP item 44).
  The job reads only the enrolments that are due (about twice a day each, about 10 reads per account a day), and a Free account may register devices once alerts are on; Settings' Alerts tab shows a Free account the daily UV and reminder settings with Pro's alerts offered below, and the plans list both free pushes once alerts are on.

- **Linked calendars and Pro event heads-ups** (Wave 5 item 9, phase 2): built and switched off until the `EVENTS_SUBSCRIPTIONS_ENABLED` variable is set ([Linked calendars and event heads-ups](DEPLOYMENT.md#linked-calendars-and-event-heads-ups)).
  Linked calendars are part of Pro since #148 (ROADMAP item 36, REVIEW8 SEC L3): the Functions refuse adding and refreshing for an account without Pro, the scheduled refresh pauses a lapsed account's links without fetching them, and removing works on any plan; a Free account sees one Pro offer in the Events section, which also names the event heads-ups when alerts are on.
  A Pro account links up to 5 https or webcal calendar addresses in the Events section; the `eventSubscriptions` Function fetches each one with SSRF guards (public addresses only, checked after DNS and on every redirect, 10 seconds, 1 MB, calendar content only) and the `eventSubscriptionsRefresh` job every 6 hours, with backoff and a pause after a week of failures; the address stays server-only.
  "Add a calendar from..." under Linked calendars (item 24, [CALENDAR_LINKS.md](integrations/CALENDAR_LINKS.md#as-built)) shows how to copy a calendar link from Apple iCloud, Google, Outlook.com and Yahoo, names the provider of a pasted link and catches common mistakes (a provider's website, Outlook's HTML link) before anything is sent; it loads only when opened.
  It holds back only links that certainly are not calendars and lets any other link on a provider's host through with a warning (ROADMAP item 30).
  Hardened after the fifth review (item 21): hostile bodies fail only their own fetch, each link is claimed before it is fetched so none can hold the refresh job, refreshes write only changed events, place lookups have their own budget, and the job takes every due link and emails the owner when it falls behind.
  The `alerts` job sends Pro accounts a heads-up about 3 hours before an imported, linked, Google Calendar or Outlook event with UV 6 or higher, outside quiet hours (needs `ALERTS_ENABLED` and any events switch, `EVENTS_SUBSCRIPTIONS_ENABLED`, `GOOGLE_CALENDAR_EVENTS_ENABLED` or `OUTLOOK_CALENDAR_EVENTS_ENABLED`): only for events that count as an outdoor activity, once per event across sources, and at most one push every 3 hours, with the event's name quoted and cleaned (REVIEW5 M3, L4); a push counts the later events it holds back (REVIEW6 L2), and a run's event forecasts are shared fairly, at most 10 per account (REVIEW6 M1).
- **Forecast licensing (D5):** the forecast proxy for the Open-Meteo commercial API is built and switched off; the browser calls Open-Meteo's free API until `FORECAST_PROXY_ENABLED` is set.
  When the proxy serves its last good copy while its budget is spent (`stale: true` with `fetchedAt`), the app keeps that copy's real age and the dashboard says so in a small note, "Showing the forecast updated at 9:40am. A newer one will load by itself.", in the place's own clock (`components/ForecastNotice.tsx`, which also holds the offline notice; only one of them shows at a time).
  A forecast without the two fields reads exactly as before.
  Each caller's share of the paid calls also counts its IPv4 /24 (or IPv6 /48), and the budget has two sides, the browser's forecasts and the server's (the calendar feed and Pro heads-ups), each allowed at most two thirds, so neither can starve the other (REVIEW5 L1, REVIEW6 L3); the per-address limits keep serving new visitors when full (REVIEW5 M5).
- **Operations:** every Function has instance (16 HTTP instances in all), memory and timeout caps, a request body limit checked before the body is parsed (8 KiB, 256 KiB for the Stripe webhook, #148) and no compressed body at all (REVIEW9 SEC9 H1, ROADMAP item 43), forged webhook requests logged at most once a minute per kind, rate limits that reject before any Firestore read, App Check, and a global budget for paid forecast calls with a fair share per caller and a guaranteed part for the browser and for the server, a separate place search budget and one for linked calendars' place lookups; a budget kill switch ($25 budget: warn at 50%, cost guard at 100%, detach billing at 300%) and cost guard, alerts, uptime checks, backups and TTL policies are in code and `infra/` scripts, applied by the owner at the Pro launch ([RUNBOOK.md](RUNBOOK.md)).

The project stays on Spark until Pro launches ([COSTS.md](COSTS.md)).

## CI/CD

- **Fixes from the ninth security review** (ROADMAP item 43): sunscreen reminder writes are rate-limited in the rules; the browser's own account deletion needs a recent sign-in, leaves no server-written record behind and cannot be undone by another open tab; emailed deletions wait for a reply from the account's address; the free daily UV push may use at most a third of the server's forecast budget; a `?source=twa` link in a browser tab no longer turns on store mode.
- **Fixes from the tenth security review** (ROADMAP item 47): a sunscreen reminder write needs the account document, so the 10-second spacing cannot be reset; the browser deletion's "just deleted" marker expires a day later (TTL) and holds for 75 minutes, and the privacy policy names it; the data download includes the reminder and device bookkeeping times.
- **Repository:** public, with the "Protect main" ruleset: pull requests only, squash merges only, no force pushes or deletion, and 8 required checks from `quality.yml` (lint, types and unit tests; browser tests on the static export; signed-in UI harness, which waits for the harness's four parallel shards; signed-in browser tests on emulators; Functions and Firestore rules; workflow and secret scanning; dependency review; browser tests with Sentry and App Check switched on).
  Dependabot alerts and security updates, secret scanning with push protection, and CodeQL are on; three alerts are open and are false positives for the owner to close (CodeQL #22 and #23, secret scanning #1, the public Firebase web key; [A19](OWNER_CHECKLIST.md#anytime-free-no-blaze)).
  The Dependabot alerts on glob and minimatch are fixed by overrides (glob 14, and minimatch 11 wherever the vulnerable code shipped, ROADMAP item 46 part 2); minimatch 6 under firebase-tools' Hosting emulator (dev only) has no globparts code and no compatible fixed version, so its alert, if it stays open, is for the owner to dismiss (A19).
  The ruleset does not yet require up-to-date branches or the CodeQL checks, and private vulnerability reporting is off ([A17, A18](OWNER_CHECKLIST.md#anytime-free-no-blaze)).
  There is no `production` environment yet; the deploy jobs that receive credentials run only from `main`, even when started by hand on another branch ([owner checklist](OWNER_CHECKLIST.md#repository)).
- **Testing policy (#74):** agents run the fast checks locally (lint, typecheck, docs check, unit tests, build and the suites their files touch); the full browser and emulator suites run on GitHub Actions.
  CI runs only the suites a pull request's files can affect (#76); every required check still reports, and the others pass in seconds ([docs/CI.md](CI.md)).
  A push to `main` whose exact tree a pull request's CI already passed, on top of a `main` that passed, skips the suites and deploys in about 3 minutes instead of 9 (CI audit, #169).
- **Pull requests** run `.github/workflows/ci.yml`, which calls the reusable `quality.yml` once per commit (older runs are cancelled).
- **Pushes to `main`** run `deploy.yml`: the same quality workflow, then one production build that is checked, smoke-tested on the Hosting emulator and packaged with its SHA-256, SBOMs and a provenance record and attestation.
  Separate jobs then deploy Firestore rules, Firestore indexes, Functions (only when `ENABLE_BLAZE_FUNCTIONS` is `true`), the budget guard alone (only when `ENABLE_BUDGET_GUARD` is `true` and Functions are off) and Hosting, which receives exactly the tested artifact.
- **Staging:** `deploy-staging.yml`, run by hand, deploys `main` to the staging project (or only a branch's site to a 7-day preview channel) from the `staging` environment's `STAGING_*` settings; no staging project or environment exists yet, so a run skips with a notice ([DEPLOYMENT.md, Staging](DEPLOYMENT.md#staging)).
  Hosting configs are named by target per project, each project has its own Functions `APP_URL`, and the guards refuse any production value in a staging build (item 34).
- **Build guards:** the deploy's `.github/scripts/check-public-env.mjs` refuses a build whose public values contradict each other: Functions on without the App Check site key, alerts on without the VAPID key, an App Check debug token (also from the `.env` files the build reads), a Functions URL without Functions or of another project, a secret-shaped public value (REVIEW8 PLAN M3, SEC L9), and in a staging build any production value.
- **Credentials:** deploys still use the long-lived `FIREBASE_SERVICE_ACCOUNT` key, because Workload Identity Federation is not set up yet.
- **Configuration:** `NEXT_PUBLIC_SITE_URL` is a repository variable; the other public `NEXT_PUBLIC_*` values are still repository secrets, which the build reads as a fallback.
  The `NEXT_PUBLIC_PRO_PRICE` secret is unused since #71 (prices live in `lib/plans.ts`).
- **Dependencies:** Dependabot version updates run weekly with a 7-day cooldown.
  Development and CI run Node 24.22.1, the newest Node 24 LTS (`.nvmrc`); Functions run on the Node 24 runtime (`engines` "24").
  Wave 4 upgraded Vitest 5, Firebase 13, Stripe 23 (API version pinned) and Tailwind 4, kept `@types/node` on the Node 24 line and removed dotenv (#57-#62).
  Every npm dependency is on its newest release (2026-10-27), including TypeScript 6.0.3 and ESLint 10, which needs peer overrides for three plugins that `eslint-config-next` bundles ([roadmap item 7](ROADMAP.md#7-eslint-10-done)); TypeScript 7 waits for `typescript-eslint` and Next.js ([item 8](ROADMAP.md#8-typescript-7-deferred)).
  Production dependency audits report zero advisories; accepted development advisories are in [DEPENDENCY_RISK.md](DEPENDENCY_RISK.md).

How deploys work and how to configure them is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Owner actions

### Done

| Action | State |
| --- | --- |
| D1 Functions deployment status | Resolved: not deployed until Pro launch |
| D2 Make the repository public | Done 2026-10-23, with the ruleset and security features above |
| D3 Firestore index role for the deploy identity | Granted 2026-10-23; the Firestore indexes job is green |
| D8 Operator, contact, jurisdiction and license | Nathan Watkins, contact@n8builds.dev, California, all rights reserved (#46) |
| Move to `solara-uv.web.app` | Done (#42, #45); `NEXT_PUBLIC_SITE_URL` variable set |
| Search Console ownership of `https://solara-uv.web.app/` | Verified 2026-10-23 (#43), owner reported |
| Firebase Auth and OAuth authorized domains | Added, owner reported |
| OAuth scopes (`openid`, email, profile, `calendar.freebusy`, `calendar.events.owned`) | Added, owner reported |
| Price and tiers | Confirmed 2026-10-24 ([ROADMAP.md](ROADMAP.md#decisions)) |
| Dependabot alerts and security updates | On |
| D12 Local branch and worktree clean-up | Done by 2026-10-28: only the main clone and the current review worktrees remain |

### Open

The vitamin D log is built on the device only ([ROADMAP item 48](ROADMAP.md#48-vitamin-d-log-vitd-built-on-the-device)); syncing it to accounts (PLAN C10) waits for the lawyer's note (O5).
The ordered list is [Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order), checked against the live GitHub settings on 2026-10-28.
Anytime (group A): confirming that a non-test Google account can sign in (REVIEW8 QA M5), the Google Calendar client ID, OAuth branding resubmission and publishing, calendar scope verification, App Check, Sentry, the browser key's website restriction and Auth clean-up, Firestore quota caps and a traffic alert, trying the TTL policies, the `production` environment, Workload Identity Federation (D4), moving the public build values to variables and deleting `NEXT_PUBLIC_PRO_PRICE`, ruleset hardening, private vulnerability reporting, closing three alerts, small clean-ups and counsel review of the governing-law language.
The staging steps (group B, D9) can start: the staging deploy is built ([ROADMAP item 34](ROADMAP.md#34-staging-deploy-before-the-pro-launch-built)) and waits for the staging project and the `staging` environment; Blaze, the Stripe live setup, the Open-Meteo commercial plan (D5, now before billing) and the switches come at the Pro launch (groups C and D).

## Known test boundary

The signed-in e2e suite runs the real app, rules and Functions against the Firebase emulators, but CI cannot prove Google OAuth consent, App Check with real reCAPTCHA tokens, delivery to a real Sentry project, FCM, APNs or Android notification presentation, Stripe signatures, or third-party calendar refresh timing.
Those checks stay explicit steps in the [owner checklist](OWNER_CHECKLIST.md#release-verification).

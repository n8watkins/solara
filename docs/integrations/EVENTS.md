# Linking live events (Wave 5 item 9)

_Scoped 2026-10-27 by lane INTEG._
_Every external fact below was checked against the cited page on 2026-10-27._

This is the design for [ROADMAP item 12.9](../ROADMAP.md#12-wave-5-features): linking events from Strava, Meetup and similar services so Solara can plan around them.
It is a scoping document; no product code exists for it yet.
Files marked "(new)" are planned.

## Recommendation in short

Build on the iCalendar (.ics) format first, not on partner APIs.
Almost every event service (Meetup, Eventbrite, race sites, club sites, Google and Apple Calendar) offers an "Add to calendar" download or a calendar feed, so one importer covers them all with no developer account, no app review and no partner terms.

1. **Phase 1 (Spark, client only, no approvals):** import a .ics file and show the UV at each event's time and place, with sunscreen timing.
2. **Phase 2 (Blaze, no partner approval):** subscribe to an .ics or webcal link that Solara refreshes on the server, and send a Pro heads-up before an event with high UV.
3. **Phase 2b (optional, Google verification only):** read events the person already has in Google Calendar.
4. **Phase 3 (Blaze plus a Strava developer subscription; review past 10 athletes):** connect Strava for "UV during this run" recaps and planning from saved routes.

Do not build on the Meetup, Eventbrite, Komoot or Garmin APIs; the reasons are in [Sources compared](#sources-compared).

## What Solara does with an event

An event is a title, a start and end instant with a time zone, and a place.
For each one, Solara shows:

- **UV during the event:** the peak and average UV between its start and end, from the hourly forecast at its place, with the WHO band.
- **Exposure:** the event is matched to one of the person's activities (by keywords such as run, hike, ride or swim, which the person can change), so the shade and surface factors from item 8 (`packages/core/src/exposure.ts`) and the burn time for the planning profile apply.
- **Sunscreen timing:** apply 15 to 30 minutes before the start, and reapply every 2 hours or after swimming or heavy sweating, shown only when the peak UV is 3 or more.
- **A better window, when there is one:** for events the person controls (a solo run), the existing recommendation engine suggests a lower-UV start nearby; for fixed events (a race, a group meetup) Solara only advises.
- **Forecast horizon:** events beyond the person's plan (today for guests, two days on Free, 10 days on Pro) show "Forecast from <date>" instead of numbers, and the item becomes live when the forecast reaches it.
- **Heads-up (Pro, Blaze):** a push the evening before, or a set time before the start, when the event's peak UV is high; this reuses the morning alerts Function and device tokens of [ROADMAP item 10](../ROADMAP.md#10-wave-3-phase-2-pro-only-morning-alerts-w3-b-built) and the threshold alerts of item 12.2.
- **After the event (Strava, phase 3):** a recap of the UV during a recorded activity, from its start time, elapsed time and start point.

All of this is pure, deterministic logic over data the app already fetches, so it belongs in `packages/core/src/events.ts` (new), shared by the app and the Functions that send heads-ups.

### Place and time

- **Place:** the iCalendar `GEO` property gives coordinates when present.
  Otherwise the `LOCATION` text is geocoded at city level with the place search the app already uses (`lib/geocoding.ts`); UV varies little within a city, so this is accurate enough.
  When neither works, the event uses the person's current location and says so ("Using San Diego; set the place"), with a place picker to fix it.
  Real feeds often omit the place: a public Meetup group feed checked on 2026-10-27 (`https://www.meetup.com/bostonpython/events/ical/`) returned ten events with `DTSTART;TZID=...` and `URL` but no `LOCATION` or `GEO`.
- **Time:** events are stored as UTC instants plus their IANA zone (`TZID`), and converted to the place's zone for display with the existing helpers in `lib/time.ts`.
  This differs from Solara's own export (`lib/ics.ts`), which writes floating local times on the assumption that the device zone is the location zone; imported events must not rely on that assumption.
- **Recurrence:** `RRULE` events (a weekly club run) are expanded only over the forecast horizon, at most 50 occurrences per source.

## Sources compared

Ranked by user value against integration cost and approval or terms risk.

| Rank | Source | User value | Cost | Approval and terms risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | .ics file import | High: covers Meetup, Eventbrite, races, club sites, any calendar | Low, client only | None | Phase 1 |
| 2 | .ics or webcal link subscription | High: stays current without re-importing | Medium: a Function fetcher with SSRF guards | None from partners; needs Blaze | Phase 2 |
| 3 | Google Calendar events | High for people who already put events there | Low: the GIS integration exists (`lib/gcal.ts`) | Medium: a broader scope to verify and a privacy promise to change | Phase 2b, optional |
| 4 | Strava | Medium: no future events in the API; recaps and routes only | High: server OAuth, token storage, webhooks | High: subscription, 10-athlete cap, display and AI limits | Phase 3 |
| 5 | parkrun | Medium in the UK and Australia | None: a preset recurring activity, no API | Low if no parkrun data is fetched | An activity preset, not an integration |
| 6 | Meetup API | Same as Meetup's .ics feeds | High | High: Meetup Pro to create an OAuth client, approval not guaranteed | Not recommended |
| 7 | Eventbrite API | Low: no public event search | Medium | Medium | Not recommended; use .ics |
| 8 | Komoot | Medium | High | Blocking: partner contract only | Not recommended |
| 9 | Garmin Connect | Medium | High | Blocking: new approvals paused | Not recommended |
| 10 | Google Fit, Apple Health, Health Connect | Low for planning | High | Google Fit ends with 2026; the others are native only | Wave 6 (mobile app) at most |

### iCalendar (.ics) import and subscriptions

- iCalendar is an open standard (RFC 5545), so there is no partner, no review and no terms beyond each feed's own site.
- A browser cannot fetch most feed URLs directly: Meetup's feed answered with no `Access-Control-Allow-Origin` header on 2026-10-27, and the app's Content Security Policy (`lib/csp.mts`) rightly limits `connect-src` to known origins.
  So a file the person picks (or shares to the installed app) works on Spark, while a subscription URL needs a server fetch, which needs Blaze.
- Meetup group feeds have the form `https://www.meetup.com/<group>/events/ical/` and answered `200 text/calendar` without sign-in; some group slugs returned 404 or 403, so the importer must show a clear error for a feed it cannot read.
- Feed URLs can embed private tokens (Google's "secret address in iCal format", Solara's own feed), so a stored URL is treated as a credential.

### Google Calendar

- Solara holds two scopes today, each requested only when needed (`lib/gcal.ts`): `calendar.freebusy` (busy times only) and `calendar.events.owned` (create, view, change and delete events on calendars the person owns).
  Source: <https://developers.google.com/workspace/calendar/api/auth>.
- `calendar.events.owned` could technically read the person's own events, but the privacy policy (`app/privacy/page.tsx`) and the verification justification in the [owner checklist](../OWNER_CHECKLIST.md#google-sign-in-and-calendar) promise that Solara reads only events it created.
  Using it for other events would need a new privacy text and a new justification, and it still would not see subscribed calendars (a Meetup feed added to Google), which are not owned.
- `calendar.events.readonly` sees every calendar, including subscribed ones, at the cost of a broader sensitive scope and its own verification with a demo video.
  Google's sensitive-scope verification is described at <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>; the console's Data Access page shows the exact classification of each scope.
- Default: do not add this scope to the pending verification of the two current scopes (owner step 4), so Scheduled is not delayed; request it separately once phase 2b is built and has a demo.

### Strava

- **No future events.** The API reference lists clubs only as Get Club and List Athlete Clubs, with no club or group events endpoint, and no event search (checked against <https://developers.strava.com/docs/reference/> and its Swagger file, <https://developers.strava.com/swagger/swagger.json>).
  The Club Activities, Club Members and Club Admins endpoints are removed on 2026-09-01 (<https://developers.strava.com/docs/changelog/>).
  What remains useful: recorded activities (`start_date`, `start_latlng`, elapsed time) for after-the-fact UV recaps, and saved routes as start points for planning.
- **Scopes** (<https://developers.strava.com/docs/authentication/>): `read`, `read_all`, `profile:read_all`, `profile:write`, `activity:read`, `activity:read_all`, `activity:write`.
  Solara would need only `activity:read` (recaps, and required for activity webhooks) and `read_all` only if private routes are wanted; athletes can untick scopes, so the granted set must be checked.
- **Tokens:** access tokens last six hours; every refresh returns a new refresh token and invalidates the old one, so the latest must be stored.
  The code exchange needs the client secret, so it must run in a Function, never in the browser.
  Deauthorization moves to `POST https://www.strava.com/oauth/revoke` (available since 2026-06-01; the old `oauth/deauthorize` is retired on 2027-06-01), and on 2027-06-01 tokens must go in headers and the base URL becomes `https://api-v3.strava.com`.
- **Rate limits** (<https://developers.strava.com/docs/rate-limits/>): 200 requests per 15 minutes and 2,000 a day overall, 100 and 1,000 for reads.
  A new app is in Single Player Mode (only the developer's own data); a self-upgrade in the API settings allows 10 athletes, and more than 10 needs app review with screenshots of where Strava data appears and the "Connect with Strava" button.
- **Developer program** (<https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>): since 2026-06-01, Standard Tier API access requires a Strava subscription on the developer's account; Extended Access (more athletes, higher limits) is by approval and exempt.
  Apps that route Strava data through third-party intermediaries are no longer supported, so the integration must be direct.
- **Webhooks** (<https://developers.strava.com/docs/webhooks/>): one subscription per app; activity create, update and delete, and athlete deauthorization; the callback must answer within two seconds; payloads carry ids only, so details are fetched afterwards.
- **API Agreement** (<https://www.strava.com/legal/api>, effective 2026-06-01):
  - Strava data from a user may be shown only to that user, never to other users, even if it is public on Strava.
  - Apps may not compete with or replicate Strava functionality.
  - On termination all Strava data must be deleted and the deletion certified in writing.
  - Strava may charge for API access in the future, with notice.
- **AI:** the November 2024 update barred using API data in AI models or similar applications, and Strava says to ask for written guidance first (reported by DC Rainmaker, <https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html>).
  So Strava data must never reach the optional AI-written briefing (item 12.3) or any other model.

### Meetup

- Meetup's API is GraphQL behind OAuth 2 bearer tokens, with a budget of 500 query points every 60 seconds (<https://www.meetup.com/api/guide/>).
- API access is listed as a Meetup Pro feature (<https://www.meetup.com/api/general/>), and Meetup's help centre says only members with an active Pro subscription can create OAuth consumers and that Pro does not guarantee approval (help article 41453576628749 on help.meetup.com, which blocked automated fetching on 2026-10-27; quoted from search results).
- The guide does not document searching events by location.
- The group .ics feeds give the same events with no account, so the API adds cost and approval risk for little gain.

### Others

- **Eventbrite:** the public event search endpoint was removed in 2020 and the API now serves an organizer's own events (reported in <https://github.com/Automattic/eventbrite-api/issues/83>); attendees get .ics downloads from event pages, which phase 1 covers.
- **Komoot:** the API is for partners with a signed contract only (<https://static.komoot.de/doc/external-api/v007/index.html>).
- **Garmin Connect Developer Program:** free for approved business developers (<https://developer.garmin.com/gc-developer-program/program-faq>), but Garmin has paused new approvals (reported in <https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/>).
- **parkrun:** no public API was found; parkrun is a fixed weekly 5 km at a known place and time, so a "parkrun" activity preset with a recurring Saturday start covers it without fetching parkrun data.
- **Google Fit:** sign-ups closed on 2024-05-01 and the APIs, the REST API included, are supported only until the end of 2026, in favour of Health Connect, which is Android only (<https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq>); Apple Health is iOS only.
  Both belong to the Wave 6 mobile app if anywhere, and they hold past workouts, not planned events.

## Phased plan

### Phase 1: .ics file import (Spark, client only)

- **Scope:** signed-in people pick a .ics file (or, in the installed app on Android, share one to Solara through a Web Share Target); Solara parses it in the browser, shows the events in an "Events" section of the Scheduled view, and stores them in Firestore so every device sees them.
- **Parser:** `packages/core/src/ics-parse.ts` (new), next to the existing serializer, handling line unfolding, escaping, `TZID` with `VTIMEZONE`, `DTSTART` as a date (all day, skipped), `RRULE` over the horizon, `GEO`, `LOCATION`, `URL`, `UID` and `STATUS:CANCELLED`.
  Limits: 1 MB per file, 200 events per import, text fields capped like `SCHEDULED_LIMITS` in `packages/core/src/scheduled.ts`.
- **Storage:** `users/{uid}/events/{eventKey}` (new subcollection), with the source (`file`), title, start, end, zone, place (coordinates, label, and whether it was guessed), matched activity id, the source `URL` if it is a `https` link, and a TTL field like scheduled activities so past events expire 30 days after they end.
  The key is a hash of the source and `UID` (plus the occurrence for recurring events), so re-importing the same file updates instead of duplicating.
- **Guests:** not offered; a guest's plan covers only today, and the sign-in prompt explains the feature.
- **UI:** an event card with the UV during the event, burn time, sunscreen timing and the "set the place" fix; the visual design follows the preview-before-polish rule (desktop, then mobile, approved before tests).
- **Size:** M.

### Phase 2: link subscriptions and heads-ups (Blaze)

- **Scope:** paste an `https` or `webcal` link; a Function fetches it now and again every few hours, and the events update in place.
- **Fetcher** (`functions/src/events/` (new)): an authenticated callable to add, refresh and remove a source, and a scheduled refresh for active sources.
  Guards: `https` only (webcal is rewritten), DNS resolution checked against private, loopback and link-local ranges on every redirect (at most 3), a 10-second timeout, a 1 MB body cap, `text/calendar` or a parse that succeeds, at most 5 sources per person, a per-uid rate limit (`functions/src/shared/rate-limit.ts`) and the cost guard (`functions/src/shared/cost-guard.ts`).
  Failing sources back off and show their error; a source that fails for 7 days is paused.
- **Storage:** the source URL is a credential, so it lives in `users/{uid}/private/eventSources` (server-written, owner-readable, already covered by `firestore.rules`), shown to the person only as its host and a label.
  Events go in the same `users/{uid}/events` subcollection, written by the Function.
- **Heads-ups:** a Pro push before a high-UV event, built into the item 10 alert Function rather than a second scheduler.
- **Size:** M, after item 10.

### Phase 2b: events already in Google Calendar (optional)

- **Scope:** with `calendar.events.readonly`, requested only when the person turns this on, Solara lists the next 10 days of events with a place, in the browser, and offers the same UV card; nothing is stored except events the person pins.
- **Needs:** a new privacy policy section, a verification request with a demo video, and an update to the CSP only if a new origin is called (the Calendar API origin is already allowed).
- **Size:** S to M, plus Google's review time.

### Phase 3: Strava (Blaze, Strava developer subscription)

- **Scope:** "Connect with Strava" (official button and "Powered by Strava" mark per Strava's brand guidelines), then a UV recap on each new outdoor activity and an option to plan from a saved route's start point.
- **Server:** an OAuth callback Function exchanges the code; the refresh token is stored server-only; a webhook Function answers within two seconds and queues the fetch; deauthorization (from Solara, from Strava, or by account deletion) calls `oauth/revoke` and deletes every stored Strava record.
- **Storage:** `stravaLinks/{athleteId}` (new, top level, server-only) maps the webhook's `owner_id` to the Solara uid and holds the tokens; recaps live in `users/{uid}/events` with source `strava`.
- **Rules of use:** Strava data is shown only to the athlete who linked it, never fed to an AI model, and never shared or exported to anyone else.
- **Launch:** 1 athlete (the owner) in Single Player Mode, then 10 by self-upgrade for a beta, then app review for more.
- **Size:** L.

## Security and privacy

- **Least privilege:** phase 1 needs no new permission at all; phase 2b asks for the Calendar read scope only when turned on; Strava asks for `activity:read` only, plus `read_all` only if private routes are offered.
- **Where secrets live:** Strava's client secret and webhook verify token are Functions secrets (Secret Manager), never `NEXT_PUBLIC_*` values; Strava refresh tokens live in `stravaLinks`, which `firestore.rules` denies to every client (`allow read, write: if false`); subscription URLs live in `users/{uid}/private`, which only the Functions write and only the owner can read, and the UI shows just each URL's host.
  Google tokens stay in browser memory as today.
- **Rules:** `users/{uid}/events/{eventKey}` gets the same pattern as `scheduled`: owner-only, the account active, a key allowlist, typed and length-capped fields, a TTL field checked on write, and list queries capped (`limit <= 200`).
  In phase 1 the client writes events; once phase 2 ships, events whose source is a subscription or Strava are server-written and the rules refuse client writes for those sources.
  New rules tests go in the existing rules suites (`lib/firestore-rules.test.ts` and the emulator tests).
- **Unlinking:** removing a source deletes its events and its stored URL; disconnecting Strava revokes the token at Strava and deletes `stravaLinks/{athleteId}` and every Strava-sourced event.
- **Account deletion:** `functions/src/account/deletion.ts` already deletes `users/{uid}` recursively, which covers the events subcollection and the private sources document; the top-level `stravaLinks` documents need an explicit step beside `deleteCalendarFeedsForUser`, including the Strava revoke call.
- **Export:** `functions/src/account/export.ts` adds the person's events and source labels (not the secret URLs or tokens).
- **Data minimisation:** only what the UV card needs is stored (no attendee lists, descriptions or organiser details), and past events expire through TTL.
- **Strava's deletion clause:** if Solara stops using the API, all Strava data must be deleted and the deletion certified to Strava, so the plan for that case must account for Firestore backups, which are kept for 14 days, and point-in-time recovery, which covers 7 ([RUNBOOK.md](../RUNBOOK.md)).
- **Disclosures:** the privacy policy gains sections for imported events, link subscriptions (the Function fetches the link from Google Cloud), the Calendar read scope and Strava, before each ships.

## Owner decisions and actions

Decisions, with the default agents follow until the owner says otherwise:

| Decision | Default |
| --- | --- |
| Approve the phased plan and the ICS-first approach | Phase 1 is buildable now; later phases wait for this approval |
| Who gets event linking | Every signed-in person; the existing forecast horizon (Free two days, Pro 10 days) and Pro-only push are the upsell, so no new gate |
| Add `calendar.events.readonly` to the pending Calendar verification | No; request it separately once phase 2b is built |
| Build the Strava integration | Only after phases 1 and 2 show use, and only with the owner's Strava subscription |

Actions, only when the matching phase starts:

| Phase | Action | Cost |
| --- | --- | --- |
| 1 | None | $0 |
| 2 | Blaze, already planned for the Pro launch ([COSTS.md](../COSTS.md)); the fetcher is a few thousand Function calls a month at small scale | Within the free tier at launch scale |
| 2b | Add `https://www.googleapis.com/auth/calendar.events.readonly` on the Data Access page, record a demo video (an agent can script it), submit it in the Verification Center | $0; Google's review time |
| 3 | Subscribe to Strava on the developer account; create the API application at <https://www.strava.com/settings/api> (name, website `https://solara-uv.web.app`, callback domain); give the client id and secret to the Functions secrets; self-upgrade to 10 athletes for a beta; later submit the Developer Program review form with screenshots | A Strava subscription at Strava's current price; the API itself is free |
| Never | A Meetup Pro subscription, Eventbrite, Komoot or Garmin developer accounts | Not needed |

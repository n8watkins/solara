# Events from Outlook

_Scoped 2026-10-28 by lane CALSCOPE, planned and owner approved 2026-10-28; built 2026-10-28 by lane OUTLOOK and switched off ([ROADMAP item 23](../ROADMAP.md#23-events-already-in-outlook-built-and-switched-off))._
_Every external fact below was checked against the cited page on 2026-10-28; claims that could not be confirmed are listed in [Open questions](#open-questions), with how the build handles each._

This is the design for showing the UV at events already in a person's Outlook calendar: Outlook.com, Hotmail and Live (personal Microsoft accounts) and Microsoft 365 (work or school accounts).
It mirrors [events from Google Calendar](EVENTS.md#phase-2b-as-built) (#132, ROADMAP item 20) wherever Microsoft allows it.
[As built](#as-built) lists what the build changed or settled; the sections after it are the plan as approved.

## As built

_Switched off until the `MICROSOFT_CLIENT_ID` and `OUTLOOK_CALENDAR_EVENTS_ENABLED` repository variables are set ([DEPLOYMENT.md](../DEPLOYMENT.md#events-from-outlook), [owner checklist](../OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection))._

- **Files:** `packages/core/src/outlook-calendar-events.ts` (limits, the connection schema, `OUTLOOK_EVENTS_SCOPE`), `windowsZoneToIana` exported from `packages/core/src/ics-parse.ts`, `lib/microsoft-auth.ts` (the PKCE popup flow), `lib/microsoft-redirect.ts` and `app/auth/microsoft/page.tsx` (the redirect page), `lib/outlook-events.ts` (Graph reads, `parseOutlookEvent`, the refresh), `components/events/OutlookCalendarEvents.tsx` (the panel), and `lib/calendar-events.ts`, which now holds the refresh, duplicate, cap, place and connection code that `lib/google-events.ts` had, so both connections share it instead of copying it.
- **Everything in the plan holds**, with these changes and details:
  - **Redirect page:** an app route made static by `scripts/static-pages.mjs` (like the landing page), so it ships no framework, analytics or Firebase code; its scripts are the theme script and the hand-over, both hashed into its CSP, and the consent banner never shows there.
    It also works under `npm run dev`, so the dev registration needs nothing else.
    The hand-over posts `state`, `code`, `error`, `error_description` and `error_subcode` (capped) on the BroadcastChannel `solara-microsoft-auth:<state>`, removes the query with `history.replaceState`, and closes the popup; the app-shell worker already leaves `/auth/microsoft/` to the network (now covered by a test).
  - **Popup:** opened as `about:blank` on the click, before anything is awaited, then sent to the authorize page once the S256 challenge is ready; a popup seen closed counts as closed by the person only after 1.5 seconds, since the redirect page closes itself right after posting.
    "Cancel" on Microsoft's page (`access_denied` with `error_subcode=cancel`) is treated like closing the popup, not as an error.
  - **Organization approval:** `consent_required`, `admin_consent_required`, or an `error_description` with AADSTS65001, 90094 or 90095, shows "Your organization needs to approve Solara before it can read your work calendar. Ask your IT team.", with ", or link the calendar under Linked calendars instead" only where linked calendars are switched on (the in-app helper of item 24 is lane LINKGUIDE's).
  - **Calendar list:** `$select=id,name,isDefaultCalendar,owner`, not `isSharedWithMe`, which is not in Graph v1.0's documented calendar resource and would make Graph refuse the `$select`.
    Calendars added by another address than the default calendar's owner are left out; the owner address is compared in memory and never stored; an `isSharedWithMe: true` is still honoured if Graph sends it.
  - **Locations:** besides links, dial-ins and `conferenceRoom`, `homeAddress` and `businessAddress` are never kept or searched, and a meeting provider's name ("Microsoft Teams Meeting", "Skype Meeting", "Zoom Meeting") is dropped whether or not `isOnlineMeeting` is set.
    Coordinates are used as the place (rounded to two decimals, named by the location text, so no place search is needed) unless the location is one of those private types or its text was dropped.
  - **Times:** `start` and `end` are read as UTC when Graph says `UTC` or names no zone; a time in another zone (IANA or Windows), which Graph should not send without a `Prefer` header, is read as that zone's wall clock, so the parser tolerates both.
  - **Errors from Graph:** `401` forgets the token and asks to connect again; `403` and `404` mark that calendar "no longer shared"; `429` waits for `Retry-After` once (at most 30 seconds), then says "Outlook is busy. Try again in a few minutes."; a `@odata.nextLink` is followed only when it is a Graph v1.0 address, so the token is never sent elsewhere.
  - **Calendars:** at most 10 in all, the default one first, as for Google (`OUTLOOK_EVENT_LIMITS.maxCalendars`).
  - **Disconnect order:** the connection document goes first, then the events, then the token in memory, as Google's does since REVIEW6 L4 (#137), so a refresh still running on another device cannot write events back; the status then links to the two consent pages.
  - **Token lifetime:** the token is forgotten when the Outlook panel unmounts (sign-out, an account switch or leaving the dashboard), and after a reload Refresh opens the popup again (usually without a prompt).
  - **Heads-ups:** `OUTLOOK_CALENDAR_EVENTS_ENABLED` joins `eventHeadsUpsEnabled()` in `functions/src/notifications/config.ts`, `functions/.env` and the deploy, as #136 did for Google.
- **Tests:** unit tests for PKCE (RFC 7636 appendix B), the popup flow (blocked, closed, timeout, state mismatch, cancel, admin approval, token errors, refresh tokens ignored), the redirect script, Graph mapping (every row of the mapping table, Windows zones, `tzone://Microsoft/Custom`, all-day, cancelled, declined, recurring, places, tolerance of missing fields), the Graph reads (select, paging, `401`, `403`, `404`, `429`), duplicates with Google and file events, caps and the disconnect order; static and emulator rules tests (the connection is typed and capped, Outlook events need the Outlook connection, deletion removes both); a signed-in browser test with the real popup, redirect page and rules against a fake Microsoft sign-in (which checks PKCE and the redirect URI) and a fake Graph, with no CSP violation; UI harness screens at 390, 1280 and 1440 px, light and dark, with 0 axe violations.

## In short

| Choice | Decision | Why |
| --- | --- | --- |
| Where it runs | In the browser only, like Google Calendar events; no Function, no Blaze | Events change rarely; a server refresh would need stored refresh tokens |
| Scope | `Calendars.ReadBasic` (delegated) only | Least privileged for both reading events and listing calendars; no admin consent needed |
| Auth | Hand-rolled authorization code flow with PKCE in a popup, about 3 KB gzip, no `offline_access` | MSAL.js is about 75 KB gzip and always asks for `offline_access` (refresh tokens) |
| Accounts | `common` authority: personal and work or school accounts | One registration, one button |
| Calendars and window | The default calendar, up to 10 chosen own calendars, the next 30 days | Same as Google |
| Storage | `users/{uid}/events` with `source: 'outlook'` (new source), `users/{uid}/meta/outlookCalendar` (new) | Same as Google, within the 1,000-event key list |
| Switch | `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` and `NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED=1` | Same pattern as `GOOGLE_CALENDAR_EVENTS_ENABLED` |
| Cost | $0 | Free Azure account and app registration; Graph calendar calls are not metered |
| Microsoft review | None required; publisher verification optional and not possible yet | See [Publisher verification](#publisher-verification) |

## What the person sees

- **Where:** an "Outlook" panel in the Events section, beside the Google Calendar panel, in `components/events/OutlookCalendarEvents.tsx` (new), loaded on demand only when the switch is on, so neither first load grows.
- **Turning it on:** "Show my Outlook events" opens Microsoft's sign-in and consent popup, which asks for "Read basic details of user calendars" ([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)).
- **Events:** each kept event gets the same UV card as imported events, marked "From Outlook", with no remove button of its own (Disconnect removes them, and "Remove imported events" keeps them, as for Google).
- **Choose calendars:** lists the person's own calendars with the same scope, so unlike Google there is no second consent.
- **Refresh and Disconnect:** as for Google: every 30 minutes while this session holds a token, otherwise on Refresh; Disconnect removes the events and the connection.

## Scope: Calendars.ReadBasic over Calendars.Read

Microsoft's [permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) describes the delegated permissions as:

| Permission | Consent text | Description | Admin consent | Personal accounts |
| --- | --- | --- | --- | --- |
| `Calendars.ReadBasic` | Read basic details of user calendars | "Allows the app to read events in user calendars, except for properties such as body, attachments, and extensions." | No | Available |
| `Calendars.Read` | Read user calendars | "Allows the app to read events in user calendars." | No | Available |
| `Calendars.Read.Shared` | Read user and shared calendars | Also delegate and shared calendars | No | Available |

- **Least privileged for both calls:** [List calendarView](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0) and [List calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0) both name `Calendars.ReadBasic` as the least privileged delegated permission, for work or school and for personal accounts.
- **Pick:** `Calendars.ReadBasic`.
  Solara never needs an event's body (the meeting notes, where dial-in passcodes and private text live), attachments or extensions, so the narrower permission matches what Google's `calendar.events.readonly` plus Solara's `fields` filter achieve, but enforced by Microsoft rather than by Solara's query.
  It also covers the calendar list, so Solara needs one permission where Google needed two.
- **Not `Calendars.Read.Shared`:** calendars other people share with the person are out of scope for the first version; Solara lists only calendars whose `isSharedWithMe` is false.
- **Not `User.Read`, `openid`, `profile`, `email` or `offline_access`:** Solara does not need to know who the Microsoft account is, and must not receive a refresh token (see [Auth](#auth-hand-rolled-pkce-not-msaljs)).
  The default `User.Read` that a new registration adds is removed in the [owner steps](#owner-steps-in-azure).
- **Build gate:** Microsoft does not list exactly which event properties `Calendars.ReadBasic` returns beyond "except for properties such as body, attachments, and extensions".
  Before writing the parser, the build lane confirms with a real personal account and a real work account (Graph Explorer, or the fake-free staging build) that `subject`, `location`, `start`, `end`, `isAllDay`, `isCancelled`, `responseStatus` and `iCalUId` come back under `Calendars.ReadBasic`.
  If `subject` or `location` do not, the fallback is `Calendars.Read`, with the same `$select`, and this document and the privacy text change to say so.

## Auth: hand-rolled PKCE, not MSAL.js

### The options

| | MSAL.js (`@azure/msal-browser` 5.27.0) | Hand-rolled authorization code flow with PKCE |
| --- | --- | --- |
| Size | 76.7 KB gzip, measured 2026-10-28 by bundling only `PublicClientApplication` with `acquireTokenPopup` (esbuild, minified, tree-shaken); bundlephobia reports 76.0 KB | About 3 KB gzip (estimate: PKCE with WebCrypto, a popup, a BroadcastChannel listener, one token POST, error mapping) |
| Refresh tokens | Always: MSAL adds `openid`, `profile` and `offline_access` to every request (`OIDC_DEFAULT_SCOPES` in `@azure/msal-common`), and caches refresh tokens with the access tokens ([caching](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/caching)), in `sessionStorage` by default or in memory with `memoryStorage` | Never: a refresh token is "only provided if `offline_access` scope was requested" ([auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)), and Solara does not request it |
| Maintenance | Microsoft maintains the protocol code; Microsoft's protocol page says hand-crafting requests is "not recommended" | Solara owns about 150 lines of protocol code and their tests |
| Silent renewal | Hidden iframes, which fail where third-party cookies are blocked (Safari) | None: like Google, a token lasts about an hour and Refresh asks again |

### Decision

Hand-rolled PKCE, in `lib/microsoft-auth.ts` (new), imported only by the lazily loaded Outlook module.

- **Why not MSAL:** it would load about 77 KB of JavaScript the first time a signed-in person opens the Outlook panel, more than a third of the guest's whole first load (budget 193 KB, about 189 KB today, `tests/e2e/guest.spec.ts`), to do one popup and one POST.
  Lazy loading keeps it out of the first load, but it would still be the largest chunk in the app for a rarely used feature.
  More decisive: MSAL always asks for `offline_access` and holds a refresh token, which breaks the "no refresh tokens" promise that the Google feature makes and the privacy policy repeats.
  Holding it only in memory (`memoryStorage`) narrows but does not remove that difference.
- **What the hand-rolled flow does** ([auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)):
  1. Make a random `code_verifier` (32 random bytes, base64url), its S256 `code_challenge` with `crypto.subtle`, and a random `state`; keep both in memory only.
  2. Open a popup (on the click, so it is not blocked) to `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` with `client_id`, `response_type=code`, `redirect_uri`, `response_mode=query`, `scope=https://graph.microsoft.com/Calendars.ReadBasic`, `state`, `code_challenge` and `code_challenge_method=S256`.
     "Show my Outlook events" also sends `prompt=select_account`, so a person with both a personal and a work account picks one; Refresh and "Choose calendars" do not, so Microsoft reuses the account it has signed in, usually without a prompt, and a Refresh cannot silently switch to another account's calendar (default, owner may change, 2026-10-28).
  3. Microsoft redirects the popup to Solara's redirect page, `/auth/microsoft/` (new static page, `app/auth/microsoft/page.tsx` (new)), which reads `code`, `state` or `error` from its query, removes them from the address bar with `history.replaceState`, posts them on a `BroadcastChannel` named for this flow, and closes itself.
     A BroadcastChannel works whatever `window.opener` is after the popup visited Microsoft's pages, and it never leaves the origin.
     Solara's own `Cross-Origin-Opener-Policy: same-origin-allow-popups` (firebase.json) puts the redirect page in a browsing context group of its own when the popup comes back from Microsoft, which severs the app's handle on the popup: `popup.closed` reads true from the moment the redirect page arrives, before its script has run (REVIEW7 M1).
     So the hand-back script is the first thing in the page's `<head>`, right after its Content-Security-Policy and before any stylesheet, font or other resource (moved there by `scripts/static-pages.mjs`), so nothing on the page can delay it; and the app waits 5 seconds after `closed` (`MICROSOFT_CLOSED_GRACE_MS`) before it treats the popup as closed by the person.
  4. The app checks `state`, then POSTs `client_id`, `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier` and `scope` to `https://login.microsoftonline.com/common/oauth2/v2.0/token` with `fetch`.
     The browser sends the `Origin` header, which Microsoft requires for redirect URIs of the "Single-page application" type, and that type is what enables CORS on the token endpoint ([auth code flow, "Redirect URIs for single-page apps"](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)).
  5. The answer's `access_token` and `expires_in` are kept in memory, as `lib/gcal.ts` does for Google; nothing is written to storage, and the code verifier is dropped.
- **The redirect page** loads none of the app: one small hashed inline script (hashed into its CSP by `scripts/csp.mjs` like every inline script), no analytics, no Firebase, no third-party request, so the one-minute authorization code never reaches another origin (the `Referrer-Policy` is already `strict-origin-when-cross-origin`).
  Its Content-Security-Policy is its own (`redirectPagePolicy` in `lib/csp.mts`): its inline scripts' hashes, its own stylesheets, font and icon, `connect-src 'none'`, and no third-party origin at all.
  The app-shell service worker (`scripts/sw/shell.ts`) must pass `/auth/microsoft/` through to the network instead of serving the app shell for it.
- **Errors:** `access_denied` (the person said no), a popup that closed or never reported back (a 3-minute timeout, as `TOKEN_TIMEOUT_MS` in `lib/gcal.ts`), a blocked popup, a page without Web Crypto (`crypto.subtle` exists only on https and localhost pages, so a development server on a LAN address says it needs a secure connection), and a token error are mapped to the same `CalendarAuthReason`-style reasons the Google panel shows; an organisation that requires admin approval gets its own message (see [Accounts](#personal-and-work-or-school-accounts)).
- **Tests:** unit tests for the PKCE pair (RFC 7636's appendix B example), state checks, and every error path; a signed-in browser test against a fake authorize page and fake token and Graph endpoints served by the test server, with the real rules and firebase.json's security headers, as the Google feature does with its fake Calendar; and `tests/e2e/microsoft-sign-in.spec.ts`, which runs the real sign-in code and redirect page on the Hosting emulator with slow stylesheets in Chromium, Firefox and WebKit.

## Personal and work or school accounts

- **Authority:** `common`, which accepts both personal Microsoft accounts and work or school accounts; `consumers` accepts only personal accounts and `organizations` only work or school accounts ([auth code flow, `tenant`](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)).
  The registration's supported account type must match: "Any Entra ID Tenant + Personal Microsoft accounts" ([register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)).
- **Personal accounts (Outlook.com, Hotmail, Live):** the person consents for themselves; `Calendars.ReadBasic` is "available for consent in personal Microsoft accounts" ([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)).
- **Work or school accounts:** `Calendars.ReadBasic` does not require admin consent, and by default users may consent to permissions that do not ([configure user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)).
  But a tenant's admin can turn user consent off, or allow it only "for apps from verified publishers, for selected permissions", which Microsoft recommends; and with risk-based step-up consent, users "can't consent to most newly registered multitenant apps that aren't publisher verified" ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
  So in many companies the person will be asked to request an admin's approval, or refused.
  Solara then shows "Your organisation needs to approve Solara before it can read your work calendar." and "Ask your IT team, or add the calendar by link instead.", with a link to the [Add a calendar from... guide](CALENDAR_LINKS.md).
- **Admin consent is never requested by Solara:** it has no reason to read anyone's calendar but the signed-in person's.

## Publisher verification

- Publisher verification puts a blue "verified" badge on the consent prompt and is what most tenant consent policies key on ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
- It is free ("Microsoft doesn't charge developers for publisher verification"), but needs a verified Microsoft AI Cloud Partner Program account for the publisher's organisation, an app registered with a work or school account in an Entra tenant, and an email domain that matches the app's publisher domain or a DNS-verified custom domain in that tenant.
  Solara is published from `solara-uv.web.app`, a Firebase subdomain with no DNS the owner controls, and the operator has no Partner Program account, so verification is not possible today.
- **Default:** ship without it.
  Personal accounts are unaffected beyond the prompt showing the publisher as unverified; some work or school accounts will need their admin, as above.
  Revisit if Solara moves to its own domain.

## What is read

- **Calendars:** `GET https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar,isSharedWithMe` for "Choose calendars" ([List calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0)); calendars shared with the person are left out.
  The default calendar is read with `/me/calendar/calendarView` and stored as `default`, so its Graph id (and the owner's address, which the calendar resource carries) is never stored.
- **Events:** `GET /me/calendar/calendarView` or `/me/calendars/{id}/calendarView` with `startDateTime` and `endDateTime` (now and 30 days ahead, as ISO instants with `Z`), which returns "the occurrences, exceptions, and single instances of events" in the range, so recurring events arrive expanded ([List calendarView](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0)).
- **`$select`:** `subject,start,end,isAllDay,isCancelled,isOnlineMeeting,location,responseStatus,iCalUId,type,originalStart,originalStartTimeZone`.
  Never `body`, `bodyPreview`, `attendees`, `organizer`, `onlineMeeting` or `onlineMeetingUrl`: the last two hold join links, which can carry passcodes ([event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)).
  `location` comes back whole (`displayName`, `locationType`, `coordinates`, `address`, `locationUri`); Solara reads `displayName`, `locationType` and `coordinates` in memory and drops the rest.
- **Time zones:** without a `Prefer: outlook.timezone` header, `start` and `end` come back in UTC ([List calendarView](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0)); Solara sends none and reads `dateTime` as UTC (it has no offset, so `Z` is added before parsing).
  The event's zone for display is `originalStartTimeZone`, a Windows zone name such as "Pacific Standard Time" in Microsoft's example, mapped to IANA with the table the .ics parser already has (`WINDOWS_ZONES` in `packages/core/src/ics-parse.ts`, exported for this); an IANA name is used as is; `tzone://Microsoft/Custom` (a legacy custom zone from desktop Outlook) or an unknown name falls back to the person's zone, as Google events without a zone do.
- **Paging:** the page size differs per API and is not documented for calendarView ([paging](https://learn.microsoft.com/en-us/graph/paging)); Solara asks for `$top=100` and follows `@odata.nextLink` as given, at most 10 pages per calendar, so at most 1,000 occurrences are read per calendar per refresh.
- **Throttling:** Outlook allows 10,000 requests per 10 minutes and 4 concurrent requests per app and mailbox ([throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)); a refresh makes at most about 100 sequential requests (10 calendars, 10 pages), so it cannot reach either; a `429` keeps the token, waits for `Retry-After` once (seconds or a date, at least 1 second and at most 30, and 5 seconds when the header is missing or unreadable), then reports "Outlook is busy, try again shortly".
- **Auth failures:** a `401` drops the token and asks to connect again (`CalendarAuthError` pattern from `lib/gcal.ts`); a `403` on one calendar marks it "no longer shared" like Google's 404 and 410.

## Mapping to Solara's stored event

Each kept event becomes the same `ParsedIcsEvent` that `lib/google-events.ts` builds, then the same `ImportedEvent` (`packages/core/src/events.ts`) through `recordsFromImport` in `lib/events.ts`.

| Graph | Solara | Rule |
| --- | --- | --- |
| `isCancelled: true` | skipped | Cancelled meetings can linger in the calendar until removed |
| `isAllDay: true` | skipped (`allDay`) | As for Google: the UV card needs a time |
| `responseStatus.response == 'declined'` | skipped (`declined`) | As for Google |
| `end - start` over a week | skipped (`tooLong`) | As for files and Google |
| `subject` | `title` | Invisible formatting stripped and capped with `stripInvisibleFormatting` and `capText`, as for Google |
| `start.dateTime`, `end.dateTime` (UTC) | `start`, `end` | Events that have ended are skipped |
| `originalStartTimeZone` | `timeZone` | Windows name to IANA, else the person's zone |
| `location.displayName` | `where` | Dropped when it is a link (`isLinkLocation` in `lib/google-events.ts`), when `isOnlineMeeting` is true and the text is the meeting provider's name, or when `locationType` is `conferenceRoom` (an office room is indoors and not a town) |
| `location.coordinates.latitude`, `longitude` | `geo` | Used as the place like an .ics `GEO`, when both are numbers in range; expected mainly for places picked from Outlook's place search, whose `locationType` is a value such as `streetAddress` or `restaurant` ([location resource](https://learn.microsoft.com/en-us/graph/api/resources/location?view=graph-rest-1.0)) |
| no usable place and no activity match | skipped (`noPlace`) | As for Google: video calls and office meetings are dropped and never stored |
| `iCalUId` | `uid` | Unique per occurrence ("This ID is different for each occurrence in a recurring series") |
| `originalStart` (occurrences and exceptions only) | `recurrenceId` | ISO instant, as for Google |
| everything else | not read | |

- **Source:** a new `outlook` value in `IMPORTED_EVENT_SOURCES` and `CLIENT_EVENT_SOURCES` (`packages/core/src/events.ts`) and the same lists in `firestore.rules`; keys are `importedEventKey('outlook', iCalUId, originalStart)`.
- **Connection document:** `users/{uid}/meta/outlookCalendar` with `calendars` (`{ id, name }`, the default one as `default` with an empty name), `connectedAt` and `syncedAt`, typed and capped by the rules like `googleCalendar` (`packages/core/src/outlook-calendar-events.ts` (new), mirroring `packages/core/src/google-calendar-events.ts`).
  Graph calendar ids are long base64 strings; the cap is 512 characters until the build lane measures real ones.
- **Nothing identifies the Microsoft account:** no email, name or tenant is requested or stored.

## Duplicates with other sources

- **Same event on two chosen calendars:** stored once (same `iCalUId` and occurrence, so the same key).
- **Same event from a file, a linked calendar, Google or Outlook:** the rule from `syncGoogleEvents` applies unchanged: an event already stored from another source with the same title, start and end is not stored again, and a file import of the same single event (same UID) wins.
  Exchange's `iCalUId` for an occurrence differs from the series UID an .ics export carries, so the UID match works for single events only; the title and time match covers the rest.
- **The same calendar linked by its published ICS link and connected through Graph:** the title and time match keeps one copy; the Outlook panel says how many were "already in Solara".
- **Heads-ups:** FIX5B's rule already counts the same title starting within 30 minutes once across sources, so an Outlook event never adds a second push.

## Caps and key lists

- At most 10 calendars, the next 30 days, at most 200 events kept per refresh (the soonest), as `GOOGLE_EVENT_LIMITS`; `OUTLOOK_EVENT_LIMITS` (new) in the new core module.
- Outlook events count toward the account's 1,000 events through the same key list (`lib/key-index.ts`), written by the app under the rules; a refresh removes stored Outlook events that are gone (deleted, cancelled, declined, moved out of the window, or on a calendar no longer chosen) before saving, so they make room, and says how many did not fit.
- Unchanged events are not written again (the `COMPARED` fields check in `lib/google-events.ts`, shared rather than copied).

## Refresh, sign-out and disconnect

- **Refresh:** while Solara is open and the in-memory token is valid (its `expires_in`, about an hour in Microsoft's example answer), every 30 minutes; otherwise when the person presses Refresh, which opens the popup again, usually without a prompt, because Microsoft remembers the consent and the sign-in session and Refresh does not ask for the account picker.
- **Signing out of Solara or switching accounts:** forgets the token, as `forgetCalendarTokens` does for Google, and ends any sign-in still open, closing its popup, so a sign-in started before a sign-out can never leave its token for the next account in the same tab (REVIEW7 L1).
  Solara does not call Microsoft's sign-out endpoint: it would sign the person out of Outlook everywhere in that browser.
- **Disconnect:** forgets the token (and ends any sign-in still open), then deletes the connection document, so no refresh on any device can store events from then on (the rules refuse them), then every `outlook` event with its keys.
  There is no revoke call a public client can make for its own grant: Microsoft's documented ways to remove an app's consent are the person's own account pages, so the confirmation links to them:
  - personal accounts: <https://account.live.com/consent/Manage> (named in a [Microsoft Q&A article](https://learn.microsoft.com/en-us/answers/questions/4375979/article-managing-apps-and-services-connected-to-ou), not in Microsoft's reference docs);
  - work or school accounts: My Apps, <https://myapplications.microsoft.com/>, then "Manage your application" and "Revoke Permissions" ([Microsoft support](https://support.microsoft.com/account-billing/edit-or-revoke-application-permissions-in-the-my-apps-portal-169be2b4-ee26-4338-aea8-d19bb2f329ee)); permissions an admin granted cannot be revoked there.
  Because Solara never holds a refresh token, the remaining consent lets Solara read nothing until the person opens Solara, clicks Show or Refresh, and the popup completes.
- **Account deletion:** removes both with the rest of `users/{uid}`, as for Google.

## CSP

`lib/csp.mts` gains two `connect-src` origins, with comments, and nothing else:

- `https://login.microsoftonline.com` for the token POST (the authorize page opens in a popup, a top-level window that the page's CSP does not govern);
- `https://graph.microsoft.com` for the calendar reads.

No `script-src` (no library script is loaded), no `frame-src` (no hidden iframe renewal), and no `img-src` (no profile photo).
The redirect page gets a policy of its own instead (`redirectPagePolicy` in `lib/csp.mts`), since a code sits in its address: `script-src` with its own inline scripts' hashes only (the theme, the hand-over and, in a build with analytics, the consent banner's layout), `style-src`, `font-src` and `img-src` of its own origin, `connect-src 'none'`, `frame-src 'none'`, and no Google, Tag Manager or other third-party origin.
The integrations browser suite gains a check that a connect and a refresh raise no CSP violation, as it does for Google's revoke.

## Privacy policy, export and deletion

- **Privacy policy (`app/privacy/page.tsx`):** a "Events from your Outlook calendar" entry beside Google's in what is collected, the processor list ("Microsoft identity platform and Microsoft Graph: only when you connect Outlook"), retention ("until they are gone from your calendar or you disconnect, and 30 days after each event ends") and the rights section (Disconnect, and the two consent pages above).
  It names the permission ("Read basic details of user calendars", `Calendars.ReadBasic`), says that only the title, time, time zone, location text, place and activity are kept, that meeting links, notes and guests are never read or kept, and that no Microsoft token is stored.
- **Export:** `outlookCalendar` (the chosen calendars) beside `googleCalendar`, and Outlook events in `importedEvents` with `source: 'outlook'`; the account page's list of export sections gains it (the test that compares that list with the real export catches a miss).
- **Deletion:** covered by the recursive delete of `users/{uid}`; the emulator test that checks deletion removes Google events gains an Outlook event.

## How it is switched on

- `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, from the `MICROSOFT_CLIENT_ID` repository variable (a public identifier, never a secret; a public client has no secret).
- `NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED`, `'1'` when the `OUTLOOK_CALENDAR_EVENTS_ENABLED` repository variable is `true`, wired in `.github/workflows/deploy.yml` beside `GOOGLE_CALENDAR_EVENTS_ENABLED`.
- `.github/scripts/check-public-env.mjs` gains the same checks it has for Google: the flag is `'1'` or empty, and a set flag without a client ID fails the deploy.
- The panel shows only when both are set; `lib/plans.ts` lists it with the other event sources so the Events section names every switched-on source.
- `docs/DEPLOYMENT.md` gains an "Events from Outlook" section and `docs/status.md` a row under "Built but switched off" when it is built.

## Owner steps in Azure

Needed only for this Outlook connection; none of Solara's other features use Microsoft.
The checklist copy is in [OWNER_CHECKLIST.md](../OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection).

1. **An Azure account (free).** Registering an app needs "An Azure account that has an active subscription" and a tenant, for which the free account's Default Directory works ([register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)).
   The free account asks for a phone number and a non-prepaid card for identity verification; Microsoft says "We don't charge your credit card or debit card anything when you sign up", with a temporary one-dollar verification hold, and nothing is charged unless you move to pay-as-you-go ([Azure free account FAQ](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)).
2. **Register the app** at <https://entra.microsoft.com>, **Entra ID**, **App registrations**, **New registration**: name `Solara`, supported account types **Any Entra ID Tenant + Personal Microsoft accounts**.
3. **Redirect URI**, platform **Single-page application (SPA)**: `https://solara-uv.web.app/auth/microsoft/`.
   The SPA type is what lets the browser redeem the code ([auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)); redirect URIs must be `https` except on localhost, are case-sensitive, and for apps that accept personal accounts cannot carry query parameters or wildcards ([redirect URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)).
4. **Local development:** Microsoft advises separate registrations for development and production ([redirect URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)), so register a second app, `Solara (dev)`, the same way with the SPA redirect URI `http://localhost/auth/microsoft/`.
   For localhost Microsoft ignores the port when matching, so this one URI covers `npm run dev` on any port.
   Its client ID goes only in a developer's `.env.local`; tests use the fake endpoints and need no registration at all.
5. **API permissions:** remove the default `User.Read`, then **Add a permission**, **Microsoft Graph**, **Delegated permissions**, `Calendars.ReadBasic`.
   Do not press "Grant admin consent".
6. **Authentication:** leave **Access tokens** and **ID tokens** (implicit grant) unticked and **Allow public client flows** off.
7. **Branding and properties:** the home page `https://solara-uv.web.app/`, terms `https://solara-uv.web.app/terms/`, privacy `https://solara-uv.web.app/privacy/`, and the Solara logo, which the consent prompt shows.
8. **Give the agent the Application (client) ID** (public): `gh variable set MICROSOFT_CLIENT_ID --repo n8watkins/solara --body <client id>`.
9. **Once the build is merged and checked in staging or a preview with a controlled personal account and, if available, a work account, and one sign-in has gone through with production's headers, the cache cleared and the network throttled (REVIEW7 M1):** `gh variable set OUTLOOK_CALENDAR_EVENTS_ENABLED --repo n8watkins/solara --body true`.
10. **No Microsoft review is needed.** `Calendars.ReadBasic` needs no admin consent, there is no counterpart to Google's sensitive-scope verification for delegated Graph permissions, and publisher verification is optional and not possible yet ([Publisher verification](#publisher-verification)).
    Microsoft 365 App Certification is a separate, optional program for apps that want it ([publisher verification FAQ](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)); Solara does not.

## Costs

All $0:

- Azure free account: no charge at sign-up ([Azure free account FAQ](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)).
- App registration in the free account's directory: no cost and no license (the registration guide lists no paid prerequisite beyond the free account, [register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)).
- Microsoft Graph calendar reads: not metered; the only metered Graph API today is SharePoint and OneDrive's `assignSensitivityLabel` ([metered APIs](https://learn.microsoft.com/en-us/graph/metered-api-list)).
- Firebase: Spark is enough; the reads and writes are the person's own, within the same caps as Google events.
- Publisher verification, if ever done: free ([publisher verification FAQ](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).

## Build plan

One lane, size M, after REVIEW6's fixes land in the events code:

1. `packages/core/src/outlook-calendar-events.ts` (new): limits, the connection schema and parser, the `outlook` source, and an exported Windows-to-IANA helper from `packages/core/src/ics-parse.ts`; `firestore.rules` and `lib/firestore-rules.test.ts` with it.
2. `lib/microsoft-auth.ts` (new) and `app/auth/microsoft/page.tsx` (new): the PKCE popup flow; the service worker pass-through.
3. `lib/outlook-events.ts` (new): the Graph reads, `parseOutlookEvent` and the refresh, sharing the refresh, duplicate and comparison code with `lib/google-events.ts` instead of copying it.
4. `components/events/OutlookCalendarEvents.tsx` (new), following `components/events/GoogleCalendarEvents.tsx`; preview before polish (desktop, then mobile).
5. CSP, env checks, deploy wiring, privacy policy, export list, DEPLOYMENT, status, checklist.
6. Tests: unit (PKCE, parsing every row of the mapping table, time zones including `tzone://Microsoft/Custom`, duplicates, caps), static and emulator rules tests, a signed-in browser test against fake Microsoft endpoints with the real rules, UI harness screens at 390 and 1440 px in light and dark, the integrations CSP check, and the guest first-load budget unchanged.

## Open questions

Each is handled so the build works either way; the owner's live check settles them ([owner checklist, steps 9 and 10](../OWNER_CHECKLIST.md#events-from-outlook-only-for-the-outlook-connection)).

- **Exact properties under `Calendars.ReadBasic`:** Microsoft documents only "except for properties such as body, attachments, and extensions"; a Microsoft Q&A answer (not staff-confirmed) claims the application-only `Calendars.ReadBasic.All` hides subject and location.
  The build could not reach a real account, so the parser treats every field as optional: an event without a subject keeps only its place, one without a location only an activity match, and nothing fails; the tests cover both.
  If the live check shows empty titles or no places, the fallback is `Calendars.Read` with the same `$select`, and the privacy policy changes to say so.
- **calendarView page size:** not documented; Solara asks for `$top=100` and follows `@odata.nextLink` for up to 10 pages, so any smaller page size Microsoft applies only means more pages.
- **Graph calendar id length:** Microsoft's examples are about 150 characters; the cap stays 512 in the schema and rules, and longer ids are left out of "Choose calendars" rather than failing.
- **Internet calendars a person subscribed to inside Outlook.com:** if they appear in `/me/calendars` with the person as owner they are offered, and a `403` or `404` when reading one shows "no longer shared"; such feeds can be added to Solara directly as [linked calendars](CALENDAR_LINKS.md).
- **Personal-account consent page:** `https://account.live.com/consent/Manage` is documented by a Microsoft Q&A article and third-party guides, not by a Microsoft reference page; it is linked after a disconnect and in the privacy policy, and the live check confirms it lists Solara.
- **Closing the popup:** Solara notices a closed popup by polling `closed`, as MSAL.js does.
  Solara's own `Cross-Origin-Opener-Policy` makes the popup read as closed as soon as the redirect page arrives (REVIEW7 M1), so the hand-back script runs first on that page and the app waits 5 seconds after `closed`; the browser test reproduces it in three engines with slow stylesheets, and the owner's live check signs in once on production with the cache cleared and the network throttled.
- **Refresh tokens:** Solara never asks for `offline_access`, so by Microsoft's documentation it is given no refresh token, and it would drop one if it were; the live check confirms the token answer carries none.

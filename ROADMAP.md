# Solara — Project Roadmap & Gap Analysis

> Last updated: May 2026  
> Current state: Local development build, no Firebase configured, no production deployment

---

## Where we are vs. where we said v1 would be

When we scoped v1, the promise was:
- Live UV dashboard personalized to your location ✅
- Safe activity windows based on skin type ✅
- Google Calendar integration ✅
- Anonymous / Free / Pro tier structure ✅
- Firebase auth + Firestore sync ⚠️ *built but untested end-to-end*
- Push notifications ⚠️ *infrastructure built, never tested live*
- Deployed, publicly accessible URL ❌ *not deployed*
- Firebase security rules ❌ *database wide open*
- PWA / installable ❌ *no manifest*

**Assessment:** The UI and logic are largely v1-complete. The gaps are in production readiness, not features. We built a lot of sophisticated product surface area (calendar, tier system, activity manager) before locking down the fundamentals. That's fine for a dev build — but the app is not shippable as-is.

---

## Section 1 — Critical (fix before sharing with anyone)

### 1.1 Firestore security rules
**Risk: HIGH**  
The database currently uses default rules, which means anyone who finds your Firebase project ID in the JS bundle can read and write every user's data. The project ID is exposed in the browser.

```
// What needs to be in firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 1.2 Dev panel in production
The `DevPanel` component renders unconditionally. It must be gated:
```tsx
// In App.tsx
{process.env.NODE_ENV === 'development' && <DevPanel ... />}
```

### 1.3 localStorage migration guard
The `Activity` type gained a `sunscreen` field mid-development. Users with old localStorage data will have activities missing that field, causing silent logic failures. A migration function needs to run on app load to backfill `sunscreen: false` on any stored activity that lacks it.

### 1.4 Duplicate API calls
The Dashboard and CalendarView each independently fetch Open-Meteo data. On the Calendar tab, two fetches run simultaneously for the same location. The 1-hour localStorage cache in `lib/cache.ts` only covers the Dashboard fetch. CalendarView has no cache and re-fetches every mount.

---

## Section 2 — Production readiness (fix before launch)

### 2.1 Firebase deployment not configured
`.firebaserc` contains `YOUR_FIREBASE_PROJECT_ID` as a placeholder. The GitHub Actions deploy workflow references secrets that don't exist in the repo. The app has never been deployed to Firebase Hosting.

**Steps needed:**
1. Create Firebase project
2. Fill in `.env.local` from Firebase console
3. Add all 6 secrets + `FIREBASE_SERVICE_ACCOUNT` to GitHub repo secrets
4. Generate VAPID key for push notifications
5. First manual deploy: `firebase deploy`
6. Confirm GitHub Actions auto-deploy works on next push

### 2.2 Push notification flow never tested end-to-end
The `scripts/send-notifications.js` cron has never been run against a real Firebase project. It requires:
- At least one user with an FCM token stored in Firestore
- `FIREBASE_SERVICE_ACCOUNT` secret in GitHub
- The service worker correctly registered in a real browser (not localhost)

Safari and Firefox have different FCM behaviors. iOS Safari doesn't support web push at all without a native wrapper.

### 2.3 PWA manifest missing
There is no `manifest.json` in `/public`. Without it the app can't be installed to a home screen, which is a significant gap for a tool people would use daily. A daily UV check is a perfect use case for a home screen app.

**Needs:**
- `/public/manifest.json` with name, icons, theme color
- Icons at 192px and 512px
- `<link rel="manifest">` in `app/layout.tsx`
- `meta name="apple-mobile-web-app-capable"` for iOS

### 2.4 Social metadata / OG tags
Sharing the URL produces a blank card. Needs:
- `og:title`, `og:description`, `og:image` in `app/layout.tsx`
- Twitter card meta
- A static OG image (could be the outdoor SVG from the welcome screen)

### 2.5 Error boundaries
No React error boundaries exist. A single component crash (e.g., malformed weather data) takes down the entire app with a white screen. At minimum, wrap Dashboard and CalendarView in error boundaries.

### 2.6 `.gitignore` gaps
`tsconfig.tsbuildinfo` was committed. Also `.env.local` should be confirmed excluded (it is, but should verify). Clean up:
```
tsconfig.tsbuildinfo
out/
.env.local
.env*.local
```

---

## Section 3 — UX debt

### 3.1 Preferences: unsaved changes warning
The modal closes silently when you click outside or hit cancel, discarding unsaved changes. Standard pattern: compare initial state vs. current state on close; show a "Discard changes?" confirmation if different.

### 3.2 Tip carousel pauses on hover
The vitamin D carousel advances while the user is mid-sentence reading it. Should pause `setInterval` on `onMouseEnter`, resume on `onMouseLeave`.

### 3.3 Mobile header crowding
At narrow widths, the header tries to fit: logo, location badge, tier badge, UV alert, preferences button, sign-in button. Collapses badly below ~360px. Need a responsive header that hides less-important elements on mobile and puts them in a hamburger or the preferences modal.

### 3.4 Calendar grid with 4+ activities
Activity blocks get too narrow to read at 4+ activities. Options:
- Hard cap visible at 3, add a "+N more" overflow
- Add a single-activity filter to focus the calendar on one activity
- Switch to a list view for days with many activities

### 3.5 "Add to Calendar" gives no feedback
Clicking the button opens a browser tab silently. A brief toast ("Opening Google Calendar…") would confirm the action worked, especially on mobile where tabs open behind the current view.

### 3.6 No empty forecast state
If Open-Meteo returns no data for a day (possible near forecast edges), the app shows a blank dashboard. Need a specific "No forecast available for this date" state.

### 3.7 Onboarding re-trigger
There's no way to re-do onboarding after completing it. If a user wants to change their initial setup significantly, they have to dig through preferences. A "Reset setup" option in the Account tab would help.

---

## Section 4 — Product / business gaps

### 4.1 "Upgrade to Pro" goes nowhere
The button exists in preferences but clicking it does nothing. At minimum it should open a modal explaining what Pro includes and capturing an email for a waitlist. Before charging money, options:
- Simple Typeform / waitlist form
- Stripe Checkout integration (adds ~1 day of work)
- In-app purchase via RevenueCat if this becomes a native app

### 4.2 Free tier limit may be too tight
1 activity on the free tier is aggressive. Industry standard for freemium is "enough value to get addicted, not enough to feel complete." 3 activities free / unlimited paid is a more common conversion hook. Worth A/B testing.

### 4.3 No analytics
Firebase Analytics is included in the Firebase SDK and free. Zero code changes needed beyond calling `logEvent()` at key moments. Without it there's no data on which features people actually use, whether they complete onboarding, or what the Calendar vs. Dashboard split is.

Key events to track:
- `onboarding_complete`
- `activity_added`
- `calendar_opened`
- `add_to_calendar_clicked`
- `notification_enabled`
- `upgrade_clicked`

### 4.4 No sharing / virality hook
"Here's my UV window for running today" is shareable content. A share button that generates a simple URL or image card (e.g., `solara.app/share?city=Burbank&uv=5.4&activity=running`) could drive organic growth. The welcome page already has good visual assets for this.

### 4.5 No offline support
The app fails entirely with no network. For a tool used in the morning before heading out, this is a meaningful gap. A service worker that caches the last-known forecast and serves it when offline would make the app feel much more reliable.

### 4.6 Location permission UX
If a user denies location on the welcome screen and types a city, there's no way to later switch to GPS without going back through preferences. Should offer "use GPS instead" in the location popover even after a manual city is set.

---

## Section 5 — Technical debt

### 5.1 Dead code
`DEFAULT_ACTIVITIES` in `lib/weather.ts` is no longer used — activities now come from `PRESET_ACTIVITIES` in `lib/tiers.ts`. Should be removed to avoid confusion.

### 5.2 `any` types
Several places use `as any` casts to silence TypeScript, particularly in `CalendarView.tsx` and `App.tsx`. These mask real type issues:
- `WebkitOverflowScrolling: 'touch' as any`
- Filter functions returning `as any`
These should be properly typed.

### 5.3 No test coverage
Zero tests. For a tool where incorrect UV thresholds or wrong burn time calculations could give genuinely bad advice, the core utility functions (`burnMins`, `effectiveMaxUV`, `getSafeWindows`) should have unit tests. A bug here isn't just a UX problem.

### 5.4 `lib/weather.ts` is too large
The file mixes utility functions, type calculations, and default data. Should split into:
- `lib/uv.ts` — UV calculations (burn time, vitamin D, effectiveMaxUV)
- `lib/weather.ts` — weather fetching and formatting only

### 5.5 CalendarView re-fetches on every mount
The 7-day forecast fetch in CalendarView has no persistence layer. Every time the user switches to the Calendar tab it re-fetches. Should use the same localStorage cache as the dashboard, keyed to `solara_weather_7day`.

---

## Section 6 — Future versions

### v1.1 — Stabilization (1–2 weeks)
- Fix all Section 1 + Section 2 items
- Deploy to Firebase Hosting
- Add PWA manifest
- Firestore security rules
- First real end-to-end test of push notifications
- Basic Firebase Analytics events

### v1.2 — Polish (2–4 weeks)
- Mobile header redesign
- Unsaved changes warning in preferences
- Calendar: single-activity focus mode
- Offline support via service worker
- OG tags + social sharing card
- Upgrade to Pro waitlist capture

### v2.0 — Monetization & growth (1–2 months)
- Stripe integration for Pro tier
- Native app wrapper (Capacitor or React Native) for iOS push notifications
- Share card generation ("my UV window today")
- Historical UV log — see your past safe windows and actual time outside
- Streak tracking — how many days in a row did you hit your vitamin D goal?
- Location-based notifications: "UV drops to safe in 2 hours — good time for a run"

### v2.5 — Social & ecosystem (3–6 months)
- Friend/family sharing — send your UV window to someone else
- Group activities — "our 10am golf tee time is UV 6.2, here's what everyone needs to know"
- Dermatologist-mode — more detailed UV exposure log for people managing skin conditions
- Wearable integration — if the user has a UV sensor (Garmin, Apple Watch UV index), pull actual UV data vs. forecast
- API for developers — "UV safe window" as a service

### v3.0 — Platform play (6–12 months)
- Multi-city support — useful for frequent travelers or people splitting time between locations
- Branded white-label version — sell to dermatology practices, outdoor brands (REI, Patagonia), running apps
- AI-personalized coaching: "Based on your skin type and outdoor schedule, here's how you compare to recommended vitamin D levels"
- Integration with health apps (Apple Health, Google Fit) to log UV exposure time

---

## Summary: what v1 still needs before going live

| Item | Effort | Priority |
|---|---|---|
| Firestore security rules | 30 min | 🔴 Critical |
| Gate dev panel to dev only | 5 min | 🔴 Critical |
| localStorage migration guard | 1 hr | 🔴 Critical |
| Firebase project setup + deploy | 2–3 hrs | 🔴 Critical |
| PWA manifest + icons | 2 hrs | 🟠 High |
| OG tags | 30 min | 🟠 High |
| Analytics events | 1 hr | 🟠 High |
| Upgrade → waitlist capture | 2 hrs | 🟠 High |
| Mobile header fix | 3 hrs | 🟡 Medium |
| Tip carousel pause on hover | 15 min | 🟡 Medium |
| Unsaved changes warning | 1 hr | 🟡 Medium |
| Error boundaries | 1 hr | 🟡 Medium |
| Dead code cleanup | 30 min | 🟢 Low |
| Unit tests for UV math | 2 hrs | 🟢 Low |

**Realistic time to a shippable v1: ~2 focused days.**

The hard work is done. The app has a genuinely differentiated value proposition, a working tier system, a polished UI, and solid UV logic. What's left is the unsexy production checklist — but it's also the part that makes the difference between a dev demo and something you can hand to real users.

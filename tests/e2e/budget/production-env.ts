// A public configuration shaped like production's, for the first-load budgets
// (first-load.budget.ts). None of these values exist; each has the length and form of the
// real one, because the build inlines them into the scripts a guest downloads and a
// configured Firebase project switches on code that an empty one leaves out
// (firebaseEnabled in lib/firebase.ts). Measuring the hermetic build of the signed-out
// suite instead read 0.5 KB less than the live site (REVIEW10 QA M1).
//
// Production's switches today (docs/status.md, "Built, switched off"): the Firebase
// project, Web Push and Google Analytics are set; App Check, Sentry, Google Calendar,
// Outlook, Blaze Functions and billing are not. Change this file when one of them is
// switched on, so the budgets keep measuring what people download.
export const PRODUCTION_LIKE_ENV = {
  // 39 characters, like every Firebase Web API key.
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyBudgetBuildFakeKey000000000000000',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'budget-build-solara.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'budget-build-solara',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'budget-build-solara.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
  // 87 characters, like a VAPID public key.
  NEXT_PUBLIC_FIREBASE_VAPID_KEY:
    'BBudgetBuildFakeVapidKey000000000000000000000000000000000000000000000000000000000000000',
  NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY: '',
  NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER: '',
  NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: '',
  NEXT_PUBLIC_FIREBASE_EMULATORS: '',
  NEXT_PUBLIC_SITE_URL: 'https://solara-uv.web.app',
  NEXT_PUBLIC_DEPLOY_ENVIRONMENT: '',
  NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-BUDGET0000',
  NEXT_PUBLIC_FUNCTIONS_URL: '',
  NEXT_PUBLIC_BILLING_ENABLED: '',
  NEXT_PUBLIC_FORECAST_PROXY: '',
  NEXT_PUBLIC_ALERTS_ENABLED: '',
  NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED: '',
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: '',
  NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED: '',
  NEXT_PUBLIC_MICROSOFT_CLIENT_ID: '',
  NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_RELEASE: '',
  NEXT_PUBLIC_UI_HARNESS: '',
  BROWSER_SOURCE_MAPS: '',
  NEXT_TELEMETRY_DISABLED: '1',
}

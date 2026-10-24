// Fake public configuration for the integrations suite. None of these values exist:
// every request they would cause is answered by the fakes in fixtures.ts.
export const FAKE = {
  apiKey: 'fake-integrations-api-key',
  projectId: 'demo-solara-integrations',
  appId: '1:000000000000:web:00000000000000000000aa',
  siteKey: 'fake-recaptcha-v3-site-key',
  dsn: 'https://e2epublickey@o11.ingest.us.sentry.io/22',
  release: 'integrations-e2e',
} as const

/** The Sentry ingest origin that the DSN above points to. */
export const SENTRY_INGEST = 'https://o11.ingest.us.sentry.io'

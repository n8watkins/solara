// The landing page (app/page.tsx in English, app/es/page.tsx in Spanish), built as static
// HTML in each language (lib/page-language.ts).
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('landing', {
  title: 'Solara: Plan around UV',
  description:
    'Forecast-based, lower-UV activity planning personalized for your skin profile and location.',
  socialDescription:
    'Forecast-based, lower-UV activity planning for your skin profile and location.',
  eyebrow: 'UV planning for outdoor people',
  heading: 'Know when to go outside',
  intro:
    'Solara reads the UV forecast where you are and finds the lower-UV windows for running, hiking, swimming and everything else you do outside, tuned to your skin.',
  tryItNow: 'Try it now',
  freeToUse: 'Free to use. No account needed to start.',
  screenshotAlt:
    'Solara on a phone: the next lower-UV slot for a run, the UV index now and the hourly UV forecast for today.',
  screenshotCaption: 'A screenshot of the Solara dashboard.',
  howItWorks: 'How it works',
  step: (n: number) => `Step ${n}`,
  stepPlaceTitle: 'Set your place and skin',
  stepPlaceBody:
    'Type a city or use your location, then pick your skin type. You see the live UV index right away.',
  stepActivitiesTitle: 'Add what you do outside',
  stepActivitiesBody:
    'Running, hiking, swimming, gardening or your own activity, each with how much sun it can take.',
  stepGoTitle: 'Go at the lower-UV time',
  stepGoBody:
    "Solara reads the hourly forecast and shows each activity's lower-UV window and the best day ahead, 10 days out on Pro.",
  plansHeading: 'Start free, upgrade when you want more',
  plansIntro: 'Try Solara without an account. Sign in free to keep your plan on every device.',
  guest: 'Guest',
  // Saved in the browser, which may clear it (Safari after 7 days without a visit), so
  // the note does not promise it stays (REVIEW10 VERIFY10 N4).
  guestNote: 'No sign-in. Your plan is saved in this browser; sign in to keep it safe.',
  freeAccount: 'Free account',
  freeNote: 'Sign in with Google. Synced everywhere.',
  signInFree: 'Sign in free',
  pro: 'Pro',
  perMonth: ' / month',
  proNote: (yearly: string, trialDays: number) =>
    `or ${yearly} a year. ${trialDays}-day free trial. Coming soon: sign in to join the waitlist.`,
  joinWaitlist: 'Join the waitlist',
  /** A plan feature that is not out yet: "Morning alerts (coming soon)". */
  featureComingSoon: (feature: string) => `${feature} (coming soon)`,
  citiesHeading: 'Typical UV by city',
  citiesIntro: 'How strong the sun gets each month, and when UV reaches 3 or more.',
  allCities: 'All cities',
})

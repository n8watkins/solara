import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'
import { AnalyticsPreferenceControl } from '@/components/AnalyticsConsent'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'

export const metadata: Metadata = {
  title: 'Privacy Policy | Solara',
  description: 'How Solara collects, uses, protects, and deletes account and planning information.',
}

export default function PrivacyPage() {
  const analyticsEnabled = isAnalyticsMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

  return (
    <LegalPage title="Privacy Policy" updated="July 14, 2026">
      <h2>What Solara collects</h2>
      <p>
        When you create an account, Solara receives your Firebase account identifier and basic
        Google account details such as your name, email address, and profile image.
      </p>
      <p>
        Solara stores the location you choose, skin profile, activity preferences, calendar planning
        settings, notification preferences, subscription status, and other settings needed to
        provide the service.
      </p>
      <p>Location is a place you select for a forecast and is not continuous device tracking.</p>

      <h2>How information is used</h2>
      <p>
        Solara uses your information to generate personalized outdoor planning estimates,
        synchronize preferences, deliver notifications you request, create calendar feeds, provide
        account support, prevent abuse, and operate subscriptions.
      </p>
      <p>Solara recommendations are estimates and are not medical advice.</p>

      <h2>Service providers</h2>
      <p>Firebase provides authentication, database, hosting, functions, and messaging services.</p>
      <p>
        Open-Meteo provides forecast data and receives the coordinates needed for a forecast
        request.
      </p>
      <p>Stripe processes payments when subscriptions are enabled.</p>
      <p>
        Google Calendar access is requested separately and browser-held access tokens are used only
        to read busy times or create an event when you ask.
      </p>
      <p>
        Google Analytics collects usage and device information only when analytics is configured and
        you explicitly allow it.
      </p>

      <h2>Retention and security</h2>
      <p>Account preferences are retained while your account is active.</p>
      <p>
        Operational and payment records may be retained when required for security, tax, accounting,
        dispute resolution, or legal compliance.
      </p>
      <p>
        Solara uses access controls and capability tokens, but no internet service can guarantee
        absolute security.
      </p>

      <h2>Your choices</h2>
      <p>
        You can disable notifications, rotate or revoke a calendar feed, disconnect calendar access
        through your Google account, download an account-data copy, and delete your account.
      </p>
      <AnalyticsPreferenceControl enabled={analyticsEnabled} />
      <p>
        Use the <a href="/account/">Account data controls</a> page while signed in to download or
        delete your information.
      </p>
      <p>
        Deleting an account removes Solara preferences and notification registrations and cancels an
        active Solara subscription when the subscription integration is configured.
      </p>

      <h2>Children</h2>
      <p>
        Solara is not directed to children under 13 and does not knowingly collect their personal
        information.
      </p>

      <h2>Changes</h2>
      <p>
        Material changes will be reflected by updating the date on this page and, when appropriate,
        by providing an in-product notice.
      </p>
    </LegalPage>
  )
}

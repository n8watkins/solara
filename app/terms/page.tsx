import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'
import styles from '@/components/LegalPolicy.module.css'
import LegalDetail from '@/components/LegalDetail'
import { TERMS_LAST_UPDATED } from '@/lib/legal'
import { languageAlternates } from '@/lib/page-language'

export const metadata: Metadata = {
  title: 'Terms of Use | Solara',
  description: 'Terms, safety limitations, subscriptions, and acceptable use for Solara.',
  // In Spanish at /es/terms/ (app/es/terms/page.tsx).
  alternates: languageAlternates('/terms/', 'en'),
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated={TERMS_LAST_UPDATED} path="/terms/">
      <div className={styles.policy}>
        <h2>Who provides Solara</h2>
        <p>
          Solara is provided by <LegalDetail name="operatorName" />. Questions about these terms go
          to <LegalDetail name="contactEmail" />.
        </p>

        <h2>Using Solara</h2>
        <p>You may use Solara only in compliance with applicable law and these terms.</p>
        <p>
          You are responsible for keeping your account and calendar feed links secure and for
          activity performed through your account.
        </p>

        <h2>Not medical advice</h2>
        <p>
          Solara&apos;s planning windows, burn times, sunscreen guidance, vitamin D figures and
          other estimates are for planning and tracking. They are not medical advice, a diagnosis or
          a treatment, and they do not replace a health professional.
        </p>
        <p>
          If you have a medical condition, take a medicine that makes you more sensitive to the sun,
          are pregnant, or are worried about your skin or vitamin D, ask a health professional
          before relying on Solara&apos;s estimates.
        </p>
        <p>
          Solara does not guarantee that following its estimates prevents sunburn, skin damage, heat
          illness or other harm, or that any time outdoors is safe.
        </p>

        <h2>Forecasts and estimates</h2>
        <p>
          Solara provides estimated planning windows based on forecast data and the preferences you
          enter.
        </p>
        <p>
          Forecasts, ultraviolet exposure, sunscreen performance, skin response, cloud cover,
          medications, altitude, reflection, and local conditions can differ from these estimates.
        </p>
        <p>
          Use current local conditions, follow public health guidance and use appropriate sun
          protection.
        </p>

        <h2>Subscriptions</h2>
        <p>
          Paid features, prices, billing intervals, renewal terms, and cancellation terms are shown
          before checkout.
        </p>
        <p>Stripe processes payments and its terms also apply to checkout.</p>
        <p>
          You may cancel through the available subscription or account controls, and access may
          continue or end according to the terms shown at purchase.
        </p>

        <h2>Acceptable use</h2>
        <p>
          You may not misuse Solara, attempt unauthorized access, interfere with the service, abuse
          shared infrastructure, extract data at unreasonable volume, or use the service to violate
          another person&apos;s rights.
        </p>

        <h2>Data sources and licenses</h2>
        <p>
          Forecasts and place search use data from <a href="https://open-meteo.com/">Open-Meteo</a>,
          whose place search is based on <a href="https://www.geonames.org/">GeoNames</a>, both
          licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC&nbsp;BY&nbsp;4.0</a>.
        </p>
        <p>
          Place names for your device location come from{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>,
          available under the Open Database License.
        </p>
        <p>
          Solara&apos;s own software and content are licensed as follows:{' '}
          <LegalDetail name="codeLicense" />.
        </p>

        <h2>Availability and changes</h2>
        <p>
          Solara may change, suspend, or discontinue features and may update these terms as the
          service develops.
        </p>
        <p>Solara is provided without warranties to the maximum extent permitted by law.</p>

        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Solara and its operator are not liable for
          indirect, incidental, special, consequential, or punitive damages, or for decisions made
          from forecasts or planning estimates.
        </p>
        <p>
          Some jurisdictions do not allow certain warranty exclusions or liability limitations, so
          those provisions may not apply to you.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of <LegalDetail name="jurisdiction" />, without
          regard to conflict-of-law rules, except where the law where you live gives you rights that
          cannot be waived.
        </p>

        <h2>Account termination</h2>
        <p>
          You may delete your account from the <a href="/account/">Account data controls</a> page.
        </p>
        <p>
          Access may be suspended or terminated for material misuse, legal requirements, security
          risk, or violation of these terms.
        </p>
      </div>
    </LegalPage>
  )
}

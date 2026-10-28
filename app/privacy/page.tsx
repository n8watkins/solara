import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'
import styles from '@/components/LegalPolicy.module.css'
import LegalDetail from '@/components/LegalDetail'
import { AnalyticsPreferenceControl } from '@/components/AnalyticsConsent'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'
import { PRIVACY_LAST_UPDATED } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Privacy Policy | Solara',
  description:
    'Who runs Solara, what it collects and why, who processes it, how long it is kept, and your rights.',
}

export default function PrivacyPage() {
  const analyticsEnabled = isAnalyticsMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

  return (
    <LegalPage title="Privacy Policy" updated={PRIVACY_LAST_UPDATED}>
      <div className={styles.policy}>
        <h2>Who runs Solara</h2>
        <p>
          Solara is operated by <LegalDetail name="operatorName" />, the controller of the personal
          information described here.
        </p>
        <p>
          For privacy questions or requests, email <LegalDetail name="contactEmail" />.
        </p>

        <h2>What Solara collects</h2>
        <ul>
          <li>
            <strong>Account details.</strong> When you sign in with Google, Solara receives your
            Firebase account identifier, name, email address and profile image.
          </li>
          <li>
            <strong>Location.</strong> The place you choose for forecasts, stored as a city name and
            coordinates rounded to two decimal places (about 1 km). If you use your device location,
            it is rounded the same way before it is sent anywhere or saved. Solara does not track
            your location in the background.
          </li>
          <li>
            <strong>Preferences.</strong> Skin profile, activities, saved places, calendar planning
            hours, appearance, notification time and other settings.
          </li>
          <li>
            <strong>Google Calendar availability</strong>, only if you connect it: the times you are
            busy, read in your browser for planning and not stored by Solara. Solara never sees
            event titles, descriptions, locations or attendees. If you add a planned activity to
            your calendar, Solara creates that one event on a calendar you own.
          </li>
          <li>
            <strong>Scheduled activities</strong>, for events Solara added to your calendar: the
            event&apos;s identifier, start and end time, time zone, title and link, and which of
            your activities it is for, so Solara can show and manage it on all your devices.
          </li>
          <li>
            <strong>Imported events</strong>, if you import a calendar (.ics) file: each upcoming
            event&apos;s title, start and end time, time zone, location text, link, the place Solara
            forecasts it for (coordinates rounded to two decimal places) and which of your
            activities it counts as. The file is read in your browser; descriptions, organizers and
            attendees in it are never stored or sent anywhere.
          </li>
          <li>
            <strong>Linked calendars</strong>, where offered, if you link a calendar address
            (https:// or webcal://): the address, kept on Solara&apos;s servers and never shown back
            to the app because it can contain a private token; its site name and label; and when it
            was last checked and how that went. Solara&apos;s servers fetch the address every few
            hours from Google Cloud and store its upcoming events like imported ones.
          </li>
          <li>
            <strong>Events from your Google Calendar</strong>, where offered, if you turn this on:
            which of your calendars you chose (each calendar&apos;s identifier and name; your main
            calendar is recorded only as &ldquo;primary&rdquo;) and when they were last read; and,
            for each upcoming event in the next 30 days that has a place or matches one of your
            activities, its title, start and end time, time zone, location text, the place Solara
            forecasts it for and which activity it counts as, stored like imported events. Other
            events, descriptions, attendees, organizers, meeting links and event links are never
            stored, and no Google access token is stored anywhere.
          </li>
          <li>
            <strong>Calendar feed and notifications</strong>, if you turn them on: a private feed
            token and your device&apos;s push notification registration.
          </li>
          <li>
            <strong>Subscription records</strong>, if you subscribe: plan, status and the Stripe
            customer and subscription identifiers. Card details go to Stripe and never reach Solara.
          </li>
          <li>
            <strong>A free-trial record</strong>, if you start the free trial: one-way keyed hashes
            of your sign-in account&apos;s identifier at Google, your verified email address and
            your card&apos;s fingerprint at Stripe, so the trial is given once per person. The
            hashes cannot be turned back into those details.
          </li>
          <li>
            <strong>Optional analytics</strong>, only if you allow it: pages visited (without query
            strings), approximate device and browser details, and feature usage.
          </li>
          <li>
            <strong>Error reports</strong>, when something breaks: the error message and where in
            the code it happened, the page address without its query string, your browser, device
            type, language and time zone, and the app steps just before the error. Email addresses,
            account identifiers, tokens and locations are removed in your browser before a report is
            sent, and no IP address is stored with it.
          </li>
          <li>
            <strong>Technical data.</strong> Hosting and security services process your IP address
            and browser details to deliver pages and prevent abuse.
          </li>
        </ul>

        <h2>How Solara uses Google user data</h2>
        <p>
          Solara asks for Google permissions only for the features below, and only when you use
          them.
        </p>
        <ul>
          <li>
            <strong>Google Sign-In</strong> (<code>openid</code>, <code>email</code>,{' '}
            <code>profile</code>): your Google account identifier, name, email address and profile
            image. Used to create and secure your Solara account and to show who is signed in.
            Stored in Firebase Authentication while your account exists.
          </li>
          <li>
            <strong>Google Calendar free/busy</strong> (<code>calendar.freebusy</code>), only if you
            connect a calendar: the start and end times of your busy periods. Used in your browser
            to schedule lower-UV windows around your commitments. Never stored on Solara&apos;s
            servers and discarded when you close the page. Solara cannot read event titles,
            descriptions, locations or attendees with this permission.
          </li>
          <li>
            <strong>Google Calendar events you create</strong> (<code>calendar.events.owned</code>),
            only when you choose to add a window to your calendar: Solara creates that event on a
            calendar you own and marks it as created by Solara. Solara stores the event&apos;s
            identifier, time, title and link of events it created, so it can show them as scheduled
            and let you open, move or remove them. To keep them up to date, Solara looks up only
            events it created; it does not read, change or delete any other event.
          </li>
          <li>
            <strong>Google Calendar events, read only</strong> (
            <code>calendar.events.readonly</code>, and <code>calendar.calendarlist.readonly</code>{' '}
            only if you choose which calendars to use), where offered and only after you turn on
            &ldquo;Show my Google Calendar events&rdquo;: your browser reads the next 30 days of
            events on the calendars you chose (your main calendar unless you choose others) to show
            the UV during each one. Solara keeps only the events with a place or that match one of
            your activities, and only the fields listed under &ldquo;Events from your Google
            Calendar&rdquo; above; it never changes or deletes any of them. The events are read
            again only while Solara is open. Disconnecting removes the stored events and the list of
            calendars, and ends Solara&apos;s access with Google, which also ends the free/busy and
            event permissions above until you connect again.
          </li>
        </ul>
        <p>
          Solara does not sell Google user data, does not use it for advertising, and does not use
          it to train artificial intelligence or machine learning models. Google user data is not
          shared with anyone except the service providers listed below that run Solara&apos;s
          features, and only as needed for those features. No person at Solara reads your Google
          user data unless you ask for help with it, it is needed for security, or the law requires
          it.
        </p>
        <p>
          You can disconnect Solara from your Google Account at any time in your{' '}
          <a href="https://myaccount.google.com/connections">Google Account connections</a>, which
          stops all further access. Deleting your Solara account removes the Google account details
          Solara stores.
        </p>
        <p>
          Solara&apos;s use and transfer of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>Why it is used, and the legal basis</h2>
        <ul>
          <li>
            <strong>To provide the service you asked for</strong> (performance of a contract):
            forecasts, recommendations, syncing your settings, calendar feeds, notifications and
            subscriptions.
          </li>
          <li>
            <strong>With your consent</strong>: device location, Google Calendar access, push
            notifications and optional analytics. You can withdraw consent at any time, which does
            not affect processing that already happened.
          </li>
          <li>
            <strong>Legitimate interests</strong>: keeping Solara secure, preventing abuse and
            fixing problems, including the error reports above, which is why they do not depend on
            the analytics choice, and the free-trial record, which prevents repeated free trials.
          </li>
          <li>
            <strong>Legal obligations</strong>: keeping payment records for tax and accounting.
          </li>
        </ul>
        <p>Solara does not sell your information or use it for advertising.</p>
        <p>Solara recommendations are planning estimates and are not medical advice.</p>

        <h2>Service providers</h2>
        <p>
          These providers process information on Solara&apos;s behalf or when you use a feature:
        </p>
        <ul>
          <li>
            <strong>Google Firebase</strong> (Google LLC): sign-in, database, hosting, cloud
            functions, push messaging and App Check, which uses Google reCAPTCHA to check that
            requests come from the real app. reCAPTCHA runs only after you sign in; the Google{' '}
            <a href="https://policies.google.com/privacy">Privacy Policy</a> and{' '}
            <a href="https://policies.google.com/terms">Terms of Service</a> apply to it.
          </li>
          <li>
            <strong>Google Calendar API and Google Identity Services</strong>: only when you connect
            a calendar.
          </li>
          <li>
            <strong>Google Analytics</strong>: only after you allow analytics. Google signals and ad
            personalization are turned off.
          </li>
          <li>
            <strong>Open-Meteo</strong>: receives rounded coordinates to return forecasts, and the
            place names you type into a location search, as you type, to suggest matching places.
            When you import events, the town part of each event&apos;s location (such as &quot;Los
            Angeles, CA&quot;) is searched the same way to find where the event is; for a linked
            calendar, Solara&apos;s servers make that search.
          </li>
          <li>
            <strong>OpenStreetMap Nominatim</strong> (OpenStreetMap Foundation): receives rounded
            coordinates when you use your device location, or import an event that gives only
            coordinates, to find the nearest city name.
          </li>
          <li>
            <strong>Stripe</strong>: processes payments when subscriptions are enabled.
          </li>
          <li>
            <strong>Sentry</strong> (Functional Software, Inc.): receives the error reports
            described above, in the United States.
          </li>
        </ul>
        <p>
          Some providers process data in the United States and other countries. Where required,
          transfers rely on the providers&apos; standard contractual clauses or equivalent
          safeguards.
        </p>

        <h2>How long information is kept</h2>
        <ul>
          <li>Account details and preferences: while your account exists.</li>
          <li>
            A guest plan (used without signing in): only in your browser, until you sign in (it then
            moves into your new account, or is removed if the account already existed) or clear your
            browser data.
          </li>
          <li>
            Scheduled activities: until you remove the event or it is deleted in Google Calendar;
            once an event ended more than 30 days ago, Solara deletes its record the next time you
            open the app; and always when you delete your account.
          </li>
          <li>
            Imported events: until you remove them; Firestore deletes each one automatically 30 days
            after it ends, and always when you delete your account.
          </li>
          <li>
            Linked calendars: until you remove the calendar, which also removes its events, and
            always when you delete your account.
          </li>
          <li>
            Events from your Google Calendar: until they are gone from your calendar or you
            disconnect, which removes them and the list of calendars; Firestore deletes each event
            automatically 30 days after it ends, and always when you delete your account.
          </li>
          <li>
            Calendar availability: only in your browser for the current session; never stored by
            Solara.
          </li>
          <li>Push registrations: until you turn notifications off or delete your account.</li>
          <li>
            Pro alert history (which alerts were sent on which day, and whether they arrived): 7
            days, and it is included in your data download.
          </li>
          <li>
            The free-trial record: 2 years after the trial, including after you delete your account,
            to prevent repeated free trials.
          </li>
          <li>
            Payment records: as long as tax and accounting law requires, even after account
            deletion. Stripe keeps its own records under its privacy policy.
          </li>
          <li>Analytics: for the retention period set in Google Analytics, at most 14 months.</li>
          <li>Error reports: 30 days in Sentry.</li>
          <li>Hosting and security logs: for the periods set by Google Cloud.</li>
        </ul>

        <h2>Storage on your device</h2>
        <p>
          Solara keeps your preferences, a cached forecast, your theme, your analytics choice and
          which offers you dismissed in your browser&apos;s local storage so the app works quickly
          and remembers your choices. These are needed for the service and are not used for
          tracking.
        </p>
        <p>
          If you use Solara without signing in, your plan (place, skin type and activity) is kept
          only in this browser and is never sent to Solara. Place search and forecasts still come
          from Open-Meteo and OpenStreetMap as described above.
        </p>
        <p>
          Google Analytics cookies (<code>_ga</code> and <code>_ga_*</code>) are set only after you
          allow analytics and are deleted when you decline.
        </p>
        <AnalyticsPreferenceControl enabled={analyticsEnabled} />

        <h2>Your rights</h2>
        <p>
          Depending on where you live, you can ask to access, correct, export or delete your
          information, object to or restrict processing, and withdraw consent.
        </p>
        <p>
          Use the <a href="/account/">Account data controls</a> page while signed in to download a
          copy of your data or delete your account, or email <LegalDetail name="contactEmail" />.
        </p>
        <p>
          You can disconnect Google Calendar at any time in the Events section or in your{' '}
          <a href="https://myaccount.google.com/connections">Google Account connections</a>, rotate
          or revoke a calendar feed in Settings, and turn notifications off in Settings or your
          browser.
        </p>
        <p>
          Deleting your account removes your Solara preferences, scheduled activities, imported
          events, linked calendars, events from your Google Calendar and the calendars you chose,
          calendar feed and notification registrations, cancels an active Solara subscription and
          deletes your customer record at Stripe (Stripe keeps the payment records the law requires
          it to keep). If you had the free trial, its hashed record is kept for 2 years to prevent
          repeated free trials. Events already in your Google Calendar stay there until you delete
          them.
        </p>
        <p>You also have the right to complain to your local data protection authority.</p>

        <h2>Security</h2>
        <p>
          Solara uses access controls, encrypted connections, a strict content security policy and
          private capability tokens, but no internet service can guarantee absolute security.
        </p>

        <h2>Children</h2>
        <p>
          Solara is not directed to children under 13 (or the higher age required where you live)
          and does not knowingly collect their personal information.
        </p>

        <h2>Changes</h2>
        <p>
          Material changes will be reflected by updating the date on this page and, when
          appropriate, by an in-product notice.
        </p>
      </div>
    </LegalPage>
  )
}

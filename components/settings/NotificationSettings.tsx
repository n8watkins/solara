'use client'
import { useId, useState } from 'react'
import type { User } from 'firebase/auth'
import { NOTIFICATION_HOUR, UV_ALERT_THRESHOLD } from '@solara/core'
import type { TierLevel } from '@/lib/types'
import type { SettingsDraft } from '@/lib/settings'
import { TIER_LIMITS } from '@solara/core/tiers'
import { alertsLaunched, eventHeadsUpsLaunched } from '@/lib/plans'
import { eventHeadsUpSentence } from '@/lib/event-heads-up-copy'
import { installEnvironment, pushNeedsHomeScreen } from '@/lib/install-prompt'
import { isStoreBuild } from '@/lib/store-build'
import { notificationRegistrationConfigured } from '@/lib/notifications'
import { useNotificationToggle } from '@/lib/use-notification-toggle'
import { useUnits } from '@/lib/use-units'
import {
  FIELD_CONTROL,
  SettingsCard,
  SettingsError,
  SettingsField,
  SettingsHint,
  SettingsTitle,
} from './SettingsCard'

const MORNING_HOURS = Array.from(
  { length: NOTIFICATION_HOUR.max - NOTIFICATION_HOUR.min + 1 },
  (_, i) => NOTIFICATION_HOUR.min + i,
)
/** Below 3 the UV needs no protection (WHO), so the choices start there. */
const UV_THRESHOLDS = Array.from({ length: UV_ALERT_THRESHOLD.max - 2 }, (_, i) => i + 3)
const DAY_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

export type AlertDraft = Pick<
  SettingsDraft,
  'notificationHour' | 'uvAlertThreshold' | 'quietHours' | 'eventHeadsUp' | 'dailyUv'
>

interface Props {
  tier: TierLevel
  user?: User | null
  draft: AlertDraft
  onChange: (patch: Partial<AlertDraft>) => void
  /** Whether the account joined the Pro waitlist (the plans button says so). */
  waitlisted?: boolean
  /** Opens the plans dialog, from the offer Free sees. */
  onSeePlans?: () => void
}

const TITLE = 'Morning and UV alerts'
/**
 * What the alerts are; with linked calendars or Google Calendar on, the event heads-ups
 * too (REVIEW5 L6, REVIEW6 L1).
 */
function what(): string {
  return eventHeadsUpsLaunched()
    ? 'A morning summary of your UV day, and a heads-up when the UV gets high and before your outdoor events.'
    : 'A morning summary of your UV day, and a heads-up when the UV gets high.'
}

/**
 * The alerts tab: Pro's push alerts with the account's alert settings and this device's
 * subscription; for a Free account once alerts are on, the free daily UV push and the
 * reapply reminder's push, with Pro's alerts offered below.
 */
export default function NotificationSettings({
  tier,
  user,
  draft,
  onChange,
  waitlisted = false,
  onSeePlans,
}: Props) {
  const included = TIER_LIMITS[tier].notifications
  if (alertsLaunched() && !included && TIER_LIMITS[tier].dailyUvPush) {
    return (
      <div className="flex flex-col gap-3">
        <FreeAlertControls user={user} draft={draft} onChange={onChange} />
        <ProAlertsOffer included={false} waitlisted={waitlisted} onSeePlans={onSeePlans} />
      </div>
    )
  }
  if (!alertsLaunched() || !included) {
    return <ProAlertsOffer included={included} waitlisted={waitlisted} onSeePlans={onSeePlans} />
  }
  return <AlertControls user={user} draft={draft} onChange={onChange} />
}

/** Pro's alerts, offered (or coming soon) where they are not on. */
function ProAlertsOffer({
  included,
  waitlisted,
  onSeePlans,
}: {
  included: boolean
  waitlisted: boolean
  onSeePlans?: () => void
}) {
  // An app store build names no plan to buy (lib/store-build.ts, REVIEW9 QA L5).
  const store = isStoreBuild()
  const when = alertsLaunched()
    ? store
      ? 'Included with a Pro account.'
      : 'Included with Pro.'
    : store
      ? 'Coming soon.'
      : 'Coming soon with Pro.'
  return (
    <SettingsCard className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3.5">
        <SettingsTitle>{TITLE}</SettingsTitle>
        {!included && !store && (
          <span className="text-[11px] font-bold tracking-[0.05em] whitespace-nowrap text-accent uppercase">
            Pro
          </span>
        )}
      </div>
      <SettingsHint className="leading-[1.45]">
        {what()} {when}
      </SettingsHint>
      {/* Like every other Pro offer, it has a way to Pro (REVIEW6 L7). */}
      {!included && onSeePlans && (
        <button
          type="button"
          className="btn btn-primary mt-1.5 self-start text-[12px] whitespace-nowrap"
          onClick={onSeePlans}
        >
          {waitlisted ? '✓ On waitlist' : 'See Pro plans'}
        </button>
      )}
    </SettingsCard>
  )
}

const FREE_TITLE = 'Daily UV and sunscreen reminders'

/**
 * A Free account's pushes (core daily-uv.ts, reapply.ts): the daily UV push at the
 * morning hour, outside quiet hours, and the sunscreen timer's reminder with Solara
 * closed, both to the devices turned on here.
 */
function FreeAlertControls({ user, draft, onChange }: Omit<Props, 'tier'>) {
  const id = useId()
  return (
    <SettingsCard className="flex flex-col gap-4">
      <div>
        <SettingsTitle className="mb-1">{FREE_TITLE}</SettingsTitle>
        <SettingsHint className="leading-[1.45]">
          When the UV needs sun protection, a morning push with the times and the peak. And your
          sunscreen timer&rsquo;s reminder, even with Solara closed. Free with your account, on the
          devices you turn them on for.
        </SettingsHint>
      </div>

      <DeviceRow user={user} />

      <SettingsField>
        <div>
          <SettingsTitle className="mb-1">
            <label htmlFor={`${id}-daily`}>Daily UV</label>
          </SettingsTitle>
          <SettingsHint id={`${id}-daily-desc`} className="leading-[1.45]">
            Only on days the UV reaches moderate or higher, or would under a clear sky.
          </SettingsHint>
        </div>
        <select
          id={`${id}-daily`}
          aria-describedby={`${id}-daily-desc`}
          value={draft.dailyUv ? 'on' : 'off'}
          onChange={event => onChange({ dailyUv: event.target.value === 'on' })}
          className={FIELD_CONTROL}
        >
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </SettingsField>

      {draft.dailyUv && (
        <MorningHourField
          label="Daily UV at"
          hint="In your local time, or when your quiet hours end."
          draft={draft}
          onChange={onChange}
        />
      )}

      <QuietHoursField
        hint="The daily UV waits until they end. Sunscreen reminders come when they are due."
        draft={draft}
        onChange={onChange}
      />
    </SettingsCard>
  )
}

/** The hour of the morning push: Pro's morning plan, or Free's daily UV. */
function MorningHourField({
  label,
  hint,
  draft,
  onChange,
}: {
  label: string
  hint: string
  draft: AlertDraft
  onChange: (patch: Partial<AlertDraft>) => void
}) {
  const id = useId()
  const units = useUnits()
  return (
    <SettingsField>
      <div>
        <SettingsTitle className="mb-1">
          <label htmlFor={`${id}-morning`}>{label}</label>
        </SettingsTitle>
        <SettingsHint id={`${id}-morning-desc`} className="leading-[1.45]">
          {hint}
        </SettingsHint>
      </div>
      <select
        id={`${id}-morning`}
        aria-describedby={`${id}-morning-desc`}
        value={draft.notificationHour}
        onChange={event => onChange({ notificationHour: Number(event.target.value) })}
        className={FIELD_CONTROL}
      >
        {MORNING_HOURS.map(hour => (
          <option key={hour} value={hour}>
            {units.hour(hour)}
          </option>
        ))}
      </select>
    </SettingsField>
  )
}

/** Quiet hours: when the pushes that can wait do wait. */
function QuietHoursField({
  hint,
  draft,
  onChange,
}: {
  hint: string
  draft: AlertDraft
  onChange: (patch: Partial<AlertDraft>) => void
}) {
  const id = useId()
  const units = useUnits()
  const quietId = `${id}-quiet`
  return (
    <SettingsField role="group" aria-labelledby={`${quietId}-title`}>
      <div>
        <SettingsTitle id={`${quietId}-title`} className="mb-1">
          Quiet hours
        </SettingsTitle>
        <SettingsHint className="leading-[1.45]">{hint}</SettingsHint>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          aria-label="Quiet from"
          value={draft.quietHours.from}
          onChange={event =>
            onChange({ quietHours: { ...draft.quietHours, from: Number(event.target.value) } })
          }
          className="w-24 text-[14px] max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
        >
          {DAY_HOURS.map(hour => (
            <option key={hour} value={hour}>
              {units.hour(hour)}
            </option>
          ))}
        </select>
        <span className="text-[13px] text-ink-3" aria-hidden="true">
          to
        </span>
        <select
          aria-label="Quiet until"
          value={draft.quietHours.to}
          onChange={event =>
            onChange({ quietHours: { ...draft.quietHours, to: Number(event.target.value) } })
          }
          className="w-24 text-[14px] max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
        >
          {DAY_HOURS.map(hour => (
            <option key={hour} value={hour}>
              {units.hour(hour)}
            </option>
          ))}
        </select>
      </div>
    </SettingsField>
  )
}

function AlertControls({ user, draft, onChange }: Omit<Props, 'tier'>) {
  const id = useId()

  return (
    <SettingsCard className="flex flex-col gap-4">
      <div>
        <SettingsTitle className="mb-1">{TITLE}</SettingsTitle>
        <SettingsHint className="leading-[1.45]">
          {what()} They reach the devices you turn them on for, as does your sunscreen timer&rsquo;s
          reminder, even with Solara closed.
        </SettingsHint>
      </div>

      <DeviceRow user={user} />

      <MorningHourField
        label="Morning alert"
        hint="Today’s peak UV and your best window, in your local time."
        draft={draft}
        onChange={onChange}
      />

      <SettingsField>
        <div>
          <SettingsTitle className="mb-1">
            <label htmlFor={`${id}-uv`}>UV alert</label>
          </SettingsTitle>
          <SettingsHint id={`${id}-uv-desc`} className="leading-[1.45]">
            Once a day, about an hour before the forecast UV reaches this level.
          </SettingsHint>
        </div>
        <select
          id={`${id}-uv`}
          aria-describedby={`${id}-uv-desc`}
          value={draft.uvAlertThreshold}
          onChange={event => onChange({ uvAlertThreshold: Number(event.target.value) })}
          className={FIELD_CONTROL}
        >
          <option value={UV_ALERT_THRESHOLD.off}>Off</option>
          {UV_THRESHOLDS.map(uv => (
            <option key={uv} value={uv}>
              UV {uv} or higher
            </option>
          ))}
        </select>
      </SettingsField>

      {eventHeadsUpsLaunched() && (
        <SettingsField>
          <div>
            <SettingsTitle className="mb-1">
              <label htmlFor={`${id}-events`}>Event heads-up</label>
            </SettingsTitle>
            <SettingsHint id={`${id}-events-desc`} className="leading-[1.45]">
              {eventHeadsUpSentence()}
            </SettingsHint>
          </div>
          <select
            id={`${id}-events`}
            aria-describedby={`${id}-events-desc`}
            value={draft.eventHeadsUp ? 'on' : 'off'}
            onChange={event => onChange({ eventHeadsUp: event.target.value === 'on' })}
            className={FIELD_CONTROL}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingsField>
      )}

      <QuietHoursField
        hint={`The UV alert waits until they end. ${
          eventHeadsUpsLaunched()
            ? 'An event heads-up that would fall in them comes the evening before. '
            : ''
        }The morning alert comes at its own hour.`}
        draft={draft}
        onChange={onChange}
      />
    </SettingsCard>
  )
}

/** Whether this device receives the alerts, and the way to change that. */
function DeviceRow({ user }: { user?: User | null }) {
  const { status, loading, error, enable, disable } = useNotificationToggle(user)
  // Settings renders only in the browser, so the environment is read once on mount.
  const [homeScreenFirst] = useState(() => pushNeedsHomeScreen(installEnvironment()))
  const configured = notificationRegistrationConfigured()

  let body
  if (status === 'enabled') {
    body = (
      <>
        <p className="text-[13px] font-semibold text-accent">On for this device</p>
        <button
          type="button"
          className="btn self-start"
          onClick={() => void disable()}
          disabled={loading}
        >
          {loading ? 'Turning off...' : 'Turn off on this device'}
        </button>
      </>
    )
  } else if (homeScreenFirst) {
    body = (
      <SettingsHint className="leading-[1.45]">
        On iPhone and iPad, alerts need Solara on your Home Screen: tap Share, then Add to Home
        Screen, open Solara from there and turn alerts on.
      </SettingsHint>
    )
  } else if (status === 'blocked') {
    body = (
      <SettingsHint className="leading-[1.45]">
        Notifications are blocked for this site. Allow them in your browser settings to get alerts
        here.
      </SettingsHint>
    )
  } else {
    body = (
      <>
        <SettingsHint className="leading-[1.45]">Off for this device.</SettingsHint>
        <button
          type="button"
          className="btn btn-primary self-start whitespace-nowrap"
          onClick={() => void enable()}
          disabled={loading || !configured}
        >
          {loading
            ? 'Turning on...'
            : configured
              ? 'Turn on for this device'
              : 'Alerts unavailable here'}
        </button>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5">
      {body}
      {error && <SettingsError>{error}</SettingsError>}
    </div>
  )
}

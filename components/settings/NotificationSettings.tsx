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
import m from '@/messages/settings'

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

/**
 * What the alerts are; with linked calendars or Google Calendar on, the event heads-ups
 * too (REVIEW5 L6, REVIEW6 L1).
 */
function what(): string {
  return eventHeadsUpsLaunched() ? m.alertsWhatEvents : m.alertsWhat
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
      ? m.includedWithProAccount
      : m.includedWithPro
    : store
      ? m.comingSoon
      : m.comingSoonWithPro
  return (
    <SettingsCard className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3.5">
        <SettingsTitle>{m.alertsTitle}</SettingsTitle>
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
          {waitlisted ? m.onWaitlist : m.seeProPlans}
        </button>
      )}
    </SettingsCard>
  )
}

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
        <SettingsTitle className="mb-1">{m.freeAlertsTitle}</SettingsTitle>
        <SettingsHint className="leading-[1.45]">{m.freeAlertsHint}</SettingsHint>
      </div>

      <DeviceRow user={user} />

      <SettingsField>
        <div>
          <SettingsTitle className="mb-1">
            <label htmlFor={`${id}-daily`}>{m.dailyUv}</label>
          </SettingsTitle>
          <SettingsHint id={`${id}-daily-desc`} className="leading-[1.45]">
            {m.dailyUvHint}
          </SettingsHint>
        </div>
        <select
          id={`${id}-daily`}
          aria-describedby={`${id}-daily-desc`}
          value={draft.dailyUv ? 'on' : 'off'}
          onChange={event => onChange({ dailyUv: event.target.value === 'on' })}
          className={FIELD_CONTROL}
        >
          <option value="on">{m.on}</option>
          <option value="off">{m.off}</option>
        </select>
      </SettingsField>

      {draft.dailyUv && (
        <MorningHourField
          label={m.dailyUvAt}
          hint={m.dailyUvAtHint}
          draft={draft}
          onChange={onChange}
        />
      )}

      <QuietHoursField hint={m.quietHintFree} draft={draft} onChange={onChange} />
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
          {m.quietHours}
        </SettingsTitle>
        <SettingsHint className="leading-[1.45]">{hint}</SettingsHint>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          aria-label={m.quietFrom}
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
          {m.quietTo}
        </span>
        <select
          aria-label={m.quietUntil}
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
        <SettingsTitle className="mb-1">{m.alertsTitle}</SettingsTitle>
        <SettingsHint className="leading-[1.45]">
          {what()} {m.alertsReach}
        </SettingsHint>
      </div>

      <DeviceRow user={user} />

      <MorningHourField
        label={m.morningAlert}
        hint={m.morningAlertHint}
        draft={draft}
        onChange={onChange}
      />

      <SettingsField>
        <div>
          <SettingsTitle className="mb-1">
            <label htmlFor={`${id}-uv`}>{m.uvAlert}</label>
          </SettingsTitle>
          <SettingsHint id={`${id}-uv-desc`} className="leading-[1.45]">
            {m.uvAlertHint}
          </SettingsHint>
        </div>
        <select
          id={`${id}-uv`}
          aria-describedby={`${id}-uv-desc`}
          value={draft.uvAlertThreshold}
          onChange={event => onChange({ uvAlertThreshold: Number(event.target.value) })}
          className={FIELD_CONTROL}
        >
          <option value={UV_ALERT_THRESHOLD.off}>{m.off}</option>
          {UV_THRESHOLDS.map(uv => (
            <option key={uv} value={uv}>
              {m.uvOrHigher(uv)}
            </option>
          ))}
        </select>
      </SettingsField>

      {eventHeadsUpsLaunched() && (
        <SettingsField>
          <div>
            <SettingsTitle className="mb-1">
              <label htmlFor={`${id}-events`}>{m.eventHeadsUp}</label>
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
            <option value="on">{m.on}</option>
            <option value="off">{m.off}</option>
          </select>
        </SettingsField>
      )}

      <QuietHoursField
        hint={eventHeadsUpsLaunched() ? m.quietHintProEvents : m.quietHintPro}
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
        <p className="text-[13px] font-semibold text-accent">{m.onForDevice}</p>
        <button
          type="button"
          className="btn self-start"
          onClick={() => void disable()}
          disabled={loading}
        >
          {loading ? m.turningOff : m.turnOff}
        </button>
      </>
    )
  } else if (homeScreenFirst) {
    body = <SettingsHint className="leading-[1.45]">{m.iosHomeScreen}</SettingsHint>
  } else if (status === 'blocked') {
    body = <SettingsHint className="leading-[1.45]">{m.notificationsBlocked}</SettingsHint>
  } else {
    body = (
      <>
        <SettingsHint className="leading-[1.45]">{m.offForDevice}</SettingsHint>
        <button
          type="button"
          className="btn btn-primary self-start whitespace-nowrap"
          onClick={() => void enable()}
          disabled={loading || !configured}
        >
          {loading ? m.turningOn : configured ? m.turnOn : m.alertsUnavailable}
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

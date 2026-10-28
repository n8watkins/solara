'use client'
import { useId, useState } from 'react'
import type { User } from 'firebase/auth'
import { NOTIFICATION_HOUR, UV_ALERT_THRESHOLD } from '@solara/core'
import type { TierLevel } from '@/lib/types'
import type { SettingsDraft } from '@/lib/settings'
import { TIER_LIMITS } from '@/lib/tiers'
import { alertsLaunched, eventSubscriptionsLaunched } from '@/lib/plans'
import { installEnvironment, pushNeedsHomeScreen } from '@/lib/install-prompt'
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
  'notificationHour' | 'uvAlertThreshold' | 'quietHours' | 'eventHeadsUp'
>

interface Props {
  tier: TierLevel
  user?: User | null
  draft: AlertDraft
  onChange: (patch: Partial<AlertDraft>) => void
}

const TITLE = 'Morning and UV alerts'
const WHAT = 'A morning summary of your UV day, and a heads-up when the UV gets high.'

/** Pro's push alerts: the account's alert settings and this device's subscription. */
export default function NotificationSettings({ tier, user, draft, onChange }: Props) {
  const included = TIER_LIMITS[tier].notifications
  if (!alertsLaunched() || !included) {
    return (
      <SettingsCard className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3.5">
          <SettingsTitle>{TITLE}</SettingsTitle>
          {!included && (
            <span className="text-[11px] font-bold tracking-[0.05em] whitespace-nowrap text-accent uppercase">
              Pro
            </span>
          )}
        </div>
        <SettingsHint className="leading-[1.45]">
          {WHAT} {alertsLaunched() ? 'Included with Pro.' : 'Coming soon with Pro.'}
        </SettingsHint>
      </SettingsCard>
    )
  }
  return <AlertControls user={user} draft={draft} onChange={onChange} />
}

function AlertControls({ user, draft, onChange }: Omit<Props, 'tier'>) {
  const id = useId()
  const units = useUnits()
  const quietId = `${id}-quiet`

  return (
    <SettingsCard className="flex flex-col gap-4">
      <div>
        <SettingsTitle className="mb-1">{TITLE}</SettingsTitle>
        <SettingsHint className="leading-[1.45]">
          {WHAT} They reach the devices you turn them on for.
        </SettingsHint>
      </div>

      <DeviceRow user={user} />

      <SettingsField>
        <div>
          <SettingsTitle className="mb-1">
            <label htmlFor={`${id}-morning`}>Morning alert</label>
          </SettingsTitle>
          <SettingsHint id={`${id}-morning-desc`} className="leading-[1.45]">
            Today&rsquo;s peak UV and your best window, in your local time.
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

      {eventSubscriptionsLaunched() && (
        <SettingsField>
          <div>
            <SettingsTitle className="mb-1">
              <label htmlFor={`${id}-events`}>Event heads-up</label>
            </SettingsTitle>
            <SettingsHint id={`${id}-events-desc`} className="leading-[1.45]">
              About 3 hours before an imported or linked event with UV 6 or higher.
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

      <SettingsField role="group" aria-labelledby={`${quietId}-title`}>
        <div>
          <SettingsTitle id={`${quietId}-title`} className="mb-1">
            Quiet hours
          </SettingsTitle>
          <SettingsHint className="leading-[1.45]">
            {eventSubscriptionsLaunched()
              ? 'The UV alert and event heads-ups wait until they end.'
              : 'The UV alert waits until they end.'}{' '}
            The morning alert comes at its own hour.
          </SettingsHint>
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

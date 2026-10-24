'use client'
import type { User } from 'firebase/auth'
import type { TierLevel } from '@/lib/types'
import { TIER_LIMITS } from '@/lib/tiers'
import { notificationRegistrationConfigured } from '@/lib/notifications'
import { useNotificationToggle } from '@/lib/use-notification-toggle'
import { SettingsCard, SettingsError, SettingsHint } from './SettingsCard'

const DELIVERY_HOURS = [5, 6, 7, 8, 9, 10]

interface Props {
  tier: TierLevel
  user?: User | null
  hour: number
  onHourChange: (hour: number) => void
}

/** Morning sun alerts for this device. Sending is paused for every plan for now. */
export default function NotificationSettings({ tier, user, hour, onHourChange }: Props) {
  const { status, loading, error, enable, disable } = useNotificationToggle(user)
  const included = TIER_LIMITS[tier].notifications
  const configured = notificationRegistrationConfigured()

  return (
    <SettingsCard className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3.5">
        <div>
          <p className="mb-1 text-[13px] font-bold text-ink">🔔 Morning sun alerts (paused)</p>
          <SettingsHint className="leading-[1.45]">
            Morning summaries are paused and not being sent right now.
          </SettingsHint>
        </div>
        {!included && (
          <span className="text-[11px] font-bold tracking-[0.05em] whitespace-nowrap text-accent uppercase">
            Pro
          </span>
        )}
      </div>

      {!included ? (
        <SettingsHint className="leading-[1.45]">Paused for all plans right now.</SettingsHint>
      ) : status === 'enabled' ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] font-semibold text-accent">
            ✓ On for this device once summaries resume
          </p>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Local delivery time
            <select value={hour} onChange={event => onHourChange(Number(event.target.value))}>
              {DELIVERY_HOURS.map(h => (
                <option key={h} value={h}>
                  {h}:00 AM
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn self-start"
            onClick={() => void disable()}
            disabled={loading}
          >
            {loading ? 'Turning off...' : 'Turn off on this device'}
          </button>
        </div>
      ) : status === 'blocked' ? (
        <SettingsHint className="leading-[1.45]">
          Notifications are blocked. Enable them in your browser settings.
        </SettingsHint>
      ) : (
        <button
          type="button"
          className="btn btn-primary self-start whitespace-nowrap"
          onClick={() => void enable()}
          disabled={loading || !configured}
        >
          {loading
            ? 'Enabling...'
            : configured
              ? 'Enable notifications'
              : 'Notifications unavailable'}
        </button>
      )}

      {error && <SettingsError>{error}</SettingsError>}
    </SettingsCard>
  )
}

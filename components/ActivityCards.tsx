'use client'
import { useState } from 'react'
import { Activity, ActivityWindow, SafeActivityWindow, TierLevel, Location } from '@/lib/types'
import { fmtHour, gcalLink } from '@/lib/weather'
import { canUseCalendar, effectiveMaxUV } from '@/lib/tiers'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'

interface Props {
  windows: ActivityWindow[]
  daysFromNow: number
  tier: TierLevel
  location: Location
  dateLabel: string
  onEditActivity?: (activity: Activity) => void
}

function Row({ label, val, accent }: { label: string; val: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: accent || 'var(--text)', fontWeight: 500 }}>{val}</span>
    </div>
  )
}

function WindowPill({ win, isBest, onShare, onCalendar }: { win: SafeActivityWindow; isBest: boolean; onShare: () => void; onCalendar?: () => void }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      minWidth: '124px',
      padding: '8px 9px',
      borderRadius: '10px',
      border: isBest ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
      background: isBest ? 'rgba(249,115,22,0.08)' : 'var(--bg-metric)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 750, color: isBest ? 'var(--accent)' : 'var(--text-2)' }}>
          {isBest ? 'Best' : win.label}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
          {fmtHour(win.from)}–{fmtHour(win.to)}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
          Peak UV {win.peakUV.toFixed(1)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '5px' }}>
        <button className="btn" onClick={onShare} style={{ flex: 1, padding: '5px 6px', fontSize: '11px' }}>Share</button>
        {onCalendar && <button className="btn" onClick={onCalendar} style={{ flex: 1, padding: '5px 6px', fontSize: '11px' }}>Cal</button>}
      </div>
    </div>
  )
}

export default function ActivityCards({ windows, daysFromNow, tier, location, dateLabel, onEditActivity }: Props) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const calendarAllowed = canUseCalendar(tier)

  function openCalendar(activityName: string, selectedWindow: { from: number; to: number }, durationMins: number) {
    const opened = window.open(gcalLink(activityName, selectedWindow, durationMins, daysFromNow), '_blank')
    setConfirm(opened ? 'Opened Google Calendar.' : 'Pop-up blocked. Allow pop-ups or try again.')
    window.setTimeout(() => setConfirm(null), 3500)
  }

  async function shareWindow(activity: Activity, selectedWindow: SafeActivityWindow) {
    const payload = { activity, window: selectedWindow, location, dateLabel, dayOffset: daysFromNow }
    const text = buildActivityShareText(payload)
    const url = buildActivityShareUrl(payload, typeof window !== 'undefined' ? window.location.origin : undefined)
    try {
      const result = await shareOrCopy(`${activity.name} sun window`, text, url)
      setConfirm(result === 'shared' ? 'Shared activity window.' : result === 'copied' ? 'Copied share text and link.' : `${text} ${url}`)
    } catch {
      setConfirm(null)
    }
    window.setTimeout(() => setConfirm(null), 4500)
  }

  return (
    <div>
      {confirm && <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--accent)', textAlign: 'right' }}>{confirm}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px' }}>
        {windows.map(({ activity, bestWindow, allWindows, safeNow, pctDaySafe, burnMins }) => {
          const status = safeNow ? 'safe' : bestWindow ? 'caution' : 'avoid'
          const durationLabel = activity.durationMins < 60
            ? `${activity.durationMins}m`
            : `${activity.durationMins / 60}h`
          const windowLabel = bestWindow
            ? `${fmtHour(bestWindow.from)}–${fmtHour(bestWindow.to)}`
            : 'None today'
          const safeUv = effectiveMaxUV(activity)

          return (
            <div key={activity.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>{activity.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', flex: 1 }}>{activity.name}</span>
                <span className={`badge badge-${status}`}>
                  {status === 'safe' ? 'Safe now' : status === 'caution' ? 'Later' : 'Avoid'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Row label={activity.sunscreen ? 'Safe UV w/ SPF' : 'Max safe UV'} val={String(safeUv)} />
                <Row label="Duration" val={durationLabel} />
                {activity.preferredHours && <Row label="Preferred" val={`${fmtHour(activity.preferredHours.from)}–${fmtHour(activity.preferredHours.to)}`} />}
                {burnMins !== null && burnMins !== undefined && (
                  <Row label="Threshold burn est." val={`~${burnMins}m`} />
                )}
                <Row
                  label="Best window"
                  val={windowLabel}
                  accent={bestWindow ? '#16A34A' : '#DC2626'}
                />
              </div>

              <div>
                <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border-md)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '2px', width: `${pctDaySafe}%`,
                    background: pctDaySafe >= 60 ? '#16A34A' : pctDaySafe >= 30 ? '#D97706' : '#DC2626',
                  }} />
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>{pctDaySafe}% of visible day matches</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.055em' }}>
                  Safe windows
                </p>
                {allWindows.length > 0 ? (
                  <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', paddingBottom: '2px' }}>
                    {allWindows.map(win => {
                      const isBest = !!bestWindow && win.from === bestWindow.from && win.to === bestWindow.to
                      return (
                        <WindowPill
                          key={`${win.from}-${win.to}`}
                          win={win}
                          isBest={isBest}
                          onShare={() => shareWindow(activity, win)}
                          onCalendar={calendarAllowed ? () => openCalendar(activity.name, win, activity.durationMins) : undefined}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                    No window is long enough for this activity today. Try shortening duration, widening preferred hours, or raising the safe UV threshold.
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
                {onEditActivity && (
                  <button
                    className="btn"
                    onClick={() => onEditActivity(activity)}
                    style={{ justifyContent: 'center', fontSize: '12px', flex: bestWindow ? '0 0 auto' : 1 }}
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

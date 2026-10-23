'use client'
import { useState } from 'react'
import type {
  Activity,
  ActivityWindow,
  SafeActivityWindow,
  TierLevel,
  Location,
  HourlyForecast,
} from '@/lib/types'
import { fmtHour, fmtClock, fmtDays, gcalLink } from '@/lib/weather'
import { canUseCalendar, effectiveMaxUV } from '@/lib/tiers'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import type { BusyInterval, SlotRecommendation } from '@/lib/scheduler'
import { recommendSlot } from '@/lib/scheduler'

interface Props {
  windows: ActivityWindow[]
  daysFromNow: number
  tier: TierLevel
  location: Location
  dateLabel: string
  hourly?: HourlyForecast[]
  busy?: BusyInterval[]
  /** When provided (calendar connected), books the recommended slot as a real event. */
  onBookRecommended?: (activity: Activity, rec: SlotRecommendation) => void
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

/** Time-of-day cue so a 6–10am window reads differently from a 5–9pm one at a glance. */
function dayPhase(win: SafeActivityWindow): { icon: string; label: string } {
  const mid = (win.from + win.to) / 2
  if (mid < 12) return { icon: '🌅', label: 'Morning' }
  if (mid < 16) return { icon: '☀️', label: 'Midday' }
  return { icon: '🌇', label: 'Evening' }
}

function WindowRow({
  win,
  isBest,
  cloudNote,
  onShare,
  onCalendar,
}: {
  win: SafeActivityWindow
  isBest: boolean
  cloudNote?: boolean
  onShare: () => void
  onCalendar?: () => void
}) {
  const phase = dayPhase(win)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        borderRadius: '10px',
        border: isBest ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
        background: isBest ? 'rgba(249,115,22,0.08)' : 'var(--bg-metric)',
      }}
    >
      <span title={phase.label} style={{ fontSize: '17px', flexShrink: 0 }}>
        {phase.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            {fmtHour(win.from)}–{fmtHour(win.to)}
          </span>
          {isBest && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 750,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Best
            </span>
          )}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
          {phase.label} · Peak UV {win.peakUV.toFixed(1)}
          {cloudNote ? ' · ☁ qualifies with cloud estimate' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
        <button className="btn" onClick={onShare} style={{ padding: '5px 9px', fontSize: '11px' }}>
          Share
        </button>
        {onCalendar && (
          <button
            className="btn"
            onClick={onCalendar}
            style={{ padding: '5px 9px', fontSize: '11px' }}
          >
            Cal
          </button>
        )}
      </div>
    </div>
  )
}

export default function ActivityCards({
  windows,
  daysFromNow,
  tier,
  location,
  dateLabel,
  hourly,
  busy = [],
  onBookRecommended,
  onEditActivity,
}: Props) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const calendarAllowed = canUseCalendar(tier)
  // For today, don't recommend a start time that's already passed (fractional so
  // 9:45 doesn't surface a 9:00 start).
  const now = new Date()
  const nowHour = daysFromNow === 0 ? now.getHours() + now.getMinutes() / 60 : -1

  function openCalendar(
    activityName: string,
    selectedWindow: { from: number; to: number },
    durationMins: number,
  ) {
    const opened = window.open(
      gcalLink(activityName, selectedWindow, durationMins, daysFromNow),
      '_blank',
    )
    setConfirm(opened ? 'Opened Google Calendar.' : 'Pop-up blocked. Allow pop-ups or try again.')
    window.setTimeout(() => setConfirm(null), 3500)
  }

  async function shareWindow(activity: Activity, selectedWindow: SafeActivityWindow) {
    const payload = {
      activity,
      window: selectedWindow,
      location,
      dateLabel,
      dayOffset: daysFromNow,
    }
    const text = buildActivityShareText(payload)
    const url = buildActivityShareUrl(
      payload,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    )
    try {
      const result = await shareOrCopy(`${activity.name} sun window`, text, url)
      const msg =
        result === 'shared'
          ? 'Shared activity window.'
          : result === 'copied'
            ? 'Copied share text and link.'
            : 'Sharing not supported — copy the link manually.'
      setConfirm(msg)
      setTimeout(() => setConfirm(null), 4500)
    } catch {
      // AbortError: user dismissed the share sheet — no feedback needed
    }
  }

  return (
    <div>
      {confirm && (
        <p
          style={{
            margin: '0 0 12px',
            fontSize: '12px',
            color: 'var(--accent)',
            textAlign: 'right',
          }}
        >
          {confirm}
        </p>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '10px',
        }}
      >
        {windows.map(({ activity, bestWindow, allWindows, safeNow, pctDaySafe, burnMins }) => {
          const status = safeNow ? 'safe' : bestWindow ? 'caution' : 'avoid'
          const durationLabel =
            activity.durationMins < 60
              ? `${activity.durationMins}m`
              : `${activity.durationMins / 60}h`
          const windowLabel = bestWindow
            ? `${fmtHour(bestWindow.from)}–${fmtHour(bestWindow.to)}`
            : 'None today'
          const safeUv = effectiveMaxUV(activity)
          const rec = recommendSlot(
            allWindows,
            busy,
            activity.durationMins,
            activity.timePreference ?? 'earliest',
            nowHour,
            hourly,
          )

          return (
            <div
              key={activity.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>{activity.icon}</span>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--text)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activity.name}
                </span>
                <span className={`badge badge-${status}`} style={{ flexShrink: 0 }}>
                  {status === 'safe' ? 'Within limit' : status === 'caution' ? 'Later' : 'No match'}
                </span>
                {onEditActivity && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => onEditActivity(activity)}
                    aria-label={`Edit ${activity.name}`}
                    title="Edit activity"
                    style={{
                      marginLeft: 'auto',
                      padding: '4px 8px',
                      fontSize: '13px',
                      flexShrink: 0,
                    }}
                  >
                    ✎
                  </button>
                )}
              </div>

              {rec && (
                <div
                  style={{
                    borderRadius: '9px',
                    background: 'rgba(249,115,22,0.07)',
                    border: '0.5px solid rgba(249,115,22,0.25)',
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 750,
                        color: 'var(--accent)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Recommended
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
                      {rec.windowLabel}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '3px 0 0',
                      fontSize: '15px',
                      fontWeight: 750,
                      color: 'var(--text)',
                    }}
                  >
                    {fmtClock(rec.start)}–{fmtClock(rec.end)}
                  </p>
                  <p
                    style={{
                      margin: '2px 0 0',
                      fontSize: '11px',
                      color: 'var(--text-3)',
                      lineHeight: 1.4,
                    }}
                  >
                    {rec.reason}
                    {rec.latestStart > rec.earliestStart
                      ? `. Could start anytime ${fmtClock(rec.earliestStart)}–${fmtClock(rec.latestStart)}`
                      : ''}
                    .
                  </p>
                  {calendarAllowed && (
                    <button
                      className="btn"
                      onClick={() =>
                        onBookRecommended
                          ? onBookRecommended(activity, rec)
                          : openCalendar(
                              activity.name,
                              { from: rec.start, to: rec.end },
                              activity.durationMins,
                            )
                      }
                      style={{
                        marginTop: '8px',
                        width: '100%',
                        justifyContent: 'center',
                        fontSize: '12px',
                      }}
                    >
                      📅 {onBookRecommended ? 'Book this time' : 'Add to Calendar'}
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Row
                  label={activity.sunscreen ? 'UV limit w/ SPF' : 'Planning UV limit'}
                  val={String(safeUv)}
                />
                <Row label="Duration" val={durationLabel} />
                {activity.preferredHours && (
                  <Row
                    label="Preferred"
                    val={`${fmtHour(activity.preferredHours.from)}–${fmtHour(activity.preferredHours.to)}`}
                  />
                )}
                {fmtDays(activity.daysOfWeek) && (
                  <Row label="Days" val={fmtDays(activity.daysOfWeek)!} />
                )}
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
                <div
                  style={{
                    height: '4px',
                    borderRadius: '2px',
                    background: 'var(--border-md)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: '2px',
                      width: `${pctDaySafe}%`,
                      background:
                        pctDaySafe >= 60 ? '#16A34A' : pctDaySafe >= 30 ? '#D97706' : '#DC2626',
                    }}
                  />
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
                  {pctDaySafe}% of visible day matches
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '11px',
                    color: 'var(--text-3)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.055em',
                  }}
                >
                  Estimated lower-UV windows
                </p>
                {allWindows.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {allWindows.map(win => {
                      const isBest =
                        !!bestWindow && win.from === bestWindow.from && win.to === bestWindow.to
                      return (
                        <WindowRow
                          key={`${win.from}-${win.to}`}
                          win={win}
                          isBest={isBest}
                          cloudNote={!!activity.cloudSensitive && win.peakUV > safeUv}
                          onShare={() => void shareWindow(activity, win)}
                          onCalendar={
                            calendarAllowed
                              ? () => openCalendar(activity.name, win, activity.durationMins)
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: 'var(--text-3)',
                      lineHeight: 1.45,
                    }}
                  >
                    No forecast window matches this activity today. Try shortening the duration,
                    widening preferred hours, or adjusting the planning UV limit.
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p
        style={{ margin: '10px 2px 0', fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.5 }}
      >
        Forecast-based planning estimate only. Conditions can change; use appropriate sun
        protection.
      </p>
    </div>
  )
}

'use client'
import { useState } from 'react'
import type { Activity, SafeActivityWindow, TierLevel, Location } from '@/lib/types'
import { fmtDays, gcalLink } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import { canUseCalendar, effectiveMaxUV } from '@/lib/tiers'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import type { SlotRecommendation } from '@/lib/scheduler'
import type { ActivityDayPlan } from '@/lib/next-slot'
import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import VisuallyHidden from './VisuallyHidden'
import styles from './Scheduled.module.css'

interface Props {
  /** One plan per activity for the selected day (see planActivityDay). */
  plans: ActivityDayPlan[]
  isToday: boolean
  /** The plans' date (YYYY-MM-DD) in the forecast location's zone. */
  dateStr: string
  /** The forecast location's IANA zone; calendar links are built in it. */
  timeZone: string
  tier: TierLevel
  location: Location
  dateLabel: string
  /** When provided (calendar connected), books the recommended slot as a real event. */
  onBookRecommended?: (activity: Activity, rec: SlotRecommendation) => void
  onEditActivity?: (activity: Activity) => void
  /** The activity's scheduled Google Calendar events on this day. */
  scheduledFor?: (activityId: string) => { item: ScheduledActivity; span: ScheduledSpan }[]
  /** Opens a scheduled event's details (change time, remove). */
  onOpenScheduled?: (item: ScheduledActivity) => void
}

const recommendedActionStyle = {
  marginTop: '8px',
  width: '100%',
  justifyContent: 'center',
  fontSize: '12px',
} as const

function Row({ label, val, accent }: { label: string; val: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: accent || 'var(--text)', fontWeight: 500 }}>{val}</span>
    </div>
  )
}

function WindowRow({
  win,
  isBest,
  cloudNote,
  onShare,
  calendarHref,
}: {
  win: SafeActivityWindow
  isBest: boolean
  cloudNote?: boolean
  onShare: () => void
  calendarHref?: string
}) {
  const fmt = useUnits()
  const range = `${fmt.time(win.from)}–${fmt.time(win.to)}`
  return (
    <div
      data-testid="activity-window"
      data-from={win.from}
      data-to={win.to}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        padding: '8px 10px',
        borderRadius: '10px',
        border: isBest ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
        background: isBest ? 'rgba(249,115,22,0.08)' : 'var(--bg-metric)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* The time range never breaks inside itself; BEST wraps below it as a unit
            when a narrow card has no room beside it. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: '7px',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}
          >
            {range}
          </span>
          {isBest && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 750,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
              }}
            >
              Best
            </span>
          )}
        </div>
        <span
          style={{
            display: 'block',
            fontSize: '11px',
            color: 'var(--text-3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {win.label} · Peak UV {win.peakUV.toFixed(1)}
          {cloudNote ? ' · ☁ with cloud estimate' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
        <button
          className="btn"
          onClick={onShare}
          aria-label={`Share ${range}`}
          style={{ padding: '5px 9px', fontSize: '11px' }}
        >
          Share
        </button>
        {calendarHref && (
          <a
            className="btn"
            href={calendarHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '5px 9px', fontSize: '11px', textDecoration: 'none' }}
          >
            Cal<VisuallyHidden>: add {range} to Google Calendar</VisuallyHidden>
          </a>
        )}
      </div>
    </div>
  )
}

export default function ActivityCards({
  plans,
  isToday,
  dateStr,
  timeZone,
  tier,
  location,
  dateLabel,
  onBookRecommended,
  onEditActivity,
  scheduledFor,
  onOpenScheduled,
}: Props) {
  const fmt = useUnits()
  const [confirm, setConfirm] = useState<string | null>(null)
  const calendarAllowed = canUseCalendar(tier)

  // Calendar actions are plain links (rel=noopener), so they are never pop-up
  // blocked and the new tab cannot reach back into this one.
  function calendarHref(activityName: string, span: { from: number; to: number }, mins: number) {
    return gcalLink(activityName, span, mins, dateStr, timeZone)
  }

  async function shareWindow(activity: Activity, selectedWindow: SafeActivityWindow) {
    const payload = {
      activity,
      window: selectedWindow,
      location,
      dateLabel,
      isoDate: dateStr,
    }
    const text = buildActivityShareText(payload, fmt.units.clock)
    const url = buildActivityShareUrl(
      payload,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    )
    let result: Awaited<ReturnType<typeof shareOrCopy>>
    try {
      result = await shareOrCopy(`${activity.name} sun window`, text, url)
    } catch {
      // AbortError: user dismissed the share sheet — no feedback needed
      return
    }
    setConfirm(
      result === 'shared'
        ? 'Shared activity window.'
        : result === 'copied'
          ? 'Copied share text and link.'
          : 'Sharing not supported — copy the link manually.',
    )
    setTimeout(() => setConfirm(null), 4500)
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
        {plans.map(plan => {
          const { activity, bestWindow, windows, slot: rec, pctDaySafe, burnMins } = plan
          // The badge describes the recommendation below it, never a window that
          // cannot be finished or has already passed.
          const status = plan.startsNow ? 'safe' : rec ? 'caution' : 'avoid'
          const badge = plan.startsNow
            ? 'Now'
            : rec
              ? isToday
                ? 'Later'
                : 'Available'
              : plan.elapsed
                ? 'None left'
                : 'No match'
          const durationLabel =
            activity.durationMins < 60
              ? `${activity.durationMins}m`
              : `${activity.durationMins / 60}h`
          const windowLabel = bestWindow
            ? `${fmt.time(bestWindow.from)}–${fmt.time(bestWindow.to)}`
            : plan.elapsed
              ? 'None left today'
              : isToday
                ? 'None today'
                : 'None'
          const safeUv = effectiveMaxUV(activity)
          const scheduled = scheduledFor?.(activity.id) ?? []
          // Once the recommended slot is on the calendar, it is not offered again.
          const recScheduled =
            !!rec && scheduled.some(({ span }) => span.from < rec.end && span.to > rec.start)

          return (
            <div
              key={activity.id}
              className="card"
              data-testid="activity-card"
              data-activity={activity.id}
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
                  {badge}
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

              {scheduled.map(({ item, span }) => {
                const range = `${fmt.time(span.from)}–${fmt.time(span.to)}`
                return (
                  <div
                    key={item.eventId}
                    className={styles.cardRow}
                    data-testid="scheduled-card-row"
                    data-event-id={item.eventId}
                  >
                    <div className={styles.cardText}>
                      <span className={styles.pill}>✓ Scheduled</span>
                      <span className={styles.cardTime}>{range}</span>
                    </div>
                    <div className={styles.cardActions}>
                      <a
                        className={`btn ${styles.small}`}
                        href={item.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open ↗
                        <VisuallyHidden>
                          : {activity.name} {range} in Google Calendar
                        </VisuallyHidden>
                      </a>
                      {onOpenScheduled && (
                        <button
                          type="button"
                          className={`btn ${styles.small}`}
                          aria-haspopup="dialog"
                          onClick={() => onOpenScheduled(item)}
                        >
                          Manage
                          <VisuallyHidden>
                            : scheduled {activity.name} {range}
                          </VisuallyHidden>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {rec && (
                <div
                  data-testid="recommended-slot"
                  data-start={rec.start}
                  data-end={rec.end}
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
                    {fmt.time(rec.start)}–{fmt.time(rec.end)}
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
                    {rec.latestStart > rec.earliestStart && (
                      <>
                        . Could start anytime{' '}
                        <span style={{ whiteSpace: 'nowrap' }}>
                          {fmt.time(rec.earliestStart)}–{fmt.time(rec.latestStart)}
                        </span>
                      </>
                    )}
                    .
                  </p>
                  {calendarAllowed &&
                    !recScheduled &&
                    (onBookRecommended ? (
                      <button
                        className="btn"
                        onClick={() => onBookRecommended(activity, rec)}
                        style={recommendedActionStyle}
                      >
                        📅 Add to Google Calendar
                      </button>
                    ) : (
                      <a
                        className="btn"
                        href={calendarHref(
                          activity.name,
                          { from: rec.start, to: rec.end },
                          activity.durationMins,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...recommendedActionStyle, textDecoration: 'none' }}
                      >
                        📅 Add to Calendar
                      </a>
                    ))}
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
                    val={`${fmt.hour(activity.preferredHours.from)}–${fmt.hour(activity.preferredHours.to)}`}
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
                  accent={bestWindow ? 'var(--success)' : 'var(--danger)'}
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
                        pctDaySafe >= 60
                          ? 'var(--success)'
                          : pctDaySafe >= 30
                            ? 'var(--warning)'
                            : 'var(--danger)',
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
                  {isToday ? 'Lower-UV windows left today' : 'Estimated lower-UV windows'}
                </p>
                {windows.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {windows.map(win => {
                      const isBest =
                        !!bestWindow && win.from === bestWindow.from && win.to === bestWindow.to
                      return (
                        <WindowRow
                          key={`${win.from}-${win.to}`}
                          win={win}
                          isBest={isBest}
                          cloudNote={!!activity.cloudSensitive && win.peakUV > safeUv}
                          onShare={() => void shareWindow(activity, win)}
                          calendarHref={
                            calendarAllowed
                              ? calendarHref(activity.name, win, activity.durationMins)
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
                    {plan.elapsed
                      ? "Today's matching windows have passed. See Best day this week for the next one."
                      : `No forecast window matches this activity ${isToday ? 'today' : 'this day'}. Try shortening the duration, widening preferred hours, or adjusting the planning UV limit.`}
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

'use client'
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { Activity, DayWeather, UserPreferences, WeatherResponse } from '@/lib/types'
import { canUseCalendar, getFutureDays, TIER_LIMITS } from '@/lib/tiers'
import type { SafeWindow } from '@/lib/calendar'
import { gcalWindowLink } from '@/lib/calendar'
import { nowHourOf, planActivityDay } from '@/lib/next-slot'
import { activityRunsOnDate } from '@/lib/recommendation'
import { dayOfMonth, formatDate, fractionalHour } from '@/lib/time'
import { useUnits } from '@/lib/use-units'
import type { UnitFormatters } from '@/lib/units'
import {
  LANE_GAP,
  UV_BANDS,
  VIEWS,
  chipVariant,
  computeAxis,
  computeColumns,
  pageTarget,
  rangeLabel,
  uvBand,
  visibleDays,
  type ChipVariant,
  type ViewKey,
} from '@/lib/calendar-layout'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import EditActivityModal from './EditActivityModal'

interface Props {
  prefs: UserPreferences
  /** The forecast as seen now in the location's zone (see lib/forecast.ts forecastView). */
  weather: WeatherResponse
  displayTier?: UserPreferences['tier']
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

// Vertical geometry. Column and lane widths live in lib/calendar-layout.ts; lanes
// are clipped to their day column so nothing can spill into the next day.
const ROW_H = 44
// Room above the first and below the last hour line so their labels are not cut.
const AXIS_PAD = 10
const HEADER_H = 52
const MAX_BODY_H = 760

// 700-level hues: white text on each meets WCAG AA (4.5:1) in both themes.
const ACT_COLORS = [
  '#C2410C',
  '#1D4ED8',
  '#047857',
  '#6D28D9',
  '#B45309',
  '#BE185D',
  '#0E7490',
  '#4D7C0F',
]

const UV_ROW_ALPHA = 0.11

const pagerButton: CSSProperties = {
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: 0,
  fontSize: '18px',
  lineHeight: 1,
}

const srOnly: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const sheetAction: CSSProperties = { justifyContent: 'center', minHeight: '40px' }

// Hours the forecast has no UV for are hatched, so a gap never reads as "no sun".
const NO_DATA_BG =
  'repeating-linear-gradient(135deg, rgba(128,128,128,0.16) 0 3px, transparent 3px 7px)'

function uvRowBg(uv: number | undefined): string {
  if (uv === undefined) return NO_DATA_BG
  const band = uvBand(uv)
  return `rgba(${band.rgb},${UV_ROW_ALPHA * band.weight})`
}

function durationText(mins: number): string {
  return mins < 60 ? `${mins} min` : `${mins / 60} hr`
}

interface CalendarDay extends DayWeather {
  /** Column header: "Today", or the weekday ("Tue"). */
  shortLabel: string
  isToday: boolean
}

function calendarDays(weather: WeatherResponse, limit: number): CalendarDay[] {
  return weather.forecast.slice(0, limit).map(day => {
    const isToday = day.dateStr === weather.now.date
    return {
      ...day,
      isToday,
      shortLabel: isToday ? 'Today' : formatDate(day.dateStr, { weekday: 'short' }),
    }
  })
}

interface Selection {
  act: Activity
  win: SafeWindow
  day: CalendarDay
  key: string
}

export default function CalendarView({ prefs, weather, displayTier, onPrefsUpdate }: Props) {
  const tier = displayTier || prefs.tier || 'anonymous'
  const dayLimit = getFutureDays(tier)
  const fmt = useUnits()
  const days = calendarDays(weather, dayLimit)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [view, setView] = useState<ViewKey>('full')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [focusedActivityId, setFocusedActivityId] = useState<string>('all')
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const returnFocusKey = useRef<string | null>(null)

  const calOk = canUseCalendar(tier)
  const visibleActivities =
    focusedActivityId === 'all'
      ? prefs.activities
      : prefs.activities.filter(a => a.id === focusedActivityId)
  const editingActivity = editingActivityId
    ? (prefs.activities.find(a => a.id === editingActivityId) ?? null)
    : null
  const lockedCopy =
    tier === 'anonymous'
      ? 'Sign in to see tomorrow in Calendar.'
      : tier === 'free'
        ? 'Go Pro for the full 10-day Calendar view.'
        : null

  // Column widths depend on the space the calendar actually has, not the viewport.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setGridWidth(el.clientWidth)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [prefs.activities.length])

  // Each view opens at its first hour, which is never later than the earliest window.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [view, focusedActivityId])

  function closeSheet() {
    setSelected(null)
    const key = returnFocusKey.current
    returnFocusKey.current = null
    // The chip stays mounted while the sheet is open, so focus can move back at once.
    if (key) chipRefs.current.get(key)?.focus()
  }

  // Detail sheet: focus moves into it on open, Escape closes it, and focus returns
  // to the chip that opened it.
  const selectedKey = selected?.key
  const onSheetKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') closeSheet()
  })
  useEffect(() => {
    if (!selectedKey) return
    sheetRef.current?.focus()
    window.addEventListener('keydown', onSheetKey)
    return () => window.removeEventListener('keydown', onSheetKey)
  }, [selectedKey])

  function flash(message: string, ms = 3500) {
    setConfirm(message)
    window.setTimeout(() => setConfirm(current => (current === message ? null : current)), ms)
  }

  async function shareWindow(act: Activity, win: SafeWindow, day: CalendarDay) {
    const payload = {
      activity: act,
      window: win,
      location: prefs.location,
      dateLabel: day.label,
      isoDate: day.dateStr,
    }
    const text = buildActivityShareText(payload, fmt.units.clock)
    const url = buildActivityShareUrl(
      payload,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    )
    let result: Awaited<ReturnType<typeof shareOrCopy>>
    try {
      result = await shareOrCopy(`${act.name} sun window`, text, url)
    } catch {
      setConfirm(null)
      return
    }
    flash(
      result === 'shared'
        ? 'Shared activity window.'
        : result === 'copied'
          ? 'Copied share text and link.'
          : `${text} ${url}`,
      4500,
    )
  }

  function updateActivity(updated: Activity) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({
      ...prefs,
      activities: prefs.activities.map(a => (a.id === updated.id ? updated : a)),
    })
    setEditingActivityId(null)
  }

  function deleteActivity(id: string) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({ ...prefs, activities: prefs.activities.filter(a => a.id !== id) })
    setEditingActivityId(null)
    setSelected(null)
  }

  if (!prefs.activities.length)
    return (
      <div style={{ padding: '3rem 0', textAlign: 'center' }}>
        <p style={{ fontSize: '34px', marginBottom: '10px' }}>🗓️</p>
        <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '6px', fontSize: '16px' }}>
          No activities yet
        </p>
        <p style={{ fontSize: '14px', color: 'var(--text-3)' }}>
          Add activities from the Dashboard to see estimated lower-UV windows.
        </p>
      </div>
    )

  const colorFor = (act: Activity) => {
    const idx = prefs.activities.findIndex(a => a.id === act.id)
    return ACT_COLORS[Math.max(0, idx) % ACT_COLORS.length] ?? '#C2410C'
  }

  // "Now" is the forecast location's wall clock, never the device's.
  const todayStr = weather.now.date
  const nowFrac = fractionalHour(weather.now)
  // The earliest start offered today (now, rounded up to 5 minutes).
  const todayNowHour = nowHourOf(weather.now)
  // The same actionable windows the dashboard offers (lib/next-slot.ts): today's
  // windows that have already passed are left out, one under way starts now, and
  // an activity limited to certain weekdays only appears on those days.
  const dayWindows = days.map(day => ({
    day,
    lanes: visibleActivities.map(act => ({
      act,
      color: colorFor(act),
      windows: activityRunsOnDate(act, day.dateStr)
        ? planActivityDay(day.hourly, act, prefs.skinType, {
            nowHour: day.isToday ? todayNowHour : -1,
          }).windows
        : [],
    })),
  }))

  // Full day starts at the earliest window and ends at the latest, so nothing
  // opens cut off; the other views are fixed zooms.
  const allWindows = dayWindows.flatMap(d => d.lanes.flatMap(l => l.windows))
  const { from: axisFrom, to: axisTo } = computeAxis(view, allWindows, prefs.calendarHours)
  const hasUVGaps = days.some(day => {
    const known = new Set(day.hourly.map(h => h.hour))
    for (let h = axisFrom; h < axisTo; h++) if (!known.has(h)) return true
    return false
  })
  const rows = Math.max(1, axisTo - axisFrom)
  const HOURS = Array.from({ length: rows + 1 }, (_, i) => axisFrom + i)
  const bodyH = rows * ROW_H + AXIS_PAD * 2

  const laneCount = Math.max(1, visibleActivities.length)
  const { colW, gutterW, daysAcross, laneW } = computeColumns(
    gridWidth,
    days.length,
    visibleActivities.length,
  )
  const { first: firstDay, last: lastDay } = visibleDays(
    scrollLeft,
    { colW, daysAcross },
    days.length,
  )
  const canPage = days.length > daysAcross
  const visibleRange = rangeLabel(days[firstDay]?.dateStr, days[lastDay]?.dateStr)

  function pageBy(direction: 1 | -1) {
    const target = pageTarget(firstDay, direction, daysAcross, days.length)
    scrollRef.current?.scrollTo({ left: target * colW, behavior: 'smooth' })
  }
  const variant = chipVariant(laneW)

  const line = 'var(--border)'
  // Decorative tint behind today's column; no text sits on it.
  const todayTint = 'rgba(249,115,22,0.06)'

  return (
    <div>
      <style>{`
        .solara-cal-chip { transition: filter 0.12s, box-shadow 0.12s; }
        .solara-cal-chip:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
        @media (hover: hover) { .solara-cal-chip:hover { filter: brightness(1.12); } }
        .solara-cal-pager { margin-left: auto; }
        .dark .solara-cal-uv { opacity: 0.75; }
      `}</style>

      <div
        style={{
          display: 'flex',
          gap: '8px 10px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '12px',
        }}
      >
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          htmlFor="calendar-activity-filter"
        >
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-3)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Show
          </span>
          <select
            id="calendar-activity-filter"
            value={focusedActivityId}
            onChange={e => {
              setFocusedActivityId(e.target.value)
              setSelected(null)
            }}
            style={{ fontSize: '13px', padding: '6px 8px' }}
          >
            <option value="all">All activities</option>
            {prefs.activities.map(a => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </label>
        <div
          role="group"
          aria-label="Hours shown"
          style={{
            display: 'inline-flex',
            padding: '3px',
            gap: '2px',
            borderRadius: '10px',
            background: 'var(--bg-subtle)',
            border: '0.5px solid var(--border-md)',
          }}
        >
          {VIEWS.map(v => {
            const active = v.key === view
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setView(v.key)
                  setSelected(null)
                }}
                style={{
                  fontSize: '12px',
                  fontWeight: active ? 600 : 500,
                  padding: '5px 10px',
                  minHeight: '28px',
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? 'var(--bg-card)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-2)',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {v.label}
              </button>
            )
          })}
        </div>
        {canPage && (
          <div
            className="solara-cal-pager"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <button
              type="button"
              className="btn"
              aria-label="Earlier days"
              disabled={firstDay === 0}
              onClick={() => pageBy(-1)}
              style={pagerButton}
            >
              ‹
            </button>
            <span
              aria-live="polite"
              style={{
                minWidth: '92px',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {visibleRange}
            </span>
            <button
              type="button"
              className="btn"
              aria-label="Later days"
              disabled={lastDay >= days.length - 1}
              onClick={() => pageBy(1)}
              style={pagerButton}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {lockedCopy && days.length > 0 && days.length < TIER_LIMITS.paid.futureDays && (
        <div
          style={{
            padding: '9px 12px',
            marginBottom: '10px',
            borderRadius: '10px',
            background: 'var(--notice-bg)',
            border: '0.5px solid var(--notice-border)',
            color: 'var(--notice-text)',
            fontSize: '13px',
          }}
        >
          🔒 {lockedCopy}
        </div>
      )}

      {confirm && (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            marginBottom: '10px',
            borderRadius: '10px',
            background: 'var(--notice-bg)',
            border: '0.5px solid var(--notice-border)',
            color: 'var(--notice-text)',
            fontSize: '12px',
          }}
        >
          {confirm}
        </div>
      )}

      <div
        ref={scrollRef}
        data-testid="calendar-grid"
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
        style={{
          maxHeight: `${MAX_BODY_H}px`,
          overflow: 'auto',
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: `${gutterW}px`,
          overscrollBehaviorX: 'contain',
          border: '0.5px solid var(--border-md)',
          borderRadius: '12px',
          background: 'var(--bg-card)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${gutterW}px repeat(${days.length}, minmax(${colW}px, 1fr))`,
            gridTemplateRows: `${HEADER_H}px ${bodyH}px`,
          }}
        >
          {/* Corner */}
          <div
            data-testid="calendar-corner"
            style={{
              position: 'sticky',
              top: 0,
              left: 0,
              zIndex: 4,
              background: 'var(--bg-card)',
              borderBottom: `1px solid ${line}`,
            }}
          />

          {/* Day headers */}
          {days.map(day => {
            const isToday = day.isToday
            return (
              <div
                key={day.dateStr}
                data-testid="calendar-day-header"
                style={{
                  scrollSnapAlign: 'start',
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                  minWidth: 0,
                  background: isToday ? 'var(--accent-soft)' : 'var(--bg-card)',
                  borderLeft: `1px solid ${line}`,
                  borderBottom: `1px solid ${line}`,
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: isToday ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {day.shortLabel}
                </span>
                <span
                  style={{
                    fontSize: '17px',
                    fontWeight: 650,
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    color: isToday ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {dayOfMonth(day.dateStr)}
                </span>
              </div>
            )
          })}

          {/* Hour gutter */}
          <div
            aria-hidden="true"
            style={{
              position: 'sticky',
              left: 0,
              zIndex: 2,
              background: 'var(--bg-card)',
            }}
          >
            {HOURS.map((h, i) => (
              <span
                key={h}
                style={{
                  position: 'absolute',
                  top: `${AXIS_PAD + i * ROW_H}px`,
                  right: '8px',
                  transform: 'translateY(-50%)',
                  fontSize: '11px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-3)',
                }}
              >
                {fmt.hour(h)}
              </span>
            ))}
          </div>

          {/* Day columns */}
          {dayWindows.map(({ day, lanes }) => {
            const isToday = day.dateStr === todayStr
            const uvByHour = new Map(day.hourly.map(h => [h.hour, h.uv]))
            return (
              <div
                key={day.dateStr}
                data-testid="calendar-day-column"
                data-date={day.dateStr}
                style={{
                  position: 'relative',
                  minWidth: 0,
                  borderLeft: `1px solid ${line}`,
                  background: isToday ? todayTint : 'transparent',
                }}
              >
                {/* UV tint and hour lines */}
                <div
                  aria-hidden="true"
                  className="solara-cal-uv"
                  style={{ position: 'absolute', inset: `${AXIS_PAD}px 0`, pointerEvents: 'none' }}
                >
                  {HOURS.slice(0, -1).map((h, hi) => (
                    <div
                      key={h}
                      style={{
                        position: 'absolute',
                        top: `${hi * ROW_H}px`,
                        left: 0,
                        right: 0,
                        height: `${ROW_H}px`,
                        background: uvRowBg(uvByHour.get(h)),
                        borderTop: `1px solid ${line}`,
                      }}
                    />
                  ))}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      borderTop: `1px solid ${line}`,
                    }}
                  />
                </div>

                {/* Activity lanes, clipped to the column */}
                <div
                  style={{
                    position: 'absolute',
                    inset: `${AXIS_PAD}px 0`,
                    overflow: 'hidden',
                    display: 'grid',
                    gridTemplateColumns: `repeat(${laneCount}, minmax(0, 1fr))`,
                    columnGap: `${LANE_GAP}px`,
                    padding: `0 ${LANE_GAP}px`,
                  }}
                >
                  {lanes.map(({ act, color, windows }) => (
                    <div key={act.id} style={{ position: 'relative', minWidth: 0 }}>
                      {windows.map((win, wi) => {
                        const topH = Math.max(win.from, axisFrom)
                        const botH = Math.min(win.to, axisTo)
                        if (botH <= topH) return null
                        const key = `${day.dateStr}:${act.id}:${wi}`
                        const top = (topH - axisFrom) * ROW_H + 1
                        const height = (botH - topH) * ROW_H - 2
                        const cutTop = win.from < axisFrom
                        const cutBottom = win.to > axisTo
                        const isSel = selected?.key === key
                        const lines = Math.floor((height - 6) / 13)
                        return (
                          <button
                            key={key}
                            ref={el => {
                              if (el) chipRefs.current.set(key, el)
                              else chipRefs.current.delete(key)
                            }}
                            type="button"
                            className="solara-cal-chip"
                            data-testid="calendar-chip"
                            data-from={win.from}
                            data-to={win.to}
                            aria-haspopup="dialog"
                            aria-expanded={isSel}
                            title={`${act.name} · ${fmt.time(win.from)}–${fmt.time(win.to)}`}
                            onClick={() => {
                              if (isSel) {
                                closeSheet()
                              } else {
                                returnFocusKey.current = key
                                setSelected({ act, win, day, key })
                              }
                            }}
                            style={{
                              position: 'absolute',
                              top: `${top}px`,
                              left: 0,
                              right: 0,
                              height: `${height}px`,
                              margin: 0,
                              padding: variant === 'full' ? '4px 6px' : '4px 1px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: variant === 'full' ? 'flex-start' : 'center',
                              justifyContent: 'flex-start',
                              gap: '1px',
                              overflow: 'hidden',
                              cursor: 'pointer',
                              border: 'none',
                              borderRadius: `${cutTop ? 0 : 6}px ${cutTop ? 0 : 6}px ${cutBottom ? 0 : 6}px ${cutBottom ? 0 : 6}px`,
                              background: color,
                              color: '#fff',
                              textAlign: variant === 'full' ? 'left' : 'center',
                              boxShadow: isSel
                                ? `inset 0 0 0 2px rgba(255,255,255,0.95), 0 0 0 1px ${color}`
                                : 'inset 0 0 0 1px rgba(255,255,255,0.14)',
                              zIndex: isSel ? 2 : 1,
                            }}
                          >
                            <ChipLabel
                              act={act}
                              win={win}
                              variant={variant}
                              lines={lines}
                              fmt={fmt}
                              startsNow={day.isToday && win.from === todayNowHour}
                            />
                            {/* The visible label is abbreviated, so the accessible
                                name is this full description instead. */}
                            <span data-sr-only style={srOnly}>
                              {`${act.name}, ${day.label}, ${fmt.time(win.from)} – ${fmt.time(win.to)}, peak UV ${win.peakUV.toFixed(1)}`}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {/* Hours already gone today are faded: nothing there can still be
                    planned, so the column's live part starts at the now line. */}
                {isToday && nowFrac > axisFrom && (
                  <div
                    aria-hidden="true"
                    data-testid="calendar-past"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: `${AXIS_PAD + (Math.min(nowFrac, axisTo) - axisFrom) * ROW_H}px`,
                      background: 'var(--bg-card)',
                      opacity: 0.55,
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {isToday && nowFrac >= axisFrom && nowFrac <= axisTo && (
                  <div
                    aria-hidden="true"
                    data-testid="calendar-now"
                    style={{
                      position: 'absolute',
                      top: `${AXIS_PAD + (nowFrac - axisFrom) * ROW_H - 1}px`,
                      left: 0,
                      right: 0,
                      height: '2px',
                      background: 'var(--accent)',
                      zIndex: 3,
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '-3px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        style={{
          marginTop: '12px',
          display: 'flex',
          gap: '8px 16px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: '6px 12px', flexWrap: 'wrap' }}>
          {prefs.activities.map(a => (
            <span
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-2)',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '3px',
                  background: colorFor(a),
                  flexShrink: 0,
                }}
              />
              {a.icon} {a.name}
            </span>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px 10px', flexWrap: 'wrap' }}>
          {UV_BANDS.filter(b => b.label).map(b => (
            <span
              key={b.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: 'var(--text-3)',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  background: `rgba(${b.rgb},0.45)`,
                }}
              />
              {b.label} UV
            </span>
          ))}
          {hasUVGaps && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: 'var(--text-3)',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  background: NO_DATA_BG,
                  boxShadow: 'inset 0 0 0 0.5px var(--border-md)',
                }}
              />
              No UV data
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          margin: '10px 0 0',
          fontSize: '11px',
          color: 'var(--text-3)',
          lineHeight: 1.45,
        }}
      >
        Select a window to share it or add it to your calendar. Forecast-based planning estimate
        only; recheck current UV and use appropriate sun protection.
      </p>

      {selected && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="calendar-sheet-title"
          tabIndex={-1}
          data-testid="calendar-sheet"
          style={{
            position: 'fixed',
            left: '12px',
            right: '12px',
            bottom: 'max(12px, env(safe-area-inset-bottom))',
            margin: '0 auto',
            maxWidth: '520px',
            zIndex: 60,
            padding: '16px',
            borderRadius: '16px',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border-md)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
            outline: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span
              aria-hidden="true"
              style={{
                width: '36px',
                height: '36px',
                flexShrink: 0,
                borderRadius: '10px',
                display: 'grid',
                placeItems: 'center',
                fontSize: '18px',
                background: colorFor(selected.act),
              }}
            >
              {selected.act.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                id="calendar-sheet-title"
                style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}
              >
                {selected.act.name}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-2)' }}>
                {selected.day.label} · {fmt.time(selected.win.from)} – {fmt.time(selected.win.to)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Close"
              onClick={closeSheet}
              style={{ padding: '4px 8px', minWidth: '32px', minHeight: '32px', fontSize: '14px' }}
            >
              ✕
            </button>
          </div>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: '13px',
              color: 'var(--text-2)',
              lineHeight: 1.5,
            }}
          >
            Estimated lower-UV window with a forecast peak of UV{' '}
            <strong style={{ color: 'var(--text)' }}>{selected.win.peakUV.toFixed(1)}</strong>.
            Schedule your{' '}
            <strong style={{ color: 'var(--text)' }}>
              {durationText(selected.act.durationMins)}
            </strong>{' '}
            session anywhere in this range.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: onPrefsUpdate ? '1fr 1fr' : '1fr',
              gap: '8px',
              marginTop: '14px',
            }}
          >
            {calOk ? (
              <a
                className="btn btn-primary"
                href={gcalWindowLink(
                  selected.act,
                  selected.win,
                  selected.day.dateStr,
                  weather.timezone,
                )}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => flash('Opened Google Calendar in a new tab.')}
                style={{ ...sheetAction, gridColumn: '1 / -1', textDecoration: 'none' }}
              >
                📅 Add to Google Calendar
              </a>
            ) : (
              <span
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--text-3)',
                }}
              >
                🔒 Sign in to add to Calendar
              </span>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void shareWindow(selected.act, selected.win, selected.day)}
              style={sheetAction}
            >
              ↗ Share
            </button>
            {onPrefsUpdate && (
              <button
                type="button"
                className="btn"
                onClick={() => setEditingActivityId(selected.act.id)}
                style={sheetAction}
              >
                Edit activity
              </button>
            )}
          </div>
        </div>
      )}

      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onSave={updateActivity}
          onDelete={deleteActivity}
          onClose={() => setEditingActivityId(null)}
        />
      )}
    </div>
  )
}

function ChipLabel({
  act,
  win,
  variant,
  lines,
  fmt,
  startsNow,
}: {
  act: Activity
  win: SafeWindow
  variant: ChipVariant
  lines: number
  fmt: UnitFormatters
  /** A window under way, trimmed to start now: its start reads "now" (short and exact). */
  startsNow: boolean
}) {
  const text: CSSProperties = {
    display: 'block',
    maxWidth: '100%',
    fontSize: '11px',
    lineHeight: '13px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
  const time: CSSProperties = {
    ...text,
    fontSize: '10.5px',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  }

  if (variant === 'full') {
    return (
      <>
        <span aria-hidden="true" style={{ ...text, fontWeight: 650 }}>
          {act.icon} {act.name}
        </span>
        {lines >= 2 && (
          <span aria-hidden="true" style={time}>
            {startsNow ? 'now' : fmt.time(win.from)} – {fmt.time(win.to)}
          </span>
        )}
      </>
    )
  }

  const label = variant === 'compact' ? fmt.compactHour : fmt.time
  return (
    <>
      <span aria-hidden="true" style={{ ...text, fontSize: '12px', lineHeight: '14px' }}>
        {act.icon}
      </span>
      {lines >= 2 && (
        <span aria-hidden="true" style={time}>
          {startsNow ? 'now' : label(win.from)}
        </span>
      )}
      {lines >= 3 && (
        <span aria-hidden="true" style={time}>
          {label(win.to)}
        </span>
      )}
    </>
  )
}

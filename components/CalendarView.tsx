'use client'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import { canUseCalendar, getFutureDays, TIER_LIMITS } from '@/lib/tiers'
import type { DayForecast, SafeWindow } from '@/lib/calendar'
import { getSafeWindowsForActivity, gcalWindowLink, fmtH } from '@/lib/calendar'
import { fetchForecast } from '@/lib/forecast'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import EditActivityModal from './EditActivityModal'

interface Props {
  prefs: UserPreferences
  weather?: WeatherResponse | null
  displayTier?: UserPreferences['tier']
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

// Grid geometry. Every day column has the same width; each visible activity gets an
// equal lane inside it, and lanes are clipped to their column so nothing can spill
// into the neighbouring day.
const ROW_H = 44
const GUTTER_W = 46
// Room above the first and below the last hour line so their labels are not cut.
const AXIS_PAD = 10
const HEADER_H = 52
// Narrowest lane that still fits an icon and a short time such as "10a".
const MIN_LANE_W = 25
const LANE_GAP = 2
// At most a week side by side; further days scroll horizontally.
const MAX_DAYS_ACROSS = 7
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

const UV_BANDS = [
  { max: 0.5, rgb: '156,163,175', label: null, weight: 0.4 },
  { max: 2, rgb: '74,222,128', label: 'Low', weight: 1 },
  { max: 5, rgb: '250,204,21', label: 'Moderate', weight: 1 },
  { max: 7, rgb: '251,146,60', label: 'High', weight: 1 },
  { max: 10, rgb: '248,113,113', label: 'Very high', weight: 1 },
  { max: Infinity, rgb: '192,132,252', label: 'Extreme', weight: 1 },
] as const

const UV_ROW_ALPHA = 0.11

const pagerButton: CSSProperties = {
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: 0,
  fontSize: '18px',
  lineHeight: 1,
}

const sheetAction: CSSProperties = { justifyContent: 'center', minHeight: '40px' }

function uvBand(uv: number) {
  if (uv < UV_BANDS[0].max) return UV_BANDS[0]
  return UV_BANDS.find(b => b.label && uv <= b.max) ?? UV_BANDS[5]
}

function uvRowBg(uv: number): string {
  const band = uvBand(uv)
  return `rgba(${band.rgb},${UV_ROW_ALPHA * band.weight})`
}

type ViewKey = 'full' | 'morning' | 'afternoon' | 'evening'

const VIEWS: { key: ViewKey; label: string; from?: number; to?: number }[] = [
  { key: 'full', label: 'Full day' },
  { key: 'morning', label: 'Morning', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 18 },
  { key: 'evening', label: 'Evening', from: 16, to: 21 },
]

type ChipVariant = 'full' | 'stacked' | 'compact'

function chipVariant(laneW: number): ChipVariant {
  if (laneW >= 76) return 'full'
  if (laneW >= 36) return 'stacked'
  return 'compact'
}

/** "6am" -> "6a", for the narrowest lanes. */
function shortHour(h: number): string {
  return fmtH(h).replace(/([ap])m$/, '$1')
}

function durationText(mins: number): string {
  return mins < 60 ? `${mins} min` : `${mins / 60} hr`
}

function forecastFromWeather(weather: WeatherResponse, limit = 7): DayForecast[] {
  const todayStr = new Date().toLocaleDateString('en-CA')
  return weather.forecast.slice(0, limit).map(day => {
    const d = new Date(day.dateStr + 'T12:00:00')
    return {
      dateStr: day.dateStr,
      label: day.label,
      shortLabel:
        day.dateStr === todayStr ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
      hourly: day.hourly.map(h => ({ hour: h.hour, uv: h.uv, tempF: h.tempF })),
    }
  })
}

interface Selection {
  act: Activity
  win: SafeWindow
  day: DayForecast
  key: string
}

export default function CalendarView({ prefs, weather, displayTier, onPrefsUpdate }: Props) {
  const tier = displayTier || prefs.tier || 'anonymous'
  const dayLimit = getFutureDays(tier)
  const [days, setDays] = useState<DayForecast[]>(
    weather ? forecastFromWeather(weather, dayLimit) : [],
  )
  const [loading, setLoading] = useState(!weather)
  const [error, setError] = useState<string | null>(null)
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
  }, [loading, error, prefs.activities.length])

  // Each view opens at its first hour, which is never later than the earliest window.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [view, focusedActivityId])

  useEffect(() => {
    if (weather) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirrors the weather prop into the state the fetch path also writes; deriving it during render belongs to the data-layer refactor (see CQ-7).
      setDays(forecastFromWeather(weather, dayLimit))
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchForecast(prefs.location, {
          days: dayLimit,
          signal: controller.signal,
        })
        setDays(forecastFromWeather(data, dayLimit))
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setError('Could not load forecast.')
      } finally {
        setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Reload only when the coordinates change, not on every location object identity change (see CQ-7).
  }, [prefs.location.lat, prefs.location.lon, weather, dayLimit])

  function closeSheet() {
    setSelected(null)
    const key = returnFocusKey.current
    returnFocusKey.current = null
    // The chip stays mounted while the sheet is open, so focus can move back at once.
    if (key) chipRefs.current.get(key)?.focus()
  }

  // Detail sheet: focus moves into it on open, Escape closes it, and focus returns
  // to the chip that opened it.
  useEffect(() => {
    if (!selected) return
    sheetRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-run per opened window; closeSheet only touches refs and setters.
  }, [selected?.key])

  function flash(message: string, ms = 3500) {
    setConfirm(message)
    window.setTimeout(() => setConfirm(current => (current === message ? null : current)), ms)
  }

  async function shareWindow(act: Activity, win: SafeWindow, day: DayForecast) {
    const payload = { activity: act, window: win, location: prefs.location, dateLabel: day.label }
    const text = buildActivityShareText(payload)
    const url = buildActivityShareUrl(
      payload,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    )
    try {
      const result = await shareOrCopy(`${act.name} sun window`, text, url)
      flash(
        result === 'shared'
          ? 'Shared activity window.'
          : result === 'copied'
            ? 'Copied share text and link.'
            : `${text} ${url}`,
        4500,
      )
    } catch {
      setConfirm(null)
    }
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

  if (loading)
    return (
      <div
        style={{ padding: '3rem 0', textAlign: 'center', fontSize: '14px', color: 'var(--text-3)' }}
      >
        Loading forecast…
      </div>
    )
  if (error)
    return (
      <div style={{ padding: '2rem 0', textAlign: 'center', fontSize: '14px', color: '#DC2626' }}>
        {error}
      </div>
    )

  const colorFor = (act: Activity) => {
    const idx = prefs.activities.findIndex(a => a.id === act.id)
    return ACT_COLORS[Math.max(0, idx) % ACT_COLORS.length] ?? '#C2410C'
  }

  const dayWindows = days.map(day => ({
    day,
    lanes: visibleActivities.map(act => ({
      act,
      color: colorFor(act),
      windows: getSafeWindowsForActivity(day.hourly, act),
    })),
  }))

  // Axis range. Full day spans the user's hours and widens to fit every window, so
  // no window starts above the first hour line. Presets are fixed zooms.
  const allWindows = dayWindows.flatMap(d => d.lanes.flatMap(l => l.windows))
  const prefFrom = prefs.calendarHours?.from ?? 6
  const prefTo = Math.max(prefFrom + 1, prefs.calendarHours?.to ?? 20)
  const preset = VIEWS.find(v => v.key === view)
  const axisFrom = preset?.from ?? Math.min(prefFrom, ...allWindows.map(w => Math.floor(w.from)))
  const axisTo = preset?.to ?? Math.max(prefTo, ...allWindows.map(w => Math.ceil(w.to)))
  const rows = Math.max(1, axisTo - axisFrom)
  const HOURS = Array.from({ length: rows + 1 }, (_, i) => axisFrom + i)
  const bodyH = rows * ROW_H + AXIS_PAD * 2

  const now = new Date()
  const nowFrac = now.getHours() + now.getMinutes() / 60
  const todayStr = now.toLocaleDateString('en-CA')

  // Fit as many days as the width allows without lanes narrower than MIN_LANE_W.
  const laneCount = Math.max(1, visibleActivities.length)
  const minColW = laneCount * MIN_LANE_W + LANE_GAP * (laneCount + 1)
  const available = gridWidth ? gridWidth - GUTTER_W : minColW * 3
  const daysAcross = Math.max(
    1,
    Math.min(days.length, MAX_DAYS_ACROSS, Math.floor(available / minColW)),
  )
  // Whole-pixel columns; the gutter takes the remainder so the last visible day ends
  // flush with the edge instead of a sliver of the next day peeking in.
  const colW = Math.max(minColW, Math.floor(available / daysAcross))
  const gutterW = gridWidth ? Math.max(GUTTER_W, gridWidth - colW * daysAcross) : GUTTER_W
  const firstDay = Math.min(Math.max(0, Math.round(scrollLeft / colW)), days.length - 1)
  const lastDay = Math.min(days.length - 1, firstDay + daysAcross - 1)
  const canPage = days.length > daysAcross
  const monthDay = (dateStr: string) =>
    new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const firstDate = days[firstDay]?.dateStr
  const lastDate = days[lastDay]?.dateStr
  const rangeLabel =
    firstDate && lastDate
      ? firstDate.slice(0, 7) === lastDate.slice(0, 7)
        ? `${monthDay(firstDate)} – ${Number(lastDate.slice(8))}`
        : `${monthDay(firstDate)} – ${monthDay(lastDate)}`
      : ''

  function pageBy(direction: 1 | -1) {
    const target = Math.min(
      Math.max(0, firstDay + direction * daysAcross),
      Math.max(0, days.length - daysAcross),
    )
    scrollRef.current?.scrollTo({ left: target * colW, behavior: 'smooth' })
  }
  const laneW = (colW - LANE_GAP * (laneCount + 1)) / laneCount
  const variant = chipVariant(laneW)

  const line = 'var(--border)'
  const todayTint = 'rgba(249,115,22,0.06)'

  return (
    <div style={{ fontFamily: 'var(--font-sans)' }}>
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
              style={{ ...pagerButton, opacity: firstDay === 0 ? 0.4 : 1 }}
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
              {rangeLabel}
            </span>
            <button
              type="button"
              className="btn"
              aria-label="Later days"
              disabled={lastDay >= days.length - 1}
              onClick={() => pageBy(1)}
              style={{ ...pagerButton, opacity: lastDay >= days.length - 1 ? 0.4 : 1 }}
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
            background: 'rgba(249,115,22,0.08)',
            color: 'var(--text-2)',
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
            background: 'rgba(249,115,22,0.08)',
            color: 'var(--text-2)',
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
            const isToday = day.dateStr === todayStr
            const d = new Date(day.dateStr + 'T12:00:00')
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
                  background: 'var(--bg-card)',
                  backgroundImage: isToday ? `linear-gradient(${todayTint}, ${todayTint})` : 'none',
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
                  {d.getDate()}
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
                {fmtH(h)}
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
                        background: uvRowBg(uvByHour.get(h) ?? 0),
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
                            aria-haspopup="dialog"
                            aria-expanded={isSel}
                            aria-label={`${act.name}, ${day.label}, ${fmtH(win.from)} to ${fmtH(win.to)}, peak UV ${win.peakUV.toFixed(1)}`}
                            title={`${act.name} · ${fmtH(win.from)}–${fmtH(win.to)}`}
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
                            <ChipLabel act={act} win={win} variant={variant} lines={lines} />
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>

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
                {selected.day.label} · {fmtH(selected.win.from)} – {fmtH(selected.win.to)}
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
                href={gcalWindowLink(selected.act, selected.win, selected.day.dateStr)}
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
}: {
  act: Activity
  win: SafeWindow
  variant: ChipVariant
  lines: number
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
    color: 'rgba(255,255,255,0.92)',
  }

  if (variant === 'full') {
    return (
      <>
        <span style={{ ...text, fontWeight: 650 }}>
          <span aria-hidden="true">{act.icon}</span> {act.name}
        </span>
        {lines >= 2 && (
          <span style={time}>
            {fmtH(win.from)} – {fmtH(win.to)}
          </span>
        )}
      </>
    )
  }

  const fmt = variant === 'compact' ? shortHour : fmtH
  return (
    <>
      <span aria-hidden="true" style={{ ...text, fontSize: '12px', lineHeight: '14px' }}>
        {act.icon}
      </span>
      {lines >= 2 && <span style={time}>{fmt(win.from)}</span>}
      {lines >= 3 && <span style={time}>{fmt(win.to)}</span>}
    </>
  )
}

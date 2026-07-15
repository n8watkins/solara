'use client'
import { useState, useEffect } from 'react'
import { Activity, WeatherResponse, UserPreferences, DayWeather, TierLevel, HourlyForecast } from '@/lib/types'
import { burnMins, vitDMins, uvLabel, getActivityWindow, fmtHour } from '@/lib/weather'
import { getFutureDays } from '@/lib/tiers'
import { isCalendarConfigured, requestAccessToken, requestWriteToken, fetchFreeBusy, createCalendarEvent, buildEventBody, buildEventDescription, busyIntervalsForDay, BusyPeriod } from '@/lib/gcal'
import { SlotRecommendation } from '@/lib/scheduler'
import SunArc from './SunArc'
import UVTimeline from './UVTimeline'
import ActivityCards from './ActivityCards'
import PlanAhead from './PlanAhead'
import CalendarFeed from './CalendarFeed'
import AddActivityModal from './AddActivityModal'
import ManageActivitiesModal from './ManageActivitiesModal'
import EditActivityModal from './EditActivityModal'
import ActivityModalShell from './ActivityModalShell'
import Tooltip from './Tooltip'
import TipCarousel from './TipCarousel'
import GoogleSignInButton, { ACTIVITY_SIGNIN_BLURB } from './GoogleSignInButton'

interface Props {
  weather: WeatherResponse
  prefs: UserPreferences
  displayTier?: TierLevel
  onPrefsUpdate: (prefs: UserPreferences) => void
  onRefresh: () => void
  selectedDay: DayWeather | null
  onSelectDay: (day: DayWeather | null) => void
}

function uvNumberColor(uv: number): string {
  if (uv < 0.5) return 'var(--text-3)'
  if (uv <= 2)  return '#16A34A'
  if (uv <= 5)  return '#D97706'
  if (uv <= 7)  return '#EA580C'
  if (uv <= 10) return '#DC2626'
  return '#9333EA'
}

export default function Dashboard({ weather, prefs, displayTier, onPrefsUpdate, onRefresh, selectedDay, onSelectDay }: Props) {
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [activityModal, setActivityModal] = useState<'add' | 'manage' | null>(null)
  const [showDayModal, setShowDayModal] = useState(false)
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [calBusy, setCalBusy] = useState<BusyPeriod[] | null>(null)
  const [calStatus, setCalStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  // The hour being inspected, shared by the sun path + the UV strip so a tap on
  // either keeps both in sync. null = fall back to "now" (today) / first hour.
  const [focusedHour, setFocusedHour] = useState<HourlyForecast | null>(null)
  const currentHour = new Date().getHours()

  const accessTier = displayTier || prefs.tier || 'anonymous'
  const activityTier = prefs.tier || 'anonymous'
  // Activities require an account; guests get a sign-in prompt instead of add/manage.
  const activitiesLocked = activityTier === 'anonymous'
  const accessibleDays = getFutureDays(accessTier)
  const visibleForecast = weather.forecast.slice(0, accessibleDays)
  const selectedDayAllowed = selectedDay && visibleForecast.some(day => day.dateStr === selectedDay.dateStr)
  const effectiveSelectedDay = selectedDayAllowed ? selectedDay : null

  const activeDayData = effectiveSelectedDay ? effectiveSelectedDay.hourly : weather.today
  const isToday       = !effectiveSelectedDay
  const dayIndex      = effectiveSelectedDay ? weather.forecast.findIndex(d => d.dateStr === effectiveSelectedDay.dateStr) : 0

  // Switching days clears the scrubbed hour so the arc/strip snap back to "now"
  // (or the new day's first hour) rather than pointing at a stale hour.
  const activeDayKey = effectiveSelectedDay?.dateStr ?? 'today'
  useEffect(() => { setFocusedHour(null) }, [activeDayKey])
  // Guard against a focus left over from another day's array identity.
  const sharedFocus = focusedHour && activeDayData.includes(focusedHour) ? focusedHour : null

  const hourly    = activeDayData
  const peakEntry = activeDayData.reduce((best, h) => h.uv > (best?.uv ?? 0) ? h : best, activeDayData[0])
  const currentUV   = isToday ? weather.current.uv    : (peakEntry?.uv    ?? 0)
  const currentTemp = isToday ? weather.current.tempF : (peakEntry?.tempF ?? '--' as string | number)
  const currentCond = isToday ? weather.current.condition : (peakEntry?.condition ?? '')
  const peakUV      = hourly.length ? Math.max(...hourly.map(h => h.uv)) : 0
  const peakHour    = hourly.find(h => h.uv === peakUV)?.hour ?? 12

  // The hour whose stats fill the card's big header. A tap/scrub on the strip or
  // arc moves `sharedFocus`; with nothing focused we fall back to the current hour
  // (today) or the day's peak. This is the single, prominent readout — the small
  // line that used to live inside UVTimeline has been removed to avoid duplication.
  const focusHour = sharedFocus ?? (isToday ? activeDayData.find(h => h.hour === currentHour) ?? null : null)
  const headUV   = focusHour ? focusHour.uv    : currentUV
  const headTemp = focusHour ? focusHour.tempF : currentTemp
  const headCond = focusHour ? focusHour.condition : currentCond
  // Label under the big number: "now" only when the focus is the live current hour.
  const headIsNow = isToday && (focusHour ? focusHour.hour === currentHour : true)
  const headSuffix = headIsNow ? ' now' : (focusHour ? ` at ${fmtHour(focusHour.hour)}` : ' peak')

  const burn = burnMins(currentUV, prefs.skinType)
  const vitD = vitDMins(currentUV, prefs.skinType)
  // Burn time for the focused hour drives the consolidated readout's detail line.
  const headBurn = burnMins(headUV, prefs.skinType)

  const activityWindows = prefs.activities.map(a => getActivityWindow(hourly, a, currentHour, prefs.skinType))
  const bestPlan = activityWindows.find(w => w.bestWindow)
  const bestShareWindow = bestPlan?.bestWindow
  const bestShareActivity = bestPlan?.activity
  const bestSafeNow = bestPlan?.safeNow ?? false
  // The peak UV lives on the matching SafeActivityWindow in allWindows, not on the
  // bare {from,to} bestWindow — look it up for the hero's "Peak UV" line.
  const bestWindowPeakUV = bestShareWindow
    ? bestPlan?.allWindows.find(w => w.from === bestShareWindow.from && w.to === bestShareWindow.to)?.peakUV
    : undefined
  const editingActivity = editingActivityId ? prefs.activities.find(a => a.id === editingActivityId) ?? null : null

  const dateLabel = effectiveSelectedDay?.label ?? 'Today'
  const activeDateStr = effectiveSelectedDay?.dateStr ?? weather.forecast[0]?.dateStr ?? ''
  const busyByDate: Record<string, ReturnType<typeof busyIntervalsForDay>> = {}
  if (calBusy) for (const day of visibleForecast) busyByDate[day.dateStr] = busyIntervalsForDay(calBusy, day.dateStr)
  const busyForActiveDay = busyByDate[activeDateStr] ?? []
  const nowDate = new Date()
  const nowFractional = nowDate.getHours() + nowDate.getMinutes() / 60
  const lockedForecastCount = Math.max(0, weather.forecast.length - visibleForecast.length)
  // No upsell pill for guests — keep their dashboard unintrusive; sign-in CTAs live
  // in the activities section and header only.
  const upgradeCopy = accessTier === 'free' ? 'Go Pro for 10-day planning' : null
  const showDayTabs = visibleForecast.length > 1 || (upgradeCopy !== null && lockedForecastCount > 0)

  function updateActivities(activities: UserPreferences['activities']) {
    onPrefsUpdate({ ...prefs, activities })
  }

  function updateActivity(updated: Activity) {
    updateActivities(prefs.activities.map(activity => activity.id === updated.id ? updated : activity))
    setEditingActivityId(null)
  }

  function deleteActivity(id: string) {
    updateActivities(prefs.activities.filter(activity => activity.id !== id))
    setEditingActivityId(null)
  }

  function openEditActivity(activity: Activity) {
    setEditingActivityId(activity.id)
  }

  async function connectCalendar() {
    setCalStatus('connecting')
    try {
      const token = await requestAccessToken()
      const timeMin = new Date()
      const timeMax = new Date(Date.now() + Math.max(1, accessibleDays) * 86_400_000)
      const periods = await fetchFreeBusy(token, timeMin, timeMax)
      setCalBusy(periods)
      setCalStatus('connected')
    } catch {
      setCalStatus('error')
    }
  }

  async function bookSlotOn(activity: Activity, rec: SlotRecommendation, dateStr: string) {
    setShareMsg('Adding to your calendar…')
    try {
      const token = await requestWriteToken()
      // For a future day the "peak" context belongs to that day, not today's reading.
      const peak = dateStr === activeDateStr ? { peakUV, peakHour } : { peakUV: rec.peakUV }
      const description = buildEventDescription(rec, activity, peak)
      const body = buildEventBody(activity, dateStr, rec.start, rec.end, description)
      const event = await createCalendarEvent(token, body)
      setShareMsg('✓ Added to your Google Calendar.')
      if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noopener')
    } catch {
      setShareMsg('Could not add to calendar — try again.')
    }
    window.setTimeout(() => setShareMsg(null), 4000)
  }

  function hideSuggestion(id: string) {
    const hidden = prefs.hiddenActivitySuggestionIds ?? []
    if (hidden.includes(id)) return
    onPrefsUpdate({ ...prefs, hiddenActivitySuggestionIds: [...hidden, id] })
  }

  function toggleCategory(name: string) {
    const collapsed = prefs.collapsedActivityCategories ?? []
    onPrefsUpdate({
      ...prefs,
      collapsedActivityCategories: collapsed.includes(name)
        ? collapsed.filter(c => c !== name)
        : [...collapsed, name],
    })
  }

  if (!hourly.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: '34px', marginBottom: '8px' }}>🌙</p>
        <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px', fontSize: '16px' }}>No UV data for this period</p>
        <p style={{ fontSize: '14px', color: 'var(--text-3)' }}>UV data is available between 6am and 8pm.</p>
      </div>
    )
  }

  return (
    <div className="dash-stack">

      {/* Day picker — no horizontal scroll. Today + Tomorrow are direct buttons;
          everything else (plus any locked-day upgrade hint) lives in a vertical
          modal list. The refresh button always renders so it stays reachable even
          when there's only a single visible day. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          {showDayTabs && (() => {
            const isTodayActive = !effectiveSelectedDay
            const tomorrowDay = visibleForecast[1]
            const isTomorrowActive = !!(effectiveSelectedDay && tomorrowDay && effectiveSelectedDay.dateStr === tomorrowDay.dateStr)
            // A day picked from the modal that isn't Today/Tomorrow — label the
            // "More days" button with it so the active selection stays visible.
            const beyondActive = effectiveSelectedDay && !isTomorrowActive
              ? effectiveSelectedDay
              : null
            // Show "More days" when there are accessible days past tomorrow, or
            // when there are locked days to surface the upgrade hint.
            const showMore = visibleForecast.length > 2 || (lockedForecastCount > 0 && !!upgradeCopy)
            const chip = (label: string, active: boolean, onClick: () => void, key: string) => (
              <button key={key} onClick={onClick} style={{
                flexShrink: 0, padding: '8px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                background: active ? 'var(--accent)' : 'var(--bg-metric)',
                color: active ? '#fff' : 'var(--text)',
                border: 'none', transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}>
                {label}
              </button>
            )
            return (
              <>
                {chip('Today', isTodayActive, () => onSelectDay(null), 'today')}
                {tomorrowDay && chip('Tomorrow', isTomorrowActive, () => onSelectDay(tomorrowDay), 'tomorrow')}
                {showMore && chip(
                  beyondActive ? beyondActive.label : 'More days',
                  !!beyondActive,
                  () => setShowDayModal(true),
                  'more',
                )}
              </>
            )
          })()}
        </div>
        <button className="btn btn-ghost" onClick={onRefresh} title="Refresh" style={{ padding: '7px 9px', fontSize: '17px', flexShrink: 0 }}>↻</button>
      </div>

      {shareMsg && (
        <div style={{ padding: '11px 13px', borderRadius: '10px', background: 'rgba(249,115,22,0.08)', color: 'var(--text-2)', fontSize: '13px', border: '0.5px solid rgba(249,115,22,0.2)' }}>
          {shareMsg}
        </div>
      )}

      {/* Hero: lead with the answer for the selected day — the best window, or a
          clear "no safe window" headline when UV stays too high — so a phone user
          gets the actionable takeaway before any of the detail cards. */}
      {!activitiesLocked && prefs.activities.length > 0 && (
        bestShareActivity && bestShareWindow ? (
          <div className="card" style={{ background: 'linear-gradient(180deg, rgba(249,115,22,0.10), rgba(249,115,22,0.04))', border: '0.5px solid rgba(249,115,22,0.30)' }}>
            <p className="section-label" style={{ color: 'var(--accent)' }}>Estimated lower-UV window</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '9px' }}>
              <span style={{ fontSize: '32px', flexShrink: 0 }}>{bestShareActivity.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '24px', fontWeight: 750, color: 'var(--text)', lineHeight: 1.1 }}>
                  {fmtHour(bestShareWindow.from)}–{fmtHour(bestShareWindow.to)}
                </p>
                <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bestShareActivity.name}{bestWindowPeakUV !== undefined ? ` · Peak UV ${bestWindowPeakUV.toFixed(1)}` : ''}
                </p>
              </div>
              {isToday && bestSafeNow && (
                <span className="badge badge-safe" style={{ flexShrink: 0 }}>Within limit now</span>
              )}
            </div>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)' }}>
            <p className="section-label">No matching lower-UV window {dateLabel.toLowerCase()}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '9px' }}>
              <span style={{ fontSize: '30px', flexShrink: 0 }}>🌥️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.15 }}>
                  Peak UV {peakUV.toFixed(1)} at {fmtHour(peakHour)}
                </p>
                <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.4 }}>
                  Forecast UV stays above your activity limit. Check early morning or evening instead.
                </p>
              </div>
            </div>
          </div>
        )
      )}

      <div className="card">
        <p style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>
          <Tooltip text="Each bar shows the UV index for that hour. Hover or tap to see burn time and conditions.">
            UV by hour
          </Tooltip>
        </p>

        {/* CONSOLIDATED READOUT — the single, prominent detail for the focused hour.
            It sits ABOVE the arc + strip so a finger scrubbing below never covers it.
            FIXED two-row layout: a long UV label ("Very high") can never shove the
            temperature or change the card height as the focused hour changes — row 1
            is the big number + label, row 2 is the temp · condition · burn line, each
            on its own line with reserved height. */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minHeight: '40px' }}>
            <span style={{ fontSize: '40px', fontWeight: 700, color: uvNumberColor(headUV), lineHeight: 1, flexShrink: 0 }}>{headUV.toFixed(1)}</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', lineHeight: 1.2, minWidth: 0 }}>
              {uvLabel(headUV)}<span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{headSuffix}</span>
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: 'var(--text-3)', lineHeight: 1.3, minHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {typeof headTemp === 'number' ? `${headTemp}°F` : headTemp} · {headCond}{headBurn ? ` · burn ~${headBurn}m` : ''}
          </p>
        </div>

        {process.env.NEXT_PUBLIC_HIDE_SUNPATH !== '1' && prefs.showSunPath !== false && (
          <SunArc
            hourly={hourly}
            currentHour={isToday ? currentHour : -1}
            isToday={isToday}
            focused={sharedFocus}
            onSelectHour={setFocusedHour}
          />
        )}
        <UVTimeline
          hourly={hourly}
          currentHour={isToday ? currentHour : -1}
          skinType={prefs.skinType}
          focused={sharedFocus}
          onSelectHour={setFocusedHour}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        <div className="metric-card" style={{ padding: '10px 12px' }}>
          <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
            <span className="tooltip-anchor">
              Estimated burn time
              <Tooltip text={`A rough estimate for ${prefs.skinType} skin without sunscreen at this UV level. Do not use it as a timer for unprotected exposure.`}>
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '23px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.05 }}>{burn ? `${burn}m` : '—'}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>{prefs.skinType} skin, no SPF</p>
        </div>
        <div className="metric-card" style={{ padding: '10px 12px' }}>
          <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
            <span className="tooltip-anchor">
              Vitamin D estimate
              <Tooltip text="A rough model, not a recommended exposure target. Vitamin D needs and production vary widely; ask a clinician if you are concerned.">
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '23px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.05 }}>{vitD ? `${vitD}m` : '—'}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>Arms + legs</p>
        </div>
      </div>

      <p style={{ margin: '-6px 2px 0', fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.5 }}>
        Forecasts and exposure estimates can change. Use sun protection and do not treat these planning estimates as medical advice.
      </p>

      <TipCarousel />

      <section>
        <div style={{ marginBottom: '12px' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>Activities</p>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-3)' }}>
            Add what you do outside, then Solara estimates lower-UV windows.
          </p>
          {/* One Add control on the LEFT, Manage pushed to the far RIGHT via
              space-between so the two actions are never clustered together. */}
          {!activitiesLocked && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '12px' }}>
              <button
                className="btn btn-primary"
                onClick={() => setActivityModal('add')}
                style={{ fontSize: '13px', padding: '8px 14px' }}
              >
                + Add Activity
              </button>
              <button
                className="btn"
                onClick={() => setActivityModal('manage')}
                style={{ fontSize: '13px', padding: '8px 14px' }}
              >
                Manage
              </button>
            </div>
          )}
        </div>

        {!activitiesLocked && prefs.activities.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <PlanAhead
              forecast={weather.forecast}
              activities={prefs.activities}
              skinType={prefs.skinType}
              dayLimit={accessibleDays}
              busyByDate={busyByDate}
              nowHourToday={nowFractional}
              lockedDays={lockedForecastCount}
              upgradeCopy={upgradeCopy}
              onUpgrade={() => { setShareMsg(upgradeCopy); window.setTimeout(() => setShareMsg(null), 3500) }}
              onBook={calStatus === 'connected' ? bookSlotOn : undefined}
            />
          </div>
        )}

        {!activitiesLocked && prefs.activities.length > 0 && isCalendarConfigured() && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', marginBottom: '12px', background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>🗓️</span>
            {calStatus === 'connected' ? (
              <p style={{ margin: 0, flex: 1, fontSize: '13px', color: 'var(--text-2)' }}>
                Recommendations now schedule around your calendar. <span style={{ color: 'var(--text-3)' }}>Solara sees only when you're busy, never event details.</span>
              </p>
            ) : (
              <>
                <p style={{ margin: 0, flex: 1, fontSize: '13px', color: 'var(--text-2)' }}>
                  Connect Google Calendar to schedule activities around your real availability.
                  {calStatus === 'error' && <span style={{ color: '#DC2626' }}> Couldn't connect — try again.</span>}
                </p>
                <button className="btn" onClick={connectCalendar} disabled={calStatus === 'connecting'} style={{ fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {calStatus === 'connecting' ? 'Connecting…' : 'Connect calendar'}
                </button>
              </>
            )}
          </div>
        )}

        {!activitiesLocked && prefs.activities.length > 0 && (
          <CalendarFeed prefs={prefs} onPrefsUpdate={onPrefsUpdate} />
        )}

        {/* The sign-in gate must win even over legacy guest activities saved before
            the activities-require-sign-in policy; they still seed the account on sign-in. */}
        {activitiesLocked ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.75rem 1.5rem' }}>
            <p style={{ fontSize: '30px', marginBottom: '10px' }}>🏃</p>
            <p style={{ fontWeight: 650, fontSize: '16px', color: 'var(--text)', margin: '0 0 7px' }}>Sign in to track your activities</p>
            <p style={{ fontSize: '14px', color: 'var(--text-3)', margin: '0 0 20px', lineHeight: '1.55' }}>
              {ACTIVITY_SIGNIN_BLURB} Signing in with Google is free.
            </p>
            <GoogleSignInButton seedPrefs={prefs} style={{ margin: '0 auto', minWidth: '220px' }} />
          </div>
        ) : prefs.activities.length > 0 ? (
          <ActivityCards
            windows={activityWindows}
            daysFromNow={dayIndex}
            tier={accessTier}
            location={prefs.location}
            dateLabel={dateLabel}
            hourly={hourly}
            busy={busyForActiveDay}
            onBookRecommended={calStatus === 'connected' ? (a, r) => bookSlotOn(a, r, activeDateStr) : undefined}
            onEditActivity={openEditActivity}
          />
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '2.75rem 1.5rem' }}>
            <p style={{ fontSize: '30px', marginBottom: '10px' }}>🏃</p>
            <p style={{ fontWeight: 650, fontSize: '16px', color: 'var(--text)', margin: '0 0 7px' }}>No activities set up yet</p>
            <p style={{ fontSize: '14px', color: 'var(--text-3)', margin: '0 0 20px', lineHeight: '1.55' }}>
              Add your outdoor activities to see forecast-based, lower-UV planning windows.
            </p>
            <button className="btn btn-primary" onClick={() => setActivityModal('add')} style={{ fontSize: '14px', padding: '10px 24px', borderRadius: '12px' }}>
              + Add Activity
            </button>
          </div>
        )}
      </section>

      {activityModal === 'add' && (
        <AddActivityModal
          activities={prefs.activities}
          tier={activityTier}
          hiddenSuggestionIds={prefs.hiddenActivitySuggestionIds}
          collapsedCategories={prefs.collapsedActivityCategories}
          onActivitiesChange={updateActivities}
          onHideSuggestion={hideSuggestion}
          onToggleCategory={toggleCategory}
          onClose={() => setActivityModal(null)}
        />
      )}

      {activityModal === 'manage' && (
        <ManageActivitiesModal
          activities={prefs.activities}
          tier={activityTier}
          onActivitiesChange={updateActivities}
          onAddActivity={() => setActivityModal('add')}
          onEditActivity={openEditActivity}
          onClose={() => setActivityModal(null)}
        />
      )}

      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onSave={updateActivity}
          onDelete={deleteActivity}
          onClose={() => setEditingActivityId(null)}
        />
      )}

      {showDayModal && (
        <ActivityModalShell
          title="Choose a day"
          description="Pick any day in your forecast."
          onClose={() => setShowDayModal(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {visibleForecast.map((day, i) => {
              const isActive = i === 0 ? !effectiveSelectedDay : effectiveSelectedDay?.dateStr === day.dateStr
              return (
                <button
                  key={day.dateStr}
                  onClick={() => { onSelectDay(i === 0 ? null : day); setShowDayModal(false) }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '13px 15px', borderRadius: '12px', cursor: 'pointer',
                    background: isActive ? 'var(--accent)' : 'var(--bg-metric)',
                    color: isActive ? '#fff' : 'var(--text)',
                    border: isActive ? 'none' : '0.5px solid var(--border-md)',
                    fontSize: '14px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                  }}
                >
                  <span>{day.label}</span>
                  {isActive && <span style={{ fontSize: '13px' }}>✓</span>}
                </button>
              )
            })}
            {lockedForecastCount > 0 && upgradeCopy && (
              <div style={{ marginTop: '6px', padding: '13px 15px', borderRadius: '12px', background: 'rgba(249,115,22,0.06)', border: '0.5px dashed rgba(249,115,22,0.55)' }}>
                <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>🔒 {upgradeCopy}</p>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                  {lockedForecastCount} more {lockedForecastCount === 1 ? 'day is' : 'days are'} available on a higher plan.
                </p>
              </div>
            )}
          </div>
        </ActivityModalShell>
      )}

    </div>
  )
}

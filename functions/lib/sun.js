// Server-side sun-window logic for the calendar feed (P7b). Deliberately a compact
// re-implementation of the client engine (lib/scheduler + lib/weather), because
// Cloud Functions are a separate Node runtime that can't import the app's TS.
// Keep behavior aligned with the client; the client remains the source of truth.

/** Effective safe UV: SPF 30+ raises the threshold ~2.5x, capped at 11. */
function effectiveMaxUV(activity) {
  const base = activity.maxUV ?? 4
  return activity.sunscreen ? Math.min(Math.round(base * 2.5), 11) : base
}

/** Activity weekday restriction (0=Sun…6=Sat). Empty/absent = every day. */
function runsOn(activity, dateStr) {
  if (!Array.isArray(activity.daysOfWeek) || activity.daysOfWeek.length === 0) return true
  return activity.daysOfWeek.includes(new Date(dateStr + 'T12:00:00').getDay())
}

/** Contiguous [from,to) windows where uv ≤ maxUV and the activity fits. */
function safeWindows(hourly, maxUV, durationMins) {
  const windows = []
  let start = null
  for (let i = 0; i < hourly.length; i++) {
    const { hour, uv } = hourly[i]
    if (uv <= maxUV) {
      if (start === null) start = hour
    } else {
      if (start !== null && (hour - start) * 60 >= durationMins) windows.push({ from: start, to: hour })
      start = null
    }
  }
  if (start !== null && hourly.length) {
    const last = hourly[hourly.length - 1].hour + 1
    if ((last - start) * 60 >= durationMins) windows.push({ from: start, to: last })
  }
  return windows.map(w => ({ ...w, avgUV: avgUV(hourly, w.from, w.to) }))
}

function avgUV(hourly, from, to) {
  const s = hourly.filter(h => h.hour >= from && h.hour < to)
  return s.length ? Math.round((s.reduce((a, h) => a + h.uv, 0) / s.length) * 10) / 10 : 0
}

/** Lowest-average-UV window (ties: longer). */
function bestWindow(hourly, maxUV, durationMins) {
  return safeWindows(hourly, maxUV, durationMins)
    .sort((a, b) => (a.avgUV - b.avgUV) || ((b.to - b.from) - (a.to - a.from)))[0] || null
}

/** Fetch daytime (06–20) hourly UV per day for `days` days. */
async function fetchForecast(lat, lon, days) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=uv_index&timezone=auto&forecast_days=${days}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`forecast ${res.status}`)
  const data = await res.json()
  const byDate = {}
  data.hourly.time.forEach((t, i) => {
    const [d, tm] = t.split('T')
    const hour = parseInt(tm)
    if (hour < 6 || hour > 20) return
    ;(byDate[d] ||= []).push({ hour, uv: Math.round(data.hourly.uv_index[i] * 10) / 10 })
  })
  return Object.entries(byDate).slice(0, days).map(([dateStr, hourly]) => ({ dateStr, hourly }))
}

/** Build ICS events for each activity's best window on each eligible day. */
function buildSunEvents(user, forecast) {
  const activities = user.activities || []
  const events = []
  for (const day of forecast) {
    for (const act of activities) {
      if (!runsOn(act, day.dateStr)) continue
      const win = bestWindow(day.hourly, effectiveMaxUV(act), act.durationMins ?? 30)
      if (!win) continue
      const durH = (act.durationMins ?? 30) / 60
      const start = win.from
      const end = Math.min(win.from + durH, win.to)
      events.push({
        uid: `${day.dateStr}-${act.id}-${Math.round(start * 60)}@solara`,
        summary: `${act.icon || '☀️'} ${act.name} — sun window`,
        description: `Safe window ${win.from}:00–${win.to}:00 (avg UV ${win.avgUV})${act.sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Planned by Solara.`,
        dateStr: day.dateStr, start, end,
      })
    }
  }
  return events
}

module.exports = { effectiveMaxUV, runsOn, safeWindows, bestWindow, fetchForecast, buildSunEvents }

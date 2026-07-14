const recommendation = require('./recommendation-engine')
const { effectiveMaxUV, runsOn, bestWindow } = recommendation

function safeWindows(hourly, maxUV, durationMins, activity) {
  return recommendation.findWindows(hourly, maxUV, durationMins, activity?.preferredHours)
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
      const win = bestWindow(day.hourly, effectiveMaxUV(act), act.durationMins ?? 30, act.preferredHours)
      if (!win) continue
      const durH = (act.durationMins ?? 30) / 60
      const start = win.from
      const end = Math.min(win.from + durH, win.to)
      events.push({
        uid: `${day.dateStr}-${act.id}-${Math.round(start * 60)}@solara`,
        summary: `${act.icon || '☀️'} ${act.name}: lower-UV window`,
        description: `Estimated lower-UV window ${win.from}:00–${win.to}:00 (avg UV ${win.avgUV})${act.sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Forecast-based estimate only. Recheck current UV and use sun protection. Planned by Solara.`,
        dateStr: day.dateStr, start, end,
      })
    }
  }
  return events
}

module.exports = { effectiveMaxUV, runsOn, safeWindows, bestWindow, fetchForecast, buildSunEvents }

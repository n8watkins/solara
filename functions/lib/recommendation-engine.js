'use strict'

// Portable recommendation primitives shared by the browser bundle, notification
// worker, and Cloud Functions. Keep this module free of Firebase, browser, and
// Node-only APIs so every delivery surface runs exactly the same calculations.

const SKIN_BURN_BASE = Object.freeze({
  'very-fair': 10,
  fair: 15,
  medium: 25,
  olive: 35,
  dark: 50,
})

function effectiveMaxUV(activity) {
  const base = activity.maxUV ?? 4
  return activity.sunscreen ? Math.min(Math.round(base * 2.5), 11) : base
}

function burnMins(uv, skinType) {
  if (uv < 0.5) return null
  const base = SKIN_BURN_BASE[skinType]
  if (base == null) throw new Error(`Unknown skin type: ${skinType}`)
  return Math.round((base * 10) / uv)
}

function weekdayForDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null
  return date.getUTCDay()
}

function runsOn(activity, dateStr) {
  if (!Array.isArray(activity.daysOfWeek) || activity.daysOfWeek.length === 0) return true
  const weekday = weekdayForDate(dateStr)
  return weekday !== null && activity.daysOfWeek.includes(weekday)
}

function labelWindow(from, to) {
  if (from <= 7 && to >= 19) return 'All day'
  const midpoint = (from + to) / 2
  if (midpoint < 11) return 'Morning'
  if (midpoint < 14) return 'Midday'
  if (midpoint < 17) return 'Afternoon'
  return 'Evening'
}

function hourAllowed(hour, preferredHours) {
  return !preferredHours || (hour >= preferredHours.from && hour < preferredHours.to)
}

function summarizeWindow(hourly, from, to) {
  const samples = hourly.filter(hour => hour.hour >= from && hour.hour < to)
  const peakUV = samples.length ? Math.max(...samples.map(hour => hour.uv)) : 0
  const avgUV = samples.length
    ? Math.round((samples.reduce((sum, hour) => sum + hour.uv, 0) / samples.length) * 10) / 10
    : 0
  return {
    from,
    to,
    label: labelWindow(from, to),
    peakUV: Math.round(peakUV * 10) / 10,
    avgUV,
  }
}

/**
 * Find contiguous [from,to) windows whose planning UV is at or below maxUV.
 * `planningUV` may hold a conservative adjustment while `uv` always remains
 * the forecast value used in the returned summary.
 * An hour without a finite UV never qualifies, and a window never spans a gap
 * in the hour sequence, so an unknown or missing hour is never recommended.
 */
function findWindows(hourly, maxUV, durationMins = 0, preferredHours) {
  const windows = []
  let start = null

  for (let i = 0; i <= hourly.length; i++) {
    const current = hourly[i]
    const previous = hourly[i - 1]
    const planningUV = current ? (current.planningUV ?? current.uv) : null
    const qualifies =
      current !== undefined &&
      Number.isFinite(current.uv) &&
      Number.isFinite(planningUV) &&
      planningUV <= maxUV &&
      hourAllowed(current.hour, preferredHours)
    const continues = qualifies && previous !== undefined && current.hour === previous.hour + 1

    if (start !== null && !continues) {
      const to = previous.hour + 1
      if ((to - start) * 60 >= durationMins) {
        windows.push(summarizeWindow(hourly, start, to))
      }
      start = null
    }
    if (qualifies && start === null) start = current.hour
  }

  return windows
}

function bestWindow(hourly, maxUV, durationMins = 0, preferredHours) {
  return (
    findWindows(hourly, maxUV, durationMins, preferredHours).sort(
      (a, b) => a.avgUV - b.avgUV || b.to - b.from - (a.to - a.from),
    )[0] || null
  )
}

module.exports = {
  SKIN_BURN_BASE,
  effectiveMaxUV,
  burnMins,
  weekdayForDate,
  runsOn,
  findWindows,
  bestWindow,
}

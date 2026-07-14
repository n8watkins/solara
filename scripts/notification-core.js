const {
  bestWindow,
  burnMins,
  effectiveMaxUV,
  findWindows,
  runsOn,
} = require('../functions/lib/recommendation-engine')

function weatherLabel(code) {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Partly cloudy'
  if (code <= 49) return 'Foggy'
  if (code <= 67) return 'Rainy'
  return 'Cloudy'
}

function fmtHour(hour) {
  if (hour === 12) return '12pm'
  if (hour === 0) return '12am'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

function localParts(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(now)
    const part = type => parts.find(item => item.type === type)?.value
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'))
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      hour: Number(part('hour')),
      weekday,
    }
  } catch {
    return null
  }
}

function isDue(user, timezone, now = new Date()) {
  const local = localParts(now, timezone)
  if (!local) return false
  const notificationHour = Math.max(5, Math.min(10, Math.round(user.notificationHour ?? 7)))
  return local.hour >= notificationHour && local.hour < notificationHour + 2
}

function notificationKey(timezone, now = new Date()) {
  const local = localParts(now, timezone)
  return local ? `daily-v2:${local.date}` : null
}

function isEligibleUser(user) {
  return user?.tier === 'paid'
    && typeof user.location?.lat === 'number'
    && typeof user.location?.lon === 'number'
}

function buildMessage(user, hourly, dateStr) {
  const activities = (user.activities ?? []).filter(activity => !dateStr || runsOn(activity, dateStr))
  const skinType = ['very-fair', 'fair', 'medium', 'olive', 'dark'].includes(user.skinType) ? user.skinType : 'fair'
  const city = user.location?.city ?? 'your area'
  const peakUV = hourly.length ? Math.max(...hourly.map(sample => sample.uv)) : null

  for (const activity of activities) {
    const threshold = effectiveMaxUV(activity)
    const window = bestWindow(hourly, threshold, activity.durationMins ?? 30, activity.preferredHours)
    if (!window) continue
    const burn = burnMins(threshold, skinType)
    return {
      title: `${activity.icon || '☀️'} ${activity.name}: ${fmtHour(window.from)} to ${fmtHour(window.to)}`,
      body: `Estimated lower-UV window in ${city}: UV at or below ${threshold}${activity.sunscreen ? ' assuming SPF 30+' : ''}${burn ? `. Threshold exposure estimate: about ${burn} min` : ''}. Check current conditions.`,
    }
  }

  return {
    title: `☀️ UV planning update for ${city}`,
    body: peakUV === null
      ? 'No forecast was available for your saved activities. Check current conditions before heading outside.'
      : `Peak UV is forecast near ${peakUV}. No qualifying lower-UV activity window was found. Check current conditions.`,
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

module.exports = {
  bestWindow,
  buildMessage,
  burnMins,
  effectiveMaxUV,
  fmtHour,
  isDue,
  isEligibleUser,
  localParts,
  mapLimit,
  notificationKey,
  runsOnDate: runsOn,
  safeWindows: findWindows,
  weatherLabel,
}

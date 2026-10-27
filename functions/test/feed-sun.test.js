const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

// The tests run against the compiled output in lib/ (npm test builds it first).
const { buildSunEvents } = require('../lib/feed/sun')

describe('calendar feed windows', () => {
  // UV under 4 until 9am, then high all day.
  const forecast = [
    {
      dateStr: '2026-06-15',
      hourly: [6, 7, 8, 9, 10, 11].map(hour => ({ hour, uv: hour < 9 ? 3.6 : 7 })),
    },
  ]
  const walk = { id: 'walk', name: 'Walk', durationMins: 60, maxUV: 4, sunscreen: false }

  test('plan against the forecast UV for an activity without shade or surface', () => {
    const events = buildSunEvents({ activities: [walk] }, forecast)
    assert.equal(events.length, 1)
    assert.equal(events[0].start, 6)
  })

  test('use the same shade and surface adjustment as the app', () => {
    // 3.6 on sand is 4.2, over the limit: no window.
    assert.deepEqual(buildSunEvents({ activities: [{ ...walk, surface: 'sand' }] }, forecast), [])
    // 7 in mostly shade is 3.5, under it: the whole morning fits.
    const shaded = buildSunEvents({ activities: [{ ...walk, shade: 'full' }] }, forecast)
    assert.equal(shaded.length, 1)
    assert.match(shaded[0].description, /6:00–11:00/)
  })
})

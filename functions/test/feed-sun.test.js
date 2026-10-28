const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

// The tests run against the compiled output in lib/ (npm test builds it first).
const {
  buildSunEvents,
  clearLastGoodForecasts,
  fetchForecast,
  parseSunForecast,
} = require('../lib/feed/sun')

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

  test('count the forecast clouds once, as the app does', () => {
    // 3.6 with heavy cloud, 6 under a clear sky.
    const cloudy = [
      {
        dateStr: '2026-06-15',
        hourly: [6, 7, 8, 9].map(hour => ({ hour, uv: 3.6, clearSkyUV: 6 })),
      },
    ]
    // Without "Account for cloud cover" the plan is for a clear sky: no window.
    assert.deepEqual(buildSunEvents({ activities: [walk] }, cloudy), [])
    // With it, the forecast's clouds count, once.
    const counted = buildSunEvents({ activities: [{ ...walk, cloudSensitive: true }] }, cloudy)
    assert.equal(counted.length, 1)
  })

  test('read the clear-sky UV from the forecast', () => {
    const days = parseSunForecast(
      {
        hourly: {
          time: ['2026-06-15T09:00', '2026-06-15T10:00'],
          uv_index: [3.6, 5],
          uv_index_clear_sky: [6, null],
        },
      },
      1,
    )
    assert.deepEqual(days[0].hourly, [
      { hour: 9, uv: 3.6, clearSkyUV: 6 },
      { hour: 10, uv: 5 },
    ])
  })

  test('ask the provider for the clear-sky UV too', async () => {
    clearLastGoodForecasts()
    let url = ''
    const fetchImpl = async requested => {
      url = String(requested)
      return new Response(
        JSON.stringify({
          hourly: { time: ['2026-06-15T09:00'], uv_index: [3], uv_index_clear_sky: [5] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const days = await fetchForecast(34.05, -118.24, 1, { fetchImpl })
    assert.equal(new URL(url).searchParams.get('hourly'), 'uv_index,uv_index_clear_sky')
    assert.deepEqual(days[0].hourly, [{ hour: 9, uv: 3, clearSkyUV: 5 }])
  })
})

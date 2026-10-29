const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

// The tests run against the compiled output in lib/ (npm test builds it first).
const { buildSunEvents, parseSunForecast } = require('../lib/feed/sun')
const core = require('../core/index.js')

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

  test('read activities through the app schema and skip invalid ones (REVIEW3 L4)', () => {
    const events = buildSunEvents(
      {
        activities: [
          // An inherited key as the shade gave a NaN UV and no window.
          { ...walk, shade: 'toString', surface: 'constructor' },
          { ...walk, id: 'swim', name: 'Swim', maxUV: 'high', durationMins: null },
          'not an activity',
          null,
          { ...walk, id: '', name: 'Hike' },
        ],
      },
      forecast,
    )
    // Open sun for the walk; the swim gets the app's defaults (UV 4, 30 minutes); the
    // hike without an id gets the one the app gives it from its position.
    assert.deepEqual(
      events.map(event => [event.uid, event.summary, event.start, event.end]),
      [
        ['2026-06-15-walk-360@solara', '☀️ Walk: lower-UV window', 6, 7],
        ['2026-06-15-swim-360@solara', '☀️ Swim: lower-UV window', 6, 6.5],
        ['2026-06-15-migrated_4-360@solara', '☀️ Hike: lower-UV window', 6, 7],
      ],
    )
  })

  test('keep windows in daylight at the place, as the app does', () => {
    // Los Angeles in late October: sunrise 7:09am, sunset 6:04pm.
    const hours = [6, 7, 8, 9, 16, 17, 18, 19]
    const days = parseSunForecast(
      {
        timezone: 'America/Los_Angeles',
        hourly: {
          time: hours.map(h => `2026-10-28T${String(h).padStart(2, '0')}:00`),
          uv_index: hours.map(h => (h < 8 || h > 17 ? 0 : 2)),
        },
      },
      1,
      { lat: 34.05, lon: -118.24 },
    )
    assert.deepEqual(days[0].daylight, { from: 7 + 10 / 60, to: 18 })
    const events = buildSunEvents({ activities: [walk] }, days)
    assert.equal(events.length, 1)
    // The dark 6am hour (UV 0) is not offered; the walk starts at the first step after sunrise.
    assert.equal(events[0].start, 7 + 10 / 60)
    assert.match(events[0].description, /window 7:10–10:00 /)
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

  test('read the shared app forecast, which carries the clear-sky UV too', () => {
    // The feed reads the same cached forecast as the app (core.appForecastRequest).
    assert.ok(core.appForecastRequest(34.05, -118.24).hourly.includes('uv_index_clear_sky'))
    const response = core.parseOpenMeteoResponse({
      timezone: 'America/Los_Angeles',
      current: { uv_index: 3 },
      hourly: {
        time: ['2026-06-15T09:00', '2026-06-16T09:00'],
        uv_index: [3, 4],
        uv_index_clear_sky: [5, 6],
        temperature_2m: [20, 21],
      },
    })
    const days = parseSunForecast(response, 1)
    assert.deepEqual(days, [{ dateStr: '2026-06-15', hourly: [{ hour: 9, uv: 3, clearSkyUV: 5 }] }])
  })

  test('skip likely rain and too much heat for the activity, as the app does', () => {
    const day = {
      dateStr: '2026-06-15',
      hourly: [6, 7, 8, 9, 10, 11].map(hour => ({
        hour,
        uv: 2,
        rainChance: hour < 8 ? 70 : 0,
        feelsC: hour >= 10 ? 36 : 25,
      })),
    }
    // Walking skips the rain (6-8); 36°C is under its 38°C limit.
    const [walking] = buildSunEvents({ activities: [walk] }, [day])
    assert.equal(walking.start, 8)
    assert.match(walking.description, /8:00–11:00/)
    // Running also stops at a feels-like 32°C.
    const [running] = buildSunEvents({ activities: [{ ...walk, id: 'run' }] }, [day])
    assert.match(running.description, /8:00–10:00/)
    // Swimming goes ahead in the rain.
    const [swimming] = buildSunEvents({ activities: [{ ...walk, id: 'swim' }] }, [day])
    assert.equal(swimming.start, 6)
  })

  test('read the chance of rain and the feels-like temperature from the forecast', () => {
    const days = parseSunForecast(
      {
        timezone: 'UTC',
        hourly: {
          time: ['2026-06-15T09:00', '2026-06-15T10:00'],
          uv_index: [3, 4],
          precipitation_probability: [55, null],
          apparent_temperature: [31.26, null],
        },
      },
      1,
    )
    assert.deepEqual(days[0].hourly, [
      { hour: 9, uv: 3, rainChance: 55, feelsC: 31.3 },
      { hour: 10, uv: 4 },
    ])
  })
})

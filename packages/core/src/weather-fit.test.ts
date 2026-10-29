import { describe, expect, it } from 'vitest'
import {
  formatTemperature,
  HEAT_LIMIT_C,
  RAIN_LIKELY_PERCENT,
  weatherDefaults,
  weatherIn,
  weatherLimits,
  weatherSpans,
  weatherText,
} from './weather-fit'
import { ACTIVITY_CATEGORIES } from './tiers'

const time = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
const fahrenheit = (c: number) => formatTemperature(c, 'fahrenheit')

describe('weather defaults', () => {
  it('lets water sports go ahead in rain and heat', () => {
    expect(weatherDefaults('swim')).toEqual({ avoidRain: false, maxFeelsLikeC: null })
    expect(weatherDefaults('surf')).toEqual({ avoidRain: false, maxFeelsLikeC: null })
    // Rain spoils a kayak trip, but the water keeps paddlers cool.
    expect(weatherDefaults('kayak')).toEqual({ avoidRain: true, maxFeelsLikeC: null })
  })

  it('stops strenuous activities sooner in the heat than easy ones', () => {
    expect(weatherDefaults('run')).toEqual({ avoidRain: true, maxFeelsLikeC: 32 })
    expect(weatherDefaults('dog').maxFeelsLikeC).toBe(HEAT_LIMIT_C.strenuous)
    expect(weatherDefaults('read')).toEqual({ avoidRain: true, maxFeelsLikeC: 38 })
  })

  it('gives custom activities the general default', () => {
    expect(weatherDefaults('custom_17')).toEqual({ avoidRain: true, maxFeelsLikeC: 38 })
    expect(weatherDefaults(undefined)).toEqual({ avoidRain: true, maxFeelsLikeC: 38 })
  })

  it('names only real preset ids', () => {
    const ids = new Set(ACTIVITY_CATEGORIES.flatMap(c => c.activities.map(a => a.id)))
    for (const id of ['swim', 'surf', 'kayak', 'paddle', 'run', 'jog', 'cycle', 'mtb', 'sprint'])
      expect(ids.has(id)).toBe(true)
    for (const id of ['hike', 'soccer', 'tennis', 'baseball', 'bball', 'golf', 'dog'])
      expect(ids.has(id)).toBe(true)
  })
})

describe('weatherLimits', () => {
  it('lets the activity override its defaults, null meaning no heat limit', () => {
    expect(weatherLimits({ id: 'run', avoidRain: false })).toEqual({
      avoidRain: false,
      maxFeelsLikeC: 32,
    })
    expect(weatherLimits({ id: 'run', maxFeelsLikeC: null }).maxFeelsLikeC).toBeNull()
    expect(weatherLimits({ id: 'swim', avoidRain: true, maxFeelsLikeC: 35 })).toEqual({
      avoidRain: true,
      maxFeelsLikeC: 35,
    })
  })
})

describe('weatherIn', () => {
  const run = weatherLimits({ id: 'run' })

  it('skips an hour from a 50% chance of rain', () => {
    expect(weatherIn({ rainChance: RAIN_LIKELY_PERCENT }, run)).toBe('rain')
    expect(weatherIn({ rainChance: RAIN_LIKELY_PERCENT - 1 }, run)).toBeNull()
    expect(weatherIn({ rainChance: 90 }, weatherLimits({ id: 'swim' }))).toBeNull()
  })

  it('skips an hour that feels hotter than the limit', () => {
    expect(weatherIn({ feelsC: 32 }, run)).toBeNull()
    expect(weatherIn({ feelsC: 32.1 }, run)).toBe('heat')
    expect(weatherIn({ feelsC: 45 }, weatherLimits({ id: 'swim' }))).toBeNull()
  })

  it('names rain first when both apply', () => {
    expect(weatherIn({ rainChance: 80, feelsC: 40 }, run)).toBe('rain')
  })

  it('never skips an hour without values (an older cached forecast)', () => {
    expect(weatherIn({}, run)).toBeNull()
    expect(weatherIn({ rainChance: null, feelsC: null }, run)).toBeNull()
  })
})

describe('weatherSpans', () => {
  const hours = [
    { hour: 9, rainChance: 10, feelsC: 25 },
    { hour: 10, rainChance: 60, feelsC: 25 },
    { hour: 11, rainChance: 70, feelsC: 26 },
    { hour: 12, rainChance: 10, feelsC: 33 },
    { hour: 13, rainChance: 10, feelsC: 35.5 },
    { hour: 14, rainChance: 10, feelsC: 30 },
    { hour: 15, rainChance: 90, feelsC: 30 },
  ]
  const run = weatherLimits({ id: 'run' })

  it('joins skipped hours into runs of one reason, with the hottest feels-like', () => {
    expect(weatherSpans(hours, run, [{ from: 9, to: 16 }])).toEqual([
      { kind: 'rain', from: 10, to: 12 },
      { kind: 'heat', from: 12, to: 14, feelsC: 35.5 },
      { kind: 'rain', from: 15, to: 16 },
    ])
  })

  it('counts only hours inside the windows the UV allows', () => {
    expect(weatherSpans(hours, run, [{ from: 13.5, to: 15 }])).toEqual([
      { kind: 'heat', from: 13, to: 14, feelsC: 35.5 },
    ])
    expect(weatherSpans(hours, run, [])).toEqual([])
  })
})

describe('weatherText', () => {
  it('says it in plain words in the display units', () => {
    expect(weatherText({ kind: 'rain', from: 14, to: 16 }, time, fahrenheit)).toBe(
      'Rain likely 2pm–4pm',
    )
    expect(weatherText({ kind: 'heat', from: 13, to: 17, feelsC: 36 }, time, fahrenheit)).toBe(
      'Too hot 1pm–5pm, feels like 97°F',
    )
    expect(
      weatherText({ kind: 'heat', from: 13, to: 17, feelsC: 36 }, time, c =>
        formatTemperature(c, 'celsius'),
      ),
    ).toBe('Too hot 1pm–5pm, feels like 36°C')
  })
})

describe('formatTemperature', () => {
  it('rounds to whole degrees and never prints -0', () => {
    expect(formatTemperature(29.4, 'celsius')).toBe('29°C')
    expect(formatTemperature(29, 'fahrenheit')).toBe('84°F')
    expect(formatTemperature(-0.2, 'celsius')).toBe('0°C')
    expect(formatTemperature(Number.NaN, 'celsius')).toBe('--')
  })
})

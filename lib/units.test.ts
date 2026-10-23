import { describe, expect, it } from 'vitest'
import {
  celsiusToFahrenheit,
  compactHour,
  defaultClockFormat,
  defaultTemperatureUnit,
  formatClockTime,
  formatHour,
  formatTemperature,
  resolveUnits,
  unitFormatters,
} from '@/lib/units'

describe('locale defaults', () => {
  it('uses Fahrenheit only in Fahrenheit regions', () => {
    expect(defaultTemperatureUnit(['en-US'])).toBe('fahrenheit')
    expect(defaultTemperatureUnit(['en'])).toBe('fahrenheit') // "en" maximizes to en-Latn-US
    expect(defaultTemperatureUnit(['es-PR'])).toBe('fahrenheit')
    expect(defaultTemperatureUnit(['en-GB'])).toBe('celsius')
    expect(defaultTemperatureUnit(['en-AU'])).toBe('celsius')
    expect(defaultTemperatureUnit(['de-DE'])).toBe('celsius')
    expect(defaultTemperatureUnit(['ja'])).toBe('celsius')
    expect(defaultTemperatureUnit(['pt-BR'])).toBe('celsius')
  })

  it("follows the locale's customary clock", () => {
    expect(defaultClockFormat(['en-US'])).toBe('12h')
    expect(defaultClockFormat(['en-AU'])).toBe('12h')
    expect(defaultClockFormat(['en-GB'])).toBe('24h')
    expect(defaultClockFormat(['de-DE'])).toBe('24h')
    expect(defaultClockFormat(['ja-JP'])).toBe('24h')
  })

  it('skips malformed locale tags', () => {
    expect(defaultTemperatureUnit(['not a locale', 'fr-FR'])).toBe('celsius')
    expect(defaultTemperatureUnit([])).toBe('fahrenheit') // en-US
  })

  it('prefers the saved preference over the locale', () => {
    expect(resolveUnits(null, ['en-US'])).toEqual({ temperature: 'fahrenheit', clock: '12h' })
    expect(resolveUnits({ temperatureUnit: 'celsius' }, ['en-US'])).toEqual({
      temperature: 'celsius',
      clock: '12h',
    })
    expect(resolveUnits({ temperatureUnit: 'auto', clockFormat: 'auto' }, ['de-DE'])).toEqual({
      temperature: 'celsius',
      clock: '24h',
    })
    expect(resolveUnits({ clockFormat: '12h' }, ['de-DE'])).toEqual({
      temperature: 'celsius',
      clock: '12h',
    })
  })
})

describe('temperature', () => {
  it('converts and rounds only for display', () => {
    expect(celsiusToFahrenheit(100)).toBe(212)
    expect(formatTemperature(29, 'celsius')).toBe('29°C')
    expect(formatTemperature(29, 'fahrenheit')).toBe('84°F')
    expect(formatTemperature(20.5, 'celsius')).toBe('21°C')
    expect(formatTemperature(-0.4, 'celsius')).toBe('0°C')
    expect(formatTemperature(-17.9, 'fahrenheit')).toBe('0°F')
    expect(formatTemperature(Number.NaN, 'celsius')).toBe('--')
  })
})

describe('clock', () => {
  it('formats whole hours', () => {
    expect([0, 9, 12, 13, 20, 24].map(h => formatHour(h, '12h'))).toEqual([
      '12am',
      '9am',
      '12pm',
      '1pm',
      '8pm',
      '12am',
    ])
    expect([0, 9, 12, 13, 20, 24].map(h => formatHour(h, '24h'))).toEqual([
      '00:00',
      '09:00',
      '12:00',
      '13:00',
      '20:00',
      '24:00',
    ])
  })

  it('formats fractional times, rounding to the minute', () => {
    expect(formatClockTime(6.75, '12h')).toBe('6:45am')
    expect(formatClockTime(11.999, '12h')).toBe('12pm')
    expect(formatClockTime(12.5, '12h')).toBe('12:30pm')
    expect(formatClockTime(6.75, '24h')).toBe('06:45')
    expect(formatClockTime(17, '24h')).toBe('17:00')
  })

  it('has a compact form for the narrowest calendar lanes', () => {
    expect([6, 12, 21, 0].map(h => compactHour(h, '12h'))).toEqual(['6a', '12p', '9p', '12a'])
    expect(compactHour(10.5, '12h')).toBe('10:30a')
    expect([6, 21].map(h => compactHour(h, '24h'))).toEqual(['06', '21'])
    expect(compactHour(10.5, '24h')).toBe('10:30')
  })

  it('binds formatters to a set of units', () => {
    const f = unitFormatters({ temperature: 'celsius', clock: '24h' })
    expect([f.hour(7), f.time(7.25), f.compactHour(7), f.temp(21.4)]).toEqual([
      '07:00',
      '07:15',
      '07',
      '21°C',
    ])
  })
})

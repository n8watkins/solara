import { describe, expect, it } from 'vitest'
import { buildActivityShareText, parseActivityShareParams } from './share'

describe('shared activity parameters', () => {
  it('rejects incomplete and invalid shared plans', () => {
    expect(parseActivityShareParams(new URLSearchParams())).toBeNull()
    expect(parseActivityShareParams(new URLSearchParams('a=Run&city=Pasadena&date=Today&to=1'))).toBeNull()
    expect(parseActivityShareParams(new URLSearchParams('a=Run&city=Pasadena&date=Today&from=&to=1'))).toBeNull()
    expect(parseActivityShareParams(new URLSearchParams('a=Run&city=Pasadena&date=Today&from=8&to=8'))).toBeNull()
    expect(parseActivityShareParams(new URLSearchParams('a=Run&city=Pasadena&date=Today&from=-1&to=1'))).toBeNull()
    expect(parseActivityShareParams(new URLSearchParams('a=Run&city=Pasadena&date=Today&from=23&to=25'))).toBeNull()
  })

  it('parses a complete shared plan', () => {
    expect(parseActivityShareParams(new URLSearchParams('a=Run&icon=%F0%9F%8F%83&city=Pasadena&region=California&date=Today&from=7.5&to=8.5&uv=2.1'))).toEqual({
      activity: 'Run',
      icon: '🏃',
      city: 'Pasadena',
      region: 'California',
      date: 'Today',
      from: 7.5,
      to: 8.5,
      uv: '2.1',
    })
  })

  it('formats fractional shared windows as clock times', () => {
    expect(
      buildActivityShareText({
        activity: { id: 'run', name: 'Run', icon: '🏃', durationMins: 60, maxUV: 3, sunscreen: false },
        window: { from: 7.5, to: 8.5 },
        location: { lat: 34.1, lon: -118.1, city: 'Pasadena', region: 'California' },
        dateLabel: 'Today',
      }),
    ).toContain('7:30am–8:30am')
  })
})

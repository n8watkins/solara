import { describe, expect, it } from 'vitest'
import { formatDuration } from './duration'

describe('formatDuration', () => {
  it('writes minutes and hours one way everywhere (REVIEW9 QA L3)', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(90)).toBe('1 h 30 min')
    expect(formatDuration(167)).toBe('2 h 47 min')
    expect(formatDuration(44.6)).toBe('45 min')
    expect(formatDuration(-3)).toBe('0 min')
  })
})

import { describe, expect, it } from 'vitest'
import { formatDuration } from './duration'

describe('formatDuration', () => {
  it('writes minutes and hours one way everywhere (REVIEW9 QA L3)', () => {
    expect(formatDuration(0)).toBe('0\u00a0min')
    expect(formatDuration(45)).toBe('45\u00a0min')
    expect(formatDuration(60)).toBe('1\u00a0h')
    expect(formatDuration(90)).toBe('1\u00a0h 30\u00a0min')
    expect(formatDuration(167)).toBe('2\u00a0h 47\u00a0min')
    expect(formatDuration(44.6)).toBe('45\u00a0min')
    expect(formatDuration(-3)).toBe('0\u00a0min')
  })
})

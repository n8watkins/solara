import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { finiteNumber, isPlainRecord, looseRecord, record } from './schema'

describe('schema building blocks', () => {
  it('finiteNumber rejects NaN and both infinities', () => {
    expect(v.is(finiteNumber, 1.5)).toBe(true)
    for (const value of [NaN, Infinity, -Infinity, '1', null]) {
      expect(v.is(finiteNumber, value)).toBe(false)
    }
  })

  it('record accepts only plain objects and drops unknown keys', () => {
    const schema = record({ a: v.optional(v.string()) })
    expect(v.parse(schema, { a: 'x', b: 1 })).toEqual({ a: 'x' })
    expect(v.is(schema, [])).toBe(false)
    expect(v.is(schema, null)).toBe(false)
    expect(isPlainRecord([])).toBe(false)
  })

  it('looseRecord keeps unknown keys and rejects arrays', () => {
    const schema = looseRecord({ a: v.string() })
    expect(v.parse(schema, { a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 })
    expect(v.is(schema, Object.assign([], { a: 'x' }))).toBe(false)
  })
})

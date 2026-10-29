import { describe, expect, it } from 'vitest'
import { IMPORTED_EVENT_LIMITS } from './events'
import {
  KEY_INDEX_CAPS,
  KEY_INDEX_LIST_LIMITS,
  KEY_INDEX_PUT_BATCH,
  chunks,
  fitToCap,
  listedKeysOf,
  reconcilePlan,
} from './key-lists'
import { SCHEDULED_LIMITS } from './scheduled'

const key = (item: { key: string }) => item.key
const items = (...keys: string[]) => keys.map(k => ({ key: k }))

describe('the key-list caps', () => {
  it('come from each collection limits', () => {
    expect(KEY_INDEX_CAPS).toEqual({
      events: IMPORTED_EVENT_LIMITS.maxStored,
      scheduled: SCHEDULED_LIMITS.maxStored,
    })
    expect(KEY_INDEX_LIST_LIMITS).toEqual({
      events: IMPORTED_EVENT_LIMITS.listLimit,
      scheduled: SCHEDULED_LIMITS.listLimit,
    })
    // A batch holds its records plus the list document, under Firestore's 500 writes.
    expect(KEY_INDEX_PUT_BATCH + 1).toBeLessThanOrEqual(500)
  })
})

describe('listedKeysOf', () => {
  it('reads the ids map and tolerates a missing or odd document', () => {
    expect([...listedKeysOf({ ids: { a: true, b: true } })]).toEqual(['a', 'b'])
    expect(listedKeysOf(undefined).size).toBe(0)
    expect(listedKeysOf(null).size).toBe(0)
    expect(listedKeysOf({ ids: 'a' }).size).toBe(0)
    expect(listedKeysOf({ ids: null }).size).toBe(0)
  })
})

describe('chunks', () => {
  it('splits into equal chunks with a shorter last one', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([], 3)).toEqual([])
  })
})

describe('fitToCap', () => {
  it('always fits rewrites, then new keys in order until the list is full', () => {
    const { fit, refused } = fitToCap(items('x', 'a', 'b', 'c'), key, new Set(['x']), 3)
    expect(fit.map(key)).toEqual(['x', 'a', 'b'])
    expect(refused.map(key)).toEqual(['c'])
  })

  it('fits a rewrite even when the list is already full', () => {
    const { fit, refused } = fitToCap(items('a', 'z'), key, new Set(['a', 'b']), 2)
    expect(fit.map(key)).toEqual(['a'])
    expect(refused.map(key)).toEqual(['z'])
  })

  it('counts a repeated new key once', () => {
    const { fit, refused } = fitToCap(items('a', 'a', 'b'), key, new Set(), 1)
    expect(fit.map(key)).toEqual(['a', 'a'])
    expect(refused.map(key)).toEqual(['b'])
  })
})

describe('reconcilePlan', () => {
  it('drops gone keys and lists unlisted records within the cap', () => {
    const plan = reconcilePlan(new Set(['a', 'gone']), new Set(['a', 'b', 'c', 'd']), 3)
    expect(plan).toEqual({ gone: ['gone'], kept: ['a'], unlisted: ['b', 'c'] })
  })

  it('lists nothing more when the kept keys already fill the cap', () => {
    const plan = reconcilePlan(new Set(['a', 'b']), new Set(['a', 'b', 'c']), 2)
    expect(plan).toEqual({ gone: [], kept: ['a', 'b'], unlisted: [] })
  })
})

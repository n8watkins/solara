import { describe, expect, it, vi } from 'vitest'
import { pruneEndedRecords } from './retention'

describe('pruneEndedRecords', () => {
  it('prunes events and scheduled activities for the account, at the given time', async () => {
    const events = vi.fn(async () => 3)
    const scheduled = vi.fn(async () => 1)
    expect(await pruneEndedRecords('u1', 1_000, { events, scheduled })).toEqual({
      events: 3,
      scheduled: 1,
    })
    expect(events).toHaveBeenCalledWith('u1', 1_000)
    expect(scheduled).toHaveBeenCalledWith('u1', 1_000)
  })

  it('one failing prune does not stop the other', async () => {
    const scheduled = vi.fn(async () => 2)
    const outcome = await pruneEndedRecords('u1', 1_000, {
      events: async () => {
        throw new Error('offline')
      },
      scheduled,
    })
    expect(outcome.events).toEqual(new Error('offline'))
    expect(outcome.scheduled).toBe(2)
    expect(scheduled).toHaveBeenCalledOnce()
  })

  it('turns a non-Error rejection into an Error', async () => {
    const outcome = await pruneEndedRecords('u1', 1_000, {
      events: async () => 0,
      scheduled: () => Promise.reject('denied'),
    })
    expect(outcome).toEqual({ events: 0, scheduled: new Error('denied') })
  })
})

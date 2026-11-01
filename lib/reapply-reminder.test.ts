// The reminder record's writes are spaced as firestore.rules require (REVIEW9 SEC9 M1):
// at most one every REAPPLY_REMINDER_WRITE_GAP_MS, each with its write stamp. The rules
// themselves are tested on the emulator (functions/test/emulator/firestore.rules.test.js,
// 'reapply reminder record'), and the flow end to end in
// tests/e2e/signed-in/reapply-reminder.e2e.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REAPPLY_REMINDER_WRITE_GAP_MS, type ReapplyTimer } from '@solara/core/reapply'

const mocks = vi.hoisted(() => ({
  commits: [] as { at: number; ops: { op: string; path: string; data?: unknown }[] }[],
  deletes: [] as { at: number; path: string }[],
  /** Commits refused with permission-denied before this many have been refused. */
  refuse: 0,
}))

vi.mock('./firebase', () => ({ loadFirebase: async () => ({ db: {} }) }))
vi.mock('./plans', () => ({ alertsLaunched: () => true }))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
  serverTimestamp: () => 'server-time',
  deleteDoc: async (ref: { path: string }) => {
    mocks.deletes.push({ at: Date.now(), path: ref.path })
  },
  writeBatch: () => {
    const ops: { op: string; path: string; data?: unknown }[] = []
    const batch = {
      set: (ref: { path: string }, data: unknown) => {
        ops.push({ op: 'set', path: ref.path, data })
        return batch
      },
      commit: async () => {
        if (mocks.refuse > 0) {
          mocks.refuse--
          throw Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
          })
        }
        mocks.commits.push({ at: Date.now(), ops })
      },
    }
    return batch
  },
}))

const { cancelReapplyReminder, scheduleReapplyReminder } = await import('./reapply-reminder')

const UID = 'u1'
/** Each test starts an hour after the last, as the tab's spacing outlives a test. */
let start = Date.parse('2026-10-29T18:00:00Z')

function timer(mode: 'standard' | 'water' = 'standard', appliedAt = Date.now()): ReapplyTimer {
  return { startedAt: appliedAt, appliedAt, mode }
}

/** The mode of each committed reminder, in order. */
const committedModes = () =>
  mocks.commits.map(commit => (commit.ops[0]?.data as { mode: string }).mode)

beforeEach(() => {
  start += 60 * 60_000
  vi.useFakeTimers({ now: start })
  mocks.commits.length = 0
  mocks.deletes.length = 0
  mocks.refuse = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleReapplyReminder', () => {
  it('writes the record and its write stamp in one batch', async () => {
    const { committed } = await scheduleReapplyReminder(UID, timer())
    await vi.advanceTimersByTimeAsync(0)
    await committed
    expect(mocks.commits).toHaveLength(1)
    const [reminder, stamp] = mocks.commits[0]!.ops
    expect(reminder).toMatchObject({ op: 'set', path: `users/${UID}/reminders/reapply` })
    expect(reminder!.data).toMatchObject({
      mode: 'standard',
      id: expect.stringMatching(/^[a-f0-9]{32}$/),
    })
    expect(stamp).toEqual({
      op: 'set',
      path: `users/${UID}/reminders/writes`,
      data: { writtenAt: 'server-time' },
    })
  })

  it('spaces a quick Start, "I reapplied" and "Swimming" by the rules’ gap, sending only the latest', async () => {
    const first = await scheduleReapplyReminder(UID, timer())
    await vi.advanceTimersByTimeAsync(0)
    await first.committed
    const sentAt = Date.now()
    await vi.advanceTimersByTimeAsync(1_000)
    const reapplied = await scheduleReapplyReminder(UID, timer())
    await vi.advanceTimersByTimeAsync(1_000)
    const swimming = await scheduleReapplyReminder(UID, timer('water'))
    let settled = 0
    void reapplied.committed.then(() => settled++)
    void swimming.committed.then(() => settled++)
    await vi.advanceTimersByTimeAsync(REAPPLY_REMINDER_WRITE_GAP_MS - 3_000)
    expect(mocks.commits).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(committedModes()).toEqual(['standard', 'water'])
    expect(mocks.commits[1]!.at - sentAt).toBeGreaterThan(REAPPLY_REMINDER_WRITE_GAP_MS)
    expect(settled).toBe(2)
  })

  it('sends once more after the gap when another tab or device just wrote', async () => {
    mocks.refuse = 1
    const { committed } = await scheduleReapplyReminder(UID, timer())
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.commits).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(REAPPLY_REMINDER_WRITE_GAP_MS + 1_000)
    await committed
    expect(mocks.commits).toHaveLength(1)
  })

  it('gives up after one more refusal', async () => {
    mocks.refuse = 2
    const { committed } = await scheduleReapplyReminder(UID, timer())
    const outcome = committed.catch((error: { code?: string }) => error.code)
    await vi.advanceTimersByTimeAsync(REAPPLY_REMINDER_WRITE_GAP_MS + 1_000)
    expect(await outcome).toBe('permission-denied')
    expect(mocks.commits).toHaveLength(0)
  })
})

describe('cancelReapplyReminder', () => {
  it('deletes at once and drops a write still waiting for the gap', async () => {
    const first = await scheduleReapplyReminder(UID, timer())
    await vi.advanceTimersByTimeAsync(0)
    await first.committed
    const waiting = await scheduleReapplyReminder(UID, timer('water'))
    await vi.advanceTimersByTimeAsync(500)
    await cancelReapplyReminder(UID)
    expect(mocks.deletes).toEqual([{ at: Date.now(), path: `users/${UID}/reminders/reapply` }])
    await waiting.committed
    await vi.advanceTimersByTimeAsync(REAPPLY_REMINDER_WRITE_GAP_MS * 2)
    expect(committedModes()).toEqual(['standard'])
  })
})

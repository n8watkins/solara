import { describe, expect, it } from 'vitest'
import {
  dailyTotals,
  entryEstimate,
  exposureForAreas,
  isVitaminDEntry,
  keptEntries,
  LOG_MAX_ENTRIES,
  logExport,
  parseLog,
  startHour,
  storedLog,
  type VitaminDEntry,
} from './vitamin-d-log'
import { estimateSession, VITD_DOSE_IU } from './vitamin-d'
import { activityBodyAreas } from './sunscreen'

const TODAY = '2026-06-15'

function entry(overrides: Partial<VitaminDEntry> = {}): VitaminDEntry {
  return {
    id: 'a1',
    date: TODAY,
    start: '10:00',
    minutes: 9,
    exposure: 'arms-legs',
    sunscreen: false,
    skinType: 'fair',
    uvSource: 'forecast',
    uv: [{ minutes: 9, uv: 5 }],
    ...overrides,
  }
}

describe('entries', () => {
  it('accepts a well-formed entry and refuses broken ones', () => {
    expect(isVitaminDEntry(entry())).toBe(true)
    expect(isVitaminDEntry(entry({ activityId: 'run', label: 'Running' }))).toBe(true)
    for (const bad of [
      { date: '2026-13-01' },
      { start: '24:00' },
      { minutes: 0 },
      { minutes: 601 },
      { minutes: 9.5 },
      { exposure: 'naked' },
      { skinType: 'pale' },
      { uvSource: 'guess' },
      { uv: [] },
      { uv: [{ minutes: 9, uv: Number.POSITIVE_INFINITY }] },
      { id: 'has space' },
      { label: 'x'.repeat(81) },
    ]) {
      expect(isVitaminDEntry({ ...entry(), ...bad }), JSON.stringify(bad)).toBe(false)
    }
    expect(isVitaminDEntry(null)).toBe(false)
    expect(isVitaminDEntry([entry()])).toBe(false)
  })

  it("estimates an entry with the card's calculation", () => {
    expect(entryEstimate(entry()).iu).toBeCloseTo(VITD_DOSE_IU, 6)
    expect(entryEstimate(entry({ sunscreen: true, exposure: 'swimwear' }))).toEqual(
      estimateSession({
        spans: [{ minutes: 9, uv: 5 }],
        skinType: 'fair',
        exposure: 'swimwear',
        sunscreen: true,
      }),
    )
  })

  it('reads a start time as a fractional hour', () => {
    expect(startHour('09:30')).toBe(9.5)
    expect(startHour('00:00')).toBe(0)
    expect(startHour('23:45')).toBe(23.75)
  })
})

describe('keeping and pruning', () => {
  it('drops bad entries one by one and keeps the rest, newest first', () => {
    const kept = keptEntries(
      [
        entry({ id: 'old', date: '2026-06-01' }),
        { broken: true },
        entry({ id: 'late', start: '15:00' }),
        entry({ id: 'early', start: '08:00' }),
      ],
      TODAY,
    )
    expect(kept.map(e => e.id)).toEqual(['late', 'early', 'old'])
  })

  it('prunes entries dated more than a year before today', () => {
    const kept = keptEntries(
      [entry({ id: 'year', date: '2025-06-15' }), entry({ id: 'older', date: '2025-06-14' })],
      TODAY,
    )
    expect(kept.map(e => e.id)).toEqual(['year'])
  })

  it('keeps at most the newest LOG_MAX_ENTRIES, once per id', () => {
    const many = Array.from({ length: LOG_MAX_ENTRIES + 5 }, (_, i) =>
      entry({ id: `e${i}`, date: '2026-06-01', start: `${String(i % 24).padStart(2, '0')}:00` }),
    )
    expect(keptEntries([...many, entry({ id: 'e0' })], TODAY)).toHaveLength(LOG_MAX_ENTRIES)
    expect(keptEntries([entry(), entry()], TODAY)).toHaveLength(1)
  })

  it('drops keys an entry does not have', () => {
    const [kept] = keptEntries([{ ...entry(), extra: 'x' }], TODAY)
    expect(kept).toEqual(entry())
  })

  it('reads only a stored log', () => {
    expect(parseLog(storedLog([entry()]), TODAY)).toEqual([entry()])
    expect(parseLog(null, TODAY)).toEqual([])
    expect(parseLog({ entries: 'no' }, TODAY)).toEqual([])
    expect(parseLog([entry()], TODAY)).toEqual([])
    expect(storedLog([])).toEqual({ version: 1, entries: [] })
  })
})

describe('dailyTotals', () => {
  it('totals the 7 days ending today, oldest first', () => {
    const totals = dailyTotals(
      [
        entry({ id: 'a' }),
        entry({ id: 'b', start: '11:00' }),
        entry({ id: 'c', date: '2026-06-09' }),
        entry({ id: 'd', date: '2026-06-08' }),
      ],
      TODAY,
    )
    expect(totals.map(t => t.date)).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ])
    expect(totals[0]).toMatchObject({ sessions: 1, iu: expect.closeTo(1000, 6) })
    expect(totals[6]).toMatchObject({ sessions: 2, iu: expect.closeTo(2000, 6) })
    expect(totals.slice(1, 6).every(t => t.iu === 0 && t.sessions === 0)).toBe(true)
  })
})

describe('logExport', () => {
  it('writes each entry with its rounded estimate', () => {
    const file = logExport([entry({ minutes: 40, uv: [{ minutes: 40, uv: 5 }] })])
    expect(file.about).toMatch(/estimate/)
    expect(file.entries[0]).toMatchObject({
      id: 'a1',
      estimatedIu: 3350,
      shareOfBurnTime: 1.33,
    })
  })
})

describe('exposureForAreas', () => {
  it("follows the clothing an activity's preset implies", () => {
    expect(exposureForAreas(activityBodyAreas('swim'))).toBe('swimwear')
    expect(exposureForAreas(activityBodyAreas('run'))).toBe('arms-legs')
    expect(exposureForAreas(activityBodyAreas('coffee'))).toBe('face-arms')
    expect(exposureForAreas(activityBodyAreas(undefined))).toBe('arms-legs')
    expect(exposureForAreas(['face'])).toBe('face-hands')
  })
})

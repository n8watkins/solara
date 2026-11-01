// The vitamin D log's entries (ROADMAP item 48): their shape and checks, pruning, and the
// daily totals, shared by the web app (lib/vitamin-d-log.ts keeps them in the browser) and
// a future native client. Each session's estimate comes from vitamin-d.ts, the same
// calculation as the dashboard's card, and is never stored: an entry keeps only what the
// person entered (and the forecast's UV at the time), so a corrected model corrects every
// old session too. Loaded only with the log, so Valibot stays out of the first load.
import * as v from 'valibot'
import { SKIN_TYPES, type SkinType } from './recommendation'
import { finiteNumber, record } from './schema'
import {
  estimateSession,
  roundIu,
  SKIN_EXPOSURES,
  type SessionEstimate,
  type SkinExposure,
  type UvSpan,
} from './vitamin-d'
import { shiftIsoDate } from './zoned-time'

/** Entries dated more than this many days before today are pruned. */
export const LOG_KEEP_DAYS = 365

/** The most entries kept; the oldest go first (a year of about three sessions a day). */
export const LOG_MAX_ENTRIES = 1000

/** The longest session, minutes. */
export const SESSION_MAX_MINUTES = 600

/** The highest UV a person may enter. */
export const ENTERED_UV_MAX = 15

/** A stored version, so a later format can read this one. */
export const LOG_VERSION = 1

/** One session in the sun. */
export interface VitaminDEntry {
  id: string
  /** The day, YYYY-MM-DD, on the forecast place's calendar. */
  date: string
  /** Start time, HH:MM, on the place's clock. */
  start: string
  minutes: number
  exposure: SkinExposure
  sunscreen: boolean
  /** The skin type when it was logged, so a later change does not rewrite it. */
  skinType: SkinType
  /** Where the UV came from: the forecast's hours, or the person's own figure. */
  uvSource: 'forecast' | 'entered'
  /** The session's minutes at each UV (one span for an entered UV). */
  uv: UvSpan[]
  /** The activity it was logged from with "Log it", if any, and its name then. */
  activityId?: string
  label?: string
}

const isoDate = v.pipe(v.string(), v.regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/))
const clockTime = v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/))

const span = record({
  minutes: v.pipe(finiteNumber, v.minValue(0), v.maxValue(SESSION_MAX_MINUTES)),
  uv: v.pipe(finiteNumber, v.minValue(0), v.maxValue(25)),
})

const EntrySchema = record({
  id: v.pipe(v.string(), v.regex(/^[\w-]{1,40}$/)),
  date: isoDate,
  start: clockTime,
  minutes: v.pipe(finiteNumber, v.integer(), v.minValue(1), v.maxValue(SESSION_MAX_MINUTES)),
  exposure: v.picklist(SKIN_EXPOSURES),
  sunscreen: v.boolean(),
  skinType: v.picklist(SKIN_TYPES),
  uvSource: v.picklist(['forecast', 'entered']),
  uv: v.pipe(v.array(span), v.minLength(1), v.maxLength(30)),
  activityId: v.optional(v.pipe(v.string(), v.maxLength(100))),
  label: v.optional(v.pipe(v.string(), v.maxLength(80))),
}) satisfies v.GenericSchema<unknown, VitaminDEntry>

/** Whether `value` is a well-formed entry. */
export function isVitaminDEntry(value: unknown): value is VitaminDEntry {
  return v.is(EntrySchema, value)
}

/** Newest first: by date, then start time. */
function newestFirst(a: VitaminDEntry, b: VitaminDEntry): number {
  return b.date === a.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date)
}

/**
 * The entries kept on `today`: well-formed ones (others are dropped one by one, never the
 * whole log), none dated more than LOG_KEEP_DAYS before today, at most LOG_MAX_ENTRIES,
 * one per id, newest first.
 */
export function keptEntries(entries: readonly unknown[], today: string): VitaminDEntry[] {
  const oldest = shiftIsoDate(today, -LOG_KEEP_DAYS)
  const seen = new Set<string>()
  return entries
    .filter((entry): entry is VitaminDEntry => {
      if (!isVitaminDEntry(entry) || entry.date < oldest || seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    .map(entry => v.parse(EntrySchema, entry))
    .sort(newestFirst)
    .slice(0, LOG_MAX_ENTRIES)
}

/** The entries from a stored log (`{ version, entries }`), or none when it is not one. */
export function parseLog(raw: unknown, today: string): VitaminDEntry[] {
  if (typeof raw !== 'object' || raw === null || !('entries' in raw)) return []
  const { entries } = raw as { entries: unknown }
  return Array.isArray(entries) ? keptEntries(entries, today) : []
}

/** What is stored. */
export function storedLog(entries: readonly VitaminDEntry[]) {
  return { version: LOG_VERSION, entries }
}

/** An entry's estimate, from the same calculation as the dashboard's card. */
export function entryEstimate(entry: VitaminDEntry): SessionEstimate {
  return estimateSession({
    spans: entry.uv,
    skinType: entry.skinType,
    exposure: entry.exposure,
    sunscreen: entry.sunscreen,
  })
}

/** One day's estimated total. */
export interface DayTotal {
  date: string
  iu: number
  sessions: number
}

/** The estimated total of each of the `days` days ending today, oldest first. */
export function dailyTotals(
  entries: readonly VitaminDEntry[],
  today: string,
  days = 7,
): DayTotal[] {
  const totals = Array.from({ length: days }, (_, i) => ({
    date: shiftIsoDate(today, i - days + 1),
    iu: 0,
    sessions: 0,
  }))
  const byDate = new Map(totals.map(total => [total.date, total]))
  for (const entry of entries) {
    const total = byDate.get(entry.date)
    if (!total) continue
    total.iu += entryEstimate(entry).iu
    total.sessions += 1
  }
  return totals
}

/** A start time (HH:MM) as a fractional hour (9:30 is 9.5). */
export function startHour(start: string): number {
  const [hours, minutes] = start.split(':').map(Number)
  return (hours ?? 0) + (minutes ?? 0) / 60
}

/**
 * The log as the data download writes it: each entry as stored with its estimate beside
 * it, rounded as the log shows it, and what the numbers are.
 */
export function logExport(entries: readonly VitaminDEntry[]) {
  return {
    about:
      'Vitamin D log, kept only in this browser. Each estimate is a rough model (about 1,000 IU for 0.3 of a burn dose on arms and legs; Holick, Am J Clin Nutr 2004), not a measurement.',
    entries: entries.map(entry => {
      const estimate = entryEstimate(entry)
      return {
        ...entry,
        estimatedIu: roundIu(estimate.iu),
        shareOfBurnTime: Math.round(estimate.burnShare * 100) / 100,
      }
    }),
  }
}

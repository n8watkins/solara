import { describe, expect, it } from 'vitest'
import { PREFS_SCHEMA_VERSION } from '@solara/core/prefs-rules'
import { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES } from '@solara/core/tiers'
import { asGuestPrefs } from './guest'
import { defaultPrefs } from './local-prefs'
import { normalizePrefs } from './prefs'
import { isStoredGuestPlan } from './stored-guest-plan'
import type { UserPreferences } from './types'

// isStoredGuestPlan lets a returning guest's plan skip the preferences schema (ROADMAP
// item 52). It is only safe if it accepts nothing the schema would change, and only
// useful if it accepts what the app writes. Both are checked here against the schema
// itself, on plans the app writes and on many plans changed in every field.

/** What saveGuestPrefs keeps for `raw`, as read back from storage. */
function stored(raw: unknown): unknown {
  const prefs = normalizePrefs(raw)
  return prefs && JSON.parse(JSON.stringify(asGuestPrefs(prefs)))
}

/** Whether the schema returns `raw` unchanged: the only plans the check may accept. */
function unchangedBySchema(raw: unknown): boolean {
  return deepEqual(stored(raw), raw)
}

/** Whether two JSON values are the same (any key order). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(
    key =>
      Object.hasOwn(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

const LA = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' }

/** Plans the app writes: setup's answers and every setting a guest can change. */
const WRITTEN: UserPreferences[] = [
  defaultPrefs(LA),
  { ...defaultPrefs({ ...LA, timezone: 'America/Los_Angeles' }), onboardingComplete: true },
  {
    ...defaultPrefs({ lat: -33.87, lon: 151.21, city: 'Sydney', region: '' }),
    skinType: 'very-fair',
    sunscreen: true,
    onboardingComplete: true,
    activities: [
      {
        id: 'custom_1',
        name: 'Surf',
        icon: '🏄',
        durationMins: 90,
        maxUV: 6,
        sunscreen: true,
        custom: true,
        preferredHours: { from: 6, to: 10 },
        timePreference: 'sunniest',
        daysOfWeek: [0, 6],
        cloudSensitive: true,
        shade: 'partial',
        surface: 'water',
        avoidRain: false,
        maxFeelsLikeC: 32.5,
      },
    ],
    calendarHours: { from: 6, to: 22 },
    showSunPath: false,
    hiddenActivitySuggestionIds: PRESET_ACTIVITIES.slice(0, 2).map(preset => preset.id),
    collapsedActivityCategories: ACTIVITY_CATEGORIES.slice(0, 1).map(category => category.name),
    notificationHour: 5,
    uvAlertThreshold: 0,
    quietHours: { from: 22, to: 6 },
    eventHeadsUp: false,
    dailyUv: true,
    temperatureUnit: 'celsius',
    clockFormat: '24h',
    language: 'es',
    deviceLanguage: 'es',
  },
  {
    ...defaultPrefs(LA),
    activities: [{ ...PRESET_ACTIVITIES[0]!, sunscreen: false, maxFeelsLikeC: null } as never],
  },
  {
    ...defaultPrefs(LA),
    activities: [
      {
        id: 'a1',
        name: 'Garden',
        icon: '🌱',
        durationMins: 5,
        maxUV: 0,
        sunscreen: false,
        custom: true,
      },
    ],
  },
]

/** A deterministic pseudo-random source (mulberry32), so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Values that break each kind of field in a different way. */
const ODD: unknown[] = [
  null,
  true,
  false,
  0,
  -1,
  0.5,
  1.234,
  3,
  5,
  7,
  11,
  12,
  23,
  24,
  25,
  99,
  1e9,
  '',
  ' ',
  ' x ',
  'x',
  'fair',
  'anonymous',
  'paid',
  'custom_x',
  'latest',
  'earliest',
  'partial',
  'water',
  'es',
  'auto',
  'UTC',
  'Not a zone!',
  'x'.repeat(130),
  [],
  [1, 0],
  [0, 1],
  [0, 1, 2, 3, 4, 5, 6],
  {},
  { from: 6, to: 10 },
  { from: 10, to: 6 },
  { from: 6.5, to: 10 },
]

type Path = (string | number)[]

/** Every field and list element in `value`, at any depth, with the path to it. */
function paths(value: unknown, at: Path = []): Path[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...at, Array.isArray(value) ? Number(key) : key]
    return [path, ...paths(child, path)]
  })
}

/** A copy of `value` with what is at `path` replaced by `update` (removed for undefined). */
function setAt(value: unknown, path: Path, update: (old: unknown) => unknown): unknown {
  const [key, ...rest] = path as [string | number, ...Path]
  if (Array.isArray(value)) {
    const copy = [...value]
    const replaced = rest.length
      ? setAt(copy[key as number], rest, update)
      : update(copy[key as number])
    if (replaced === undefined) copy.splice(key as number, 1)
    else copy[key as number] = replaced
    return copy
  }
  const copy = { ...(value as Record<string, unknown>) }
  const replaced = rest.length ? setAt(copy[key], rest, update) : update(copy[key])
  if (replaced === undefined) delete copy[key]
  else copy[key] = replaced
  return copy
}

/** Numbers at and next to the bounds of the plan's number fields. */
const NUMBERS = [
  -1, 0, 0.5, 1, 4, 4.5, 5, 6, 10, 11, 11.5, 12, 14.9, 15, 22.25, 23, 24, 25, 50, 50.01,
]

/** Values to put in place of `old`: of its own kind mostly, any kind sometimes. */
function replacements(old: unknown): unknown[] {
  if (typeof old === 'number') {
    return [old - 1, old + 1, old + 0.5, old + 0.05, -old || -1, ...NUMBERS]
  }
  if (typeof old === 'string') {
    return [` ${old}`, `${old} `, old.repeat(40), '', 'earliest', 'auto', 'free', 'custom_x']
  }
  if (typeof old === 'boolean') return [!old, 'true', 1]
  if (Array.isArray(old)) {
    return [[...old].reverse(), [...old, ...old], old.length ? [old[0], old[0]] : [1], []]
  }
  return []
}

/** `value` with one field anywhere inside it changed, removed, or one added. */
function mutate(value: unknown, next: () => number): unknown {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  const all = paths(value)
  const roll = next()
  if (roll < 0.1 || !all.length) {
    const target = pick([[], ...all.filter(path => typeof path.at(-1) === 'string')])
    const parent = target.length && next() < 0.5 ? target.slice(0, -1) : target
    const key = pick(['profiles', 'groupMode', 'upgradeInterest', 'custom', 'timezone', 'x'])
    const add = (old: unknown) =>
      old && typeof old === 'object' && !Array.isArray(old)
        ? { ...old, [key]: pick([true, false, ...ODD]) }
        : old
    return parent.length ? setAt(value, parent, add) : add(value)
  }
  const path = pick(all)
  if (roll < 0.2) return setAt(value, path, () => undefined)
  return setAt(value, path, old => {
    const own = replacements(old)
    return own.length && next() < 0.7 ? pick(own) : pick(ODD)
  })
}

describe('isStoredGuestPlan', () => {
  it('accepts every plan the app writes, as saveGuestPrefs keeps it', () => {
    for (const plan of WRITTEN) {
      const kept = stored(plan)
      expect(kept).not.toBeNull()
      expect(isStoredGuestPlan(kept), JSON.stringify(kept)).toBe(true)
    }
  })

  it('accepts only plans the schema returns unchanged, and every such plan the schema writes', () => {
    const next = random(52)
    let accepted = 0
    for (let run = 0; run < 30_000; run++) {
      // Half the runs change the plan with every optional setting.
      let plan: unknown = stored(WRITTEN[run % 2 ? 2 : run % WRITTEN.length])
      plan = mutate(plan, next)
      if (next() < 0.2) plan = mutate(plan, next)
      const ok = isStoredGuestPlan(plan)
      if (ok) {
        accepted++
        expect(
          unchangedBySchema(plan),
          `accepted a plan the schema changes: ${JSON.stringify(plan)}`,
        ).toBe(true)
      }
      // What the schema writes for this plan is read back without it next time (unless a
      // newer version of Solara wrote it, which loadGuestPrefs never rewrites).
      const repaired = stored(plan) as UserPreferences | null
      if (repaired?.schemaVersion === PREFS_SCHEMA_VERSION && unchangedBySchema(repaired)) {
        expect(isStoredGuestPlan(repaired), JSON.stringify(repaired)).toBe(true)
      }
    }
    // Enough of the changed plans stay valid for the first property to mean something.
    expect(accepted).toBeGreaterThan(1_000)
    // 30,000 plans take about two seconds; a busy machine may take longer.
  }, 30_000)

  it('rejects anything that is not a plan object', () => {
    for (const value of [null, undefined, 'plan', 42, [], [stored(WRITTEN[0])]]) {
      expect(isStoredGuestPlan(value)).toBe(false)
    }
  })
})

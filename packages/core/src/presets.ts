// The preset activities, by category, with their names in the page's language. tiers.ts
// re-exports them; preset-names.ts lists their ids and category names alone, for code
// that only checks them (presets.test.ts keeps the two the same).
import type { Activity } from './prefs'
import m from './messages/plans'

export interface PresetCategory {
  /** The category's stable name, kept with collapsed categories (English). */
  name: string
  /** The name shown, in the page's language. */
  readonly label: string
  emoji: string
  activities: Omit<Activity, 'sunscreen' | 'custom'>[]
}

type Preset = PresetCategory['activities'][number]

/** A preset activity whose name reads in the page's language (plans messages). */
function preset(id: keyof typeof m, fields: Omit<Preset, 'id' | 'name'>): Preset {
  return Object.defineProperty({ id, ...fields }, 'name', {
    get: () => m[id],
    enumerable: true,
  }) as Preset
}

export const ACTIVITY_CATEGORIES: PresetCategory[] = [
  {
    name: 'Running & cycling',
    get label() {
      return m.categoryRunning
    },
    emoji: '🏃',
    activities: [
      preset('run', { icon: '🏃', durationMins: 45, maxUV: 4 }),
      preset('jog', { icon: '🏃', durationMins: 30, maxUV: 5 }),
      preset('cycle', { icon: '🚴', durationMins: 60, maxUV: 4 }),
      preset('mtb', { icon: '🚵', durationMins: 90, maxUV: 3 }),
      preset('sprint', { icon: '💨', durationMins: 20, maxUV: 6 }),
    ],
  },
  {
    name: 'Water sports',
    get label() {
      return m.categoryWater
    },
    emoji: '🏊',
    activities: [
      preset('swim', { icon: '🏊', durationMins: 60, maxUV: 3 }),
      preset('surf', { icon: '🏄', durationMins: 90, maxUV: 3 }),
      preset('kayak', { icon: '🚣', durationMins: 60, maxUV: 3 }),
      preset('paddle', { icon: '🛶', durationMins: 60, maxUV: 3 }),
    ],
  },
  {
    name: 'Outdoor leisure',
    get label() {
      return m.categoryLeisure
    },
    emoji: '🧺',
    activities: [
      preset('walk', { icon: '🚶', durationMins: 30, maxUV: 5 }),
      preset('hike', { icon: '🥾', durationMins: 120, maxUV: 3 }),
      preset('picnic', { icon: '🧺', durationMins: 90, maxUV: 4 }),
      preset('garden', { icon: '🌱', durationMins: 60, maxUV: 3 }),
      preset('photo', { icon: '📸', durationMins: 90, maxUV: 4 }),
      preset('read', { icon: '📖', durationMins: 60, maxUV: 5 }),
    ],
  },
  {
    name: 'Sports & courts',
    get label() {
      return m.categorySports
    },
    emoji: '🎾',
    activities: [
      preset('golf', { icon: '⛳', durationMins: 240, maxUV: 2 }),
      preset('tennis', { icon: '🎾', durationMins: 60, maxUV: 4 }),
      preset('soccer', { icon: '⚽', durationMins: 90, maxUV: 3 }),
      preset('baseball', { icon: '⚾', durationMins: 120, maxUV: 3 }),
      preset('yoga', { icon: '🧘', durationMins: 45, maxUV: 4 }),
      preset('bball', { icon: '🏀', durationMins: 60, maxUV: 4 }),
    ],
  },
  {
    name: 'Quick breaks',
    get label() {
      return m.categoryBreaks
    },
    emoji: '☀️',
    activities: [
      preset('break', { icon: '☀️', durationMins: 5, maxUV: 8 }),
      preset('lunch', { icon: '🥗', durationMins: 30, maxUV: 5 }),
      preset('coffee', { icon: '☕', durationMins: 15, maxUV: 6 }),
      preset('dog', { icon: '🐕', durationMins: 30, maxUV: 5 }),
    ],
  },
]

// Flat list for preference migrations and backwards compatibility.
// Each keeps its name's getter, so the name reads in the page's language when used.
export const PRESET_ACTIVITIES = ACTIVITY_CATEGORIES.flatMap(c =>
  c.activities.map(a =>
    Object.defineProperty({ ...a, sunscreen: false as const }, 'name', {
      get: () => a.name,
      enumerable: true,
    }),
  ),
)

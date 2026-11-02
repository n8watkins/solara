// The preset activities' ids and their categories' stable names, without the catalog
// (./presets.ts) or its words, for code that only checks a stored list against them (the
// web app's stored plan check, lib/stored-plan.ts, on a guest's first screen; ROADMAP
// item 52). presets.test.ts keeps them the same as the catalog.

export const PRESET_ACTIVITY_IDS: readonly string[] = Object.freeze([
  'run',
  'jog',
  'cycle',
  'mtb',
  'sprint',
  'swim',
  'surf',
  'kayak',
  'paddle',
  'walk',
  'hike',
  'picnic',
  'garden',
  'photo',
  'read',
  'golf',
  'tennis',
  'soccer',
  'baseball',
  'yoga',
  'bball',
  'break',
  'lunch',
  'coffee',
  'dog',
])

export const ACTIVITY_CATEGORY_NAMES: readonly string[] = Object.freeze([
  'Running & cycling',
  'Water sports',
  'Outdoor leisure',
  'Sports & courts',
  'Quick breaks',
])

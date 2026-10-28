// Server-side reading of the planning fields of a stored account, for the Pro alerts
// and the calendar feed. A module of its own so the web app's bundle leaves it out.

import * as v from 'valibot'
import {
  migratePreferences,
  PREFERENCES_SHAPE,
  type GroupPreferences,
  type UserPreferences,
} from './prefs'
import { isPlainRecord, record } from './schema'

/** The stored preferences a server-side plan needs, read as the app reads them. */
export type PlanningPreferences = GroupPreferences & Pick<UserPreferences, 'activities'>

let planningSchema: v.GenericSchema<unknown, PlanningPreferences> | undefined

/**
 * Reads the planning fields of a stored account document (`users/{uid}`) with the same
 * migrations, schemas and fallbacks as the app (prefs.ts), so a value the rules leave
 * untyped (an activity's shade or icon, a profile) never reaches server-side math raw:
 * a bad field falls back to its default and a bad list element is dropped. Never
 * fails; anything that is not a document reads as an empty plan.
 */
export function parsePlanningPreferences(raw: unknown): PlanningPreferences {
  planningSchema ??= record({
    skinType: PREFERENCES_SHAPE.skinType,
    profiles: PREFERENCES_SHAPE.profiles,
    groupMode: PREFERENCES_SHAPE.groupMode,
    groupProfileIds: PREFERENCES_SHAPE.groupProfileIds,
    activities: PREFERENCES_SHAPE.activities,
  })
  return v.parse(planningSchema, isPlainRecord(raw) ? migratePreferences(raw) : {})
}

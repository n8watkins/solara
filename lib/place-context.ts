import { createContext, useContext } from 'react'
import type { Location } from './types'

/**
 * Home while this device shows another place (ROADMAP item 53), for the parts that say the
 * server still uses home (the calendar link card); null at home. components/App.tsx
 * provides it.
 */
export const VisitContext = createContext<{ home: Location; shown: Location } | null>(null)

/** Home and the visited place during a visit, else null. */
export function useVisit(): { home: Location; shown: Location } | null {
  return useContext(VisitContext)
}

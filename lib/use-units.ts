'use client'
import { createContext, useContext } from 'react'
import { resolveUnits, unitFormatters, type UnitFormatters } from './units'

/**
 * The display units for everything below it. components/App.tsx provides the
 * signed-in account's units; without a provider the browser locale decides.
 */
export const UnitsContext = createContext<UnitFormatters | null>(null)

let localeDefault: UnitFormatters | null = null

/** The browser locale's units, computed once. */
function localeUnits(): UnitFormatters {
  if (!localeDefault) localeDefault = unitFormatters(resolveUnits(null))
  return localeDefault
}

/** Temperature and clock formatters in the person's display units. */
export function useUnits(): UnitFormatters {
  return useContext(UnitsContext) ?? localeUnits()
}

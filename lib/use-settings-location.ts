'use client'
import { useState } from 'react'
import type { PlaceSearchMiss } from '@/components/PlaceSearch'
import { locationFromCoordinates } from './geocoding'
import type { Location } from './types'
import m from '@/messages/setup'

/**
 * Place search (components/PlaceSearch.tsx) and "use current location" for
 * Settings. A chosen or located place goes to `onFound`; a failure leaves a short
 * message in `error`.
 */
export function useSettingsLocation(onFound: (location: Location) => void) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function changeQuery(value: string) {
    setQuery(value)
    setError(null)
  }

  function choose(location: Location) {
    setError(null)
    setQuery('')
    onFound(location)
  }

  function missed(reason: PlaceSearchMiss) {
    setError(reason === 'none' ? m.cityNotFound : m.searchUnavailable)
  }

  async function resolve({ coords }: GeolocationPosition) {
    try {
      onFound(await locationFromCoordinates(coords.latitude, coords.longitude))
    } catch {
      setError(m.lookupFailed)
    } finally {
      setLoading(false)
    }
  }

  function locate() {
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      position => void resolve(position),
      () => {
        setError(m.locationOff)
        setLoading(false)
      },
    )
  }

  return { query, changeQuery, loading, error, choose, missed, locate }
}

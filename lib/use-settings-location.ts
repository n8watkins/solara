'use client'
import { useState } from 'react'
import { locationFromCoordinates, searchLocation } from './geocoding'
import type { Location } from './types'

/**
 * City search and "use current location" for Settings. Each lookup that
 * succeeds hands the new location to `onFound`; a failure leaves a short
 * message in `error`.
 */
export function useSettingsLocation(onFound: (location: Location) => void) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function lookUp(find: () => Promise<Location | null>, failure: string) {
    setLoading(true)
    setError(null)
    try {
      const location = await find()
      if (!location) throw new Error(failure)
      onFound(location)
    } catch {
      setError(failure)
    } finally {
      setLoading(false)
    }
  }

  function search() {
    if (!query.trim()) return
    void lookUp(() => searchLocation(query), 'City not found.')
  }

  function locate() {
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      position =>
        void lookUp(
          () => locationFromCoordinates(position.coords.latitude, position.coords.longitude),
          'Could not look up your location. Search for a city instead.',
        ),
      () => {
        setError('Location access is off. Search for a city instead.')
        setLoading(false)
      },
    )
  }

  return { query, setQuery, loading, error, search, locate }
}

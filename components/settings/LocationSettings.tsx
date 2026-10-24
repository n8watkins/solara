'use client'
import type { Location } from '@/lib/types'
import { useSettingsLocation } from '@/lib/use-settings-location'
import { SettingsCard, SettingsError } from './SettingsCard'

interface Props {
  location: Location
  onChange: (location: Location) => void
}

/** The "Location" section: the forecast location, by GPS or city search. */
export default function LocationSettings({ location, onChange }: Props) {
  const { query, setQuery, loading, error, search, locate } = useSettingsLocation(onChange)

  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <p className="mb-[3px] text-[12px] text-ink-3">Current location</p>
        <p className="text-[16px] font-[650] text-ink">
          {location.city}
          {location.region ? `, ${location.region}` : ''}
        </p>
      </SettingsCard>
      <button type="button" className="btn justify-center" onClick={locate} disabled={loading}>
        📍 {loading ? 'Detecting…' : 'Use current location'}
      </button>
      <div className="flex gap-2">
        <input
          type="search"
          aria-label="Search a city"
          placeholder="Search a city…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') search()
          }}
          className="flex-1"
        />
        <button type="button" className="btn" onClick={search} disabled={loading}>
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {error && <SettingsError>{error}</SettingsError>}
    </div>
  )
}

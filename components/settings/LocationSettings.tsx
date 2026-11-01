'use client'
import { MapPin } from 'lucide-react'
import type { Location } from '@/lib/types'
import { useSettingsLocation } from '@/lib/use-settings-location'
import DataAttribution from '../DataAttribution'
import PlaceSearch from '../PlaceSearch'
import { SettingsCard, SettingsError } from './SettingsCard'
import m from '@/messages/settings'

interface Props {
  location: Location
  onChange: (location: Location) => void
}

/** The "Location" section: the forecast location, by GPS or place search. */
export default function LocationSettings({ location, onChange }: Props) {
  const { query, changeQuery, loading, error, choose, missed, locate } =
    useSettingsLocation(onChange)

  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <p className="mb-[3px] text-[12px] text-ink-3">{m.currentLocation}</p>
        <p className="text-[16px] font-[650] text-ink">
          {location.city}
          {location.region ? `, ${location.region}` : ''}
        </p>
      </SettingsCard>
      <button type="button" className="btn justify-center" onClick={locate} disabled={loading}>
        <MapPin size={15} /> {loading ? m.detecting : m.useCurrentLocation}
      </button>
      <PlaceSearch
        ariaLabel={m.searchCity}
        placeholder={m.searchCityPlaceholder}
        value={query}
        onValueChange={changeQuery}
        onSelect={choose}
        onMiss={missed}
        busy={loading}
      />
      {error && <SettingsError>{error}</SettingsError>}
      <DataAttribution compact />
    </div>
  )
}

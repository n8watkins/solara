'use client'
import { useId } from 'react'
import type { SettingsDraft } from '@/lib/settings'
import { resolveUnits } from '@/lib/units'
import DarkModeToggle from '../DarkModeToggle'
import {
  FIELD_CONTROL,
  SettingsCard,
  SettingsField,
  SettingsHint,
  SettingsTitle,
} from './SettingsCard'

interface Props {
  draft: SettingsDraft
  onChange: (patch: Partial<SettingsDraft>) => void
}

/** The "Appearance" section: theme, units and the sun path animation. */
export default function AppearanceSettings({ draft, onChange }: Props) {
  const id = useId()
  const unitsDescId = `${id}-units-desc`
  const sunPathTitleId = `${id}-sun-path-title`
  const sunPathDescId = `${id}-sun-path-desc`
  const localeUnits = resolveUnits(null)

  return (
    <div className="flex flex-col gap-3.5">
      <SettingsCard>
        <SettingsField inline>
          <div>
            <SettingsTitle className="mb-1">Theme</SettingsTitle>
            <SettingsHint>Follow your device, or always use light or dark.</SettingsHint>
          </div>
          <DarkModeToggle />
        </SettingsField>
      </SettingsCard>

      <SettingsCard>
        <SettingsTitle className="mb-1">Units</SettingsTitle>
        <SettingsHint id={unitsDescId} className="mb-3">
          Automatic follows your browser&apos;s language and region.
        </SettingsHint>
        <div className="flex flex-col gap-2.5">
          <SettingsField inline>
            <label htmlFor={`${id}-temperature`} className="text-[13px] text-ink-2">
              Temperature
            </label>
            <select
              id={`${id}-temperature`}
              aria-describedby={unitsDescId}
              value={draft.temperatureUnit}
              onChange={e =>
                onChange({
                  temperatureUnit: e.target.value as SettingsDraft['temperatureUnit'],
                })
              }
              className={FIELD_CONTROL}
            >
              <option value="auto">
                Automatic ({localeUnits.temperature === 'celsius' ? '°C' : '°F'})
              </option>
              <option value="celsius">Celsius (°C)</option>
              <option value="fahrenheit">Fahrenheit (°F)</option>
            </select>
          </SettingsField>
          <SettingsField inline>
            <label htmlFor={`${id}-clock`} className="text-[13px] text-ink-2">
              Time format
            </label>
            <select
              id={`${id}-clock`}
              aria-describedby={unitsDescId}
              value={draft.clockFormat}
              onChange={e =>
                onChange({ clockFormat: e.target.value as SettingsDraft['clockFormat'] })
              }
              className={FIELD_CONTROL}
            >
              <option value="auto">
                Automatic ({localeUnits.clock === '12h' ? '1pm' : '13:00'})
              </option>
              <option value="12h">12-hour (1pm)</option>
              <option value="24h">24-hour (13:00)</option>
            </select>
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard className="flex items-center justify-between gap-3.5">
        <div>
          <SettingsTitle id={sunPathTitleId} className="mb-1">
            Sun path animation
          </SettingsTitle>
          <SettingsHint id={sunPathDescId}>
            The arc above the hourly UV chart showing the sun&apos;s position.
          </SettingsHint>
        </div>
        <button
          type="button"
          aria-pressed={draft.showSunPath}
          id={`${sunPathTitleId}-toggle`}
          aria-labelledby={`${sunPathTitleId} ${sunPathTitleId}-toggle`}
          aria-describedby={sunPathDescId}
          onClick={() => onChange({ showSunPath: !draft.showSunPath })}
          className="btn whitespace-nowrap"
        >
          {draft.showSunPath ? '✓ On' : 'Off'}
        </button>
      </SettingsCard>
    </div>
  )
}

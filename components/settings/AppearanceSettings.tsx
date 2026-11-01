'use client'
import { useId } from 'react'
import type { SettingsDraft } from '@/lib/settings'
import { formatHour, resolveUnits } from '@/lib/units'
import DarkModeToggle from '../DarkModeToggle'
import {
  FIELD_CONTROL,
  SettingsCard,
  SettingsField,
  SettingsHint,
  SettingsTitle,
} from './SettingsCard'
import m from '@/messages/settings'
import { LOCALES, localeFromLanguages } from '@solara/core/i18n'
import { deviceLanguages, LANGUAGE_NAMES } from '@/lib/i18n'

interface Props {
  draft: SettingsDraft
  onChange: (patch: Partial<SettingsDraft>) => void
}

/** The "Display" section: theme, units, language and the sun path animation. */
export default function AppearanceSettings({ draft, onChange }: Props) {
  const id = useId()
  const unitsDescId = `${id}-units-desc`
  const sunPathTitleId = `${id}-sun-path-title`
  const sunPathDescId = `${id}-sun-path-desc`
  const localeUnits = resolveUnits(null)
  const languageDescId = `${id}-language-desc`
  const deviceLanguage = LANGUAGE_NAMES[localeFromLanguages(deviceLanguages())]

  return (
    <div className="flex flex-col gap-3.5">
      <SettingsCard>
        <SettingsField inline>
          <div>
            <SettingsTitle className="mb-1">{m.theme}</SettingsTitle>
            <SettingsHint>{m.themeHint}</SettingsHint>
          </div>
          <DarkModeToggle />
        </SettingsField>
      </SettingsCard>

      <SettingsCard>
        <SettingsTitle className="mb-1">{m.units}</SettingsTitle>
        <SettingsHint id={unitsDescId} className="mb-3">
          {m.unitsHint}
        </SettingsHint>
        <div className="flex flex-col gap-2.5">
          <SettingsField inline>
            <label htmlFor={`${id}-temperature`} className="text-[13px] text-ink-2">
              {m.temperature}
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
                {m.automatic(localeUnits.temperature === 'celsius' ? '°C' : '°F')}
              </option>
              <option value="celsius">{m.celsius}</option>
              <option value="fahrenheit">{m.fahrenheit}</option>
            </select>
          </SettingsField>
          <SettingsField inline>
            <label htmlFor={`${id}-clock`} className="text-[13px] text-ink-2">
              {m.timeFormat}
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
                {m.automatic(localeUnits.clock === '12h' ? formatHour(13, '12h') : '13:00')}
              </option>
              <option value="12h">{m.clock12(formatHour(13, '12h'))}</option>
              <option value="24h">{m.clock24('13:00')}</option>
            </select>
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsField inline>
          <div>
            <SettingsTitle className="mb-1">
              <label htmlFor={`${id}-language`}>{m.language}</label>
            </SettingsTitle>
            <SettingsHint id={languageDescId}>{m.languageHint}</SettingsHint>
          </div>
          <select
            id={`${id}-language`}
            aria-describedby={languageDescId}
            value={draft.language}
            onChange={e => onChange({ language: e.target.value as SettingsDraft['language'] })}
            className={FIELD_CONTROL}
          >
            <option value="auto">{m.automatic(deviceLanguage)}</option>
            {LOCALES.map(locale => (
              <option key={locale} value={locale} lang={locale}>
                {LANGUAGE_NAMES[locale]}
              </option>
            ))}
          </select>
        </SettingsField>
      </SettingsCard>

      <SettingsCard className="flex items-center justify-between gap-3.5">
        <div>
          <SettingsTitle id={sunPathTitleId} className="mb-1">
            {m.sunPath}
          </SettingsTitle>
          <SettingsHint id={sunPathDescId}>{m.sunPathHint}</SettingsHint>
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
          {draft.showSunPath ? m.onChecked : m.off}
        </button>
      </SettingsCard>
    </div>
  )
}

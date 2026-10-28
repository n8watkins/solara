'use client'
import { useId, useState } from 'react'
import type { User } from 'firebase/auth'
import type { SkinType, TierLevel } from '@/lib/types'
import type { SettingsDraft } from '@/lib/settings'
import { SKIN_OPTIONS } from '@/lib/onboarding'
import SkinSwatch from '../SkinSwatch'
import { SkinTypeQuiz } from '../deferred'
import NotificationSettings from './NotificationSettings'
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
  tier: TierLevel
  user?: User | null
}

/** The "Sun profile" section: skin type, sunscreen, and morning and UV alerts. */
export default function SunProfileSettings({ draft, onChange, tier, user }: Props) {
  const id = useId()
  const [showHelp, setShowHelp] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const selected = SKIN_OPTIONS.find(o => o.value === draft.skinType) ?? SKIN_OPTIONS[1]!

  return (
    <div className="flex flex-col gap-4.5">
      <SettingsCard className="flex flex-col gap-2.5">
        <SettingsField>
          <div>
            <SettingsTitle className="mb-1">
              <label htmlFor={`${id}-skin`}>Skin type</label>
            </SettingsTitle>
            <SettingsHint id={`${id}-skin-desc`} className="leading-[1.45]">
              Used for burn-time and vitamin D estimates.
            </SettingsHint>
          </div>
          <select
            id={`${id}-skin`}
            aria-describedby={`${id}-skin-desc`}
            value={draft.skinType}
            onChange={e => onChange({ skinType: e.target.value as SkinType })}
            className={FIELD_CONTROL}
          >
            {SKIN_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.fitzpatrick})
              </option>
            ))}
          </select>
        </SettingsField>
        <div className="flex items-center justify-between gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5">
          <SkinSwatch skin={selected.value} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-[650] text-ink">
              {selected.label}{' '}
              <span className="font-normal text-ink-3">· Fitzpatrick {selected.fitzpatrick}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">{selected.desc}</p>
          </div>
          <span className="text-[12px] font-semibold whitespace-nowrap text-ink-2">
            {selected.burnTime} at UV 10
          </span>
        </div>
        <button
          type="button"
          className="btn justify-center text-[13px]"
          onClick={() => setQuizOpen(true)}
        >
          Not sure? Take the 1-minute quiz
        </button>
        {quizOpen && (
          <SkinTypeQuiz
            onClose={() => setQuizOpen(false)}
            onUse={skinType => {
              onChange({ skinType })
              setQuizOpen(false)
            }}
          />
        )}
        <button
          type="button"
          className="btn btn-ghost justify-start px-0 py-1 text-[12px] text-accent"
          aria-expanded={showHelp}
          aria-controls={`${id}-skin-help`}
          onClick={() => setShowHelp(s => !s)}
        >
          {showHelp ? 'Hide explanation' : 'How skin type affects Solara'}
        </button>
        {showHelp && (
          <p id={`${id}-skin-help`} className="text-[13px] leading-[1.55] text-ink-2">
            Lighter skin typically burns faster at the same UV level. The types follow the
            Fitzpatrick scale, from type I (always burns, never tans) to types V and VI (rarely or
            never burns), which Solara plans together using the more cautious type V estimate.
            Solara uses your type for burn-time and vitamin D estimates. These are planning
            estimates, not medical advice.
          </p>
        )}
      </SettingsCard>

      <SettingsCard className="flex flex-col gap-1.5">
        <SettingsTitle>Sunscreen is activity-specific</SettingsTitle>
        <SettingsHint className="leading-[1.45]">
          SPF assumptions are set per activity from the dashboard&apos;s Activities section, so a
          swim, walk, and quick coffee break can each use different protection settings.
        </SettingsHint>
      </SettingsCard>

      <NotificationSettings tier={tier} user={user} draft={draft} onChange={onChange} />
    </div>
  )
}

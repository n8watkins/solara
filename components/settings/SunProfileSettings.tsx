'use client'
import { useId, useState } from 'react'
import type { SkinType } from '@/lib/types'
import type { SettingsDraft } from '@/lib/settings'
import { SKIN_OPTIONS } from '@/lib/onboarding'
import {
  BODY_AREAS,
  reapplyRule,
  teaspoonRule,
  spfRuleText,
  sunscreenAmount,
  sunscreenAmountText,
} from '@solara/core/sunscreen'
import SkinSwatch from '../SkinSwatch'
import { SkinTypeQuiz } from '../deferred'
import {
  FIELD_CONTROL,
  SettingsCard,
  SettingsField,
  SettingsHint,
  SettingsTitle,
} from './SettingsCard'
import m from '@/messages/settings'
import app from '@/messages/app'

interface Props {
  draft: SettingsDraft
  onChange: (patch: Partial<SettingsDraft>) => void
}

/** The "Sun profile" section: skin type and sunscreen (the alerts have their own tab). */
export default function SunProfileSettings({ draft, onChange }: Props) {
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
              <label htmlFor={`${id}-skin`}>{m.skinType}</label>
            </SettingsTitle>
            <SettingsHint id={`${id}-skin-desc`} className="leading-[1.45]">
              {m.skinTypeHint}
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
              <span className="font-normal text-ink-3">{m.fitzpatrick(selected.fitzpatrick)}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">{selected.desc}</p>
          </div>
          {/* Narrow, so the skin type beside it keeps its room; it wraps after the time. */}
          <span className="max-w-[5.5rem] shrink-0 text-right text-[12px] leading-[1.35] font-semibold text-balance text-ink-2">
            {m.atUv10(selected.burnTime)}
          </span>
        </div>
        <button
          type="button"
          className="btn justify-center text-[13px]"
          onClick={() => setQuizOpen(true)}
        >
          {m.takeQuiz}
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
          {showHelp ? m.hideExplanation : m.howSkinType}
        </button>
        {showHelp && (
          <p id={`${id}-skin-help`} className="text-[13px] leading-[1.55] text-ink-2">
            {m.skinTypeExplanation} {app.healthQualifier}
          </p>
        )}
      </SettingsCard>

      {/* The SPF for the skin type chosen above, the teaspoon rule and when to reapply
          (packages/core/src/sunscreen.ts); nothing here is stored. */}
      <SettingsCard className="flex flex-col gap-1.5" data-testid="sunscreen-settings">
        <SettingsTitle>{m.sunscreen}</SettingsTitle>
        <ul className="m-0 list-disc space-y-1 pl-[18px] text-[13px] leading-[1.45] text-ink-2">
          <li>{spfRuleText(draft.skinType)}</li>
          <li>
            {teaspoonRule()} {sunscreenAmountText(sunscreenAmount(BODY_AREAS))}.
          </li>
          <li>{reapplyRule()}</li>
        </ul>
        <SettingsHint className="leading-[1.45]">{m.sunscreenPerActivity}</SettingsHint>
      </SettingsCard>
    </div>
  )
}

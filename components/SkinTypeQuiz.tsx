'use client'
import { useId, useState } from 'react'
import clsx from 'clsx'
import { FITZPATRICK_TYPES } from '@solara/core'
import { SKIN_QUIZ, skinTypeFromQuiz, type SkinQuizAnswers } from '@/lib/skin-quiz'
import { SKIN_TYPE_LABELS } from '@/lib/profiles'
import type { SkinType } from '@/lib/types'
import ActivityModalShell from './ActivityModalShell'
import SkinSwatch from './SkinSwatch'

interface Props {
  /** Called with the suggested skin type when the person chooses to use it. */
  onUse: (skin: SkinType) => void
  onClose: () => void
}

/**
 * The optional skin type quiz: five questions from the standard Fitzpatrick skin type
 * questionnaire (lib/skin-quiz.ts), reachable from setup and Settings. It only
 * suggests a type; nothing changes until the person chooses to use it.
 */
export default function SkinTypeQuiz({ onUse, onClose }: Props) {
  const id = useId()
  const [answers, setAnswers] = useState<SkinQuizAnswers>({})
  const suggested = skinTypeFromQuiz(answers)
  const answered = SKIN_QUIZ.filter(q => answers[q.id] !== undefined).length

  return (
    <ActivityModalShell
      title="Find your skin type"
      description="Five quick questions from the Fitzpatrick skin type questionnaire."
      variant="narrow"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          <div role="status" aria-live="polite" className="text-[13px] leading-[1.5] text-ink-2">
            {suggested ? (
              <div className="flex items-center gap-2.5">
                <SkinSwatch skin={suggested} size={24} />
                <p>
                  Your answers suggest{' '}
                  <strong className="font-semibold text-ink">
                    Type {FITZPATRICK_TYPES[suggested]}, {SKIN_TYPE_LABELS[suggested]}
                  </strong>
                  .
                </p>
              </div>
            ) : (
              <p>
                {answered} of {SKIN_QUIZ.length} answered.
              </p>
            )}
          </div>
          <p className="text-[12px] leading-[1.5] text-ink-3">
            This is an estimate for planning, not medical advice. If you burn more easily than it
            suggests, choose a lighter type.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn text-[13px]" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary text-[13px]"
              disabled={!suggested}
              onClick={() => suggested && onUse(suggested)}
            >
              {suggested ? `Use ${SKIN_TYPE_LABELS[suggested]}` : 'Use this type'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {SKIN_QUIZ.map((q, index) => (
          <fieldset key={q.id} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[14px] font-semibold text-ink">
              <span className="text-ink-3">{index + 1}.</span> {q.question}
            </legend>
            <div className="flex flex-col gap-1.5">
              {q.answers.map((answer, score) => {
                const checked = answers[q.id] === score
                return (
                  <label
                    key={answer}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2.5 rounded-[10px] border-[0.5px] px-3 py-2 text-[13px] text-ink',
                      checked
                        ? 'border-accent bg-brand/8 shadow-[0_0_0_1px_var(--accent)]'
                        : 'border-line-strong bg-surface-card',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-${q.id}`}
                      value={score}
                      checked={checked}
                      onChange={() => setAnswers(current => ({ ...current, [q.id]: score }))}
                      className="size-4 shrink-0 accent-[var(--accent)]"
                    />
                    {answer}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </ActivityModalShell>
  )
}

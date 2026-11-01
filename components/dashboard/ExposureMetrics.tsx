import type { ReactNode } from 'react'
import type { SkinType } from '@/lib/types'
import { formatDuration } from '@solara/core/duration'
import Tooltip from '../Tooltip'
import t from '@/messages/dashboard'
import { skinTypeSkin } from '@solara/core/recommendation'

/** "2 hours 47 minutes", "21 minutes", for a screen reader. */
function spokenDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hours = h ? t.spokenHours(h) : ''
  const mins = m || !h ? t.spokenMinutes(m) : ''
  return [hours, mins].filter(Boolean).join(' ')
}

function Metric({
  label,
  help,
  minutes,
  empty,
  detail,
  testId,
}: {
  label: string
  help: string
  /** The estimate in minutes, or null when the UV is too low for one. */
  minutes: number | null
  /** What the card says instead of a number ("No burn risk"). */
  empty: string
  detail: ReactNode
  testId: string
}) {
  return (
    <div className="metric-card px-3 py-2.5" data-testid={testId}>
      <p className="mb-[3px] text-[12px] font-medium text-ink-3">
        <span className="tooltip-anchor">
          {label}
          <Tooltip text={help}>
            <></>
          </Tooltip>
        </span>
      </p>
      {/* The line keeps a number's height either way, so a card with words lines up
          with one showing minutes; the words sit on the number's baseline, sized like
          the dashboard's other words (they used to read "None" at 23 px). */}
      <p className="text-[23px] leading-[1.05] font-bold text-ink">
        {minutes === null ? (
          <span
            className="text-[15px] leading-[1.2] font-semibold text-ink-2"
            data-testid="metric-value"
          >
            {empty}
          </span>
        ) : (
          <>
            {/* "2 h 47 min" as everywhere else (formatDuration), with the units smaller
                than the numbers; "167m" read as metres (REVIEW9 QA L3). */}
            <span aria-hidden="true" data-testid="metric-value">
              {formatDuration(minutes)
                .split(' ')
                .map((part, i) =>
                  /^\d+$/.test(part) ? (
                    <span key={i}>
                      {i > 0 && ' '}
                      {part}
                    </span>
                  ) : (
                    <span key={i} className="text-[15px] font-semibold text-ink-2">
                      {' '}
                      {part}
                    </span>
                  ),
                )}
            </span>
            <span className="sr-only" data-testid="metric-value-spoken">
              {spokenDuration(minutes)}
            </span>
          </>
        )}
      </p>
      <p className="mt-[3px] text-[11px] text-ink-3" data-testid="metric-detail">
        {detail}
      </p>
    </div>
  )
}

/** Burn time and vitamin D estimates at the current (or peak) UV. */
export default function ExposureMetrics({
  burn,
  vitD,
  isToday,
  skinType,
  mostSensitive,
  burnFrom,
  vitDFrom,
  onEditSkin,
}: {
  burn: number | null
  vitD: number | null
  isToday: boolean
  skinType: SkinType
  /** In group mode, the name of the person whose skin type is used. */
  mostSensitive?: string
  /** With no burn estimate now: when UV is next high enough for one ("9am tomorrow"). */
  burnFrom: string | null
  /** With no vitamin D estimate now: when UV is next high enough for one. */
  vitDFrom: string | null
  /**
   * Opens the skin type setting, offered beside the skin type it names (a guest's only
   * way to change it after setup, REVIEW8 QA M3); absent where Settings is elsewhere.
   */
  onEditSkin?: () => void
}) {
  // In group mode the estimate is the most sensitive person's.
  const skin = skinTypeSkin(skinType)
  const whose = mostSensitive ? t.burnWhoseGroup(mostSensitive, skin) : skin
  const who = mostSensitive ? t.burnWhoGroup(mostSensitive) : skin
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5"
      data-testid="exposure-metrics"
    >
      <Metric
        testId="burn-metric"
        label={t.burnTitle}
        help={t.burnHelp(whose)}
        minutes={burn}
        empty={t.noBurnRisk}
        detail={
          burn || !burnFrom ? (
            <>
              {isToday ? t.burnNow(who) : t.burnAtPeak(who)}
              {onEditSkin && (
                <>
                  {'\u00a0· '}
                  <button
                    type="button"
                    onClick={onEditSkin}
                    aria-label={t.editSkinType}
                    className="font-semibold text-accent underline-offset-2 hover:underline"
                  >
                    {t.edit}
                  </button>
                </>
              )}
            </>
          ) : (
            t.until(burnFrom)
          )
        }
      />
      <Metric
        testId="vitd-metric"
        label={t.vitdTitle}
        help={t.vitdHelp}
        minutes={vitD}
        empty={t.uvTooLow}
        detail={vitD ? t.armsLegs : vitDFrom ? t.until(vitDFrom) : t.needsUv1}
      />
    </div>
  )
}

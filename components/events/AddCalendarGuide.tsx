'use client'
// "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md, ROADMAP item 24): how to
// copy a calendar link from Apple iCloud, Google, Outlook.com or Yahoo, ending at the
// linked calendars' own link field below. Loaded by EventSubscriptions only when the
// person opens it, so neither first load grows; the words are in lib/calendar-guide.ts.
import { useId, useState } from 'react'
import { Clock, KeyRound } from 'lucide-react'
import { CALENDAR_PROVIDERS, type CalendarProvider } from '@solara/core/event-import'
import { CALENDAR_GUIDES, GOOGLE_EVENTS_NOTE, SHARED_NOTES } from '@/lib/calendar-guide'

interface Props {
  /** Whether events from Google Calendar are switched on (the Google choice mentions them). */
  googleEvents: boolean
  /** The provider whose steps show first (a shared link's), if known. */
  initialProvider?: CalendarProvider | null
}

export default function AddCalendarGuide({ googleEvents, initialProvider = null }: Props) {
  const id = useId()
  const [provider, setProvider] = useState<CalendarProvider | null>(initialProvider)
  const guide = provider ? CALENDAR_GUIDES[provider] : null
  const legendId = `${id}-legend`
  const notes = guide
    ? [...guide.notes, ...(provider === 'google' && googleEvents ? [GOOGLE_EVENTS_NOTE] : [])]
    : []

  return (
    <div
      className="mt-2 rounded-[12px] border-[0.5px] border-line-strong bg-surface-subtle px-3 py-3"
      data-testid="add-calendar-guide"
    >
      <p id={legendId} className="text-[12px] leading-normal text-ink-2">
        Where is the calendar?
      </p>
      {/* Native radios: arrow keys, focus and screen-reader semantics come for free. */}
      <fieldset
        role="radiogroup"
        aria-labelledby={legendId}
        className="segmented mt-1.5 grid w-full grid-cols-2 sm:grid-cols-4"
      >
        {CALENDAR_PROVIDERS.map(value => (
          <label key={value} className="segmented-option justify-center text-center">
            <input
              type="radio"
              name={`${id}-provider`}
              value={value}
              checked={provider === value}
              onChange={() => setProvider(value)}
            />
            <span>{CALENDAR_GUIDES[value].label}</span>
          </label>
        ))}
      </fieldset>

      {guide && provider && (
        <div className="mt-3" data-testid="add-calendar-steps" data-provider={provider}>
          <h4 className="sr-only">How to copy the link from {guide.label}</h4>
          {guide.summary && <p className="text-[13px] leading-normal text-ink">{guide.summary}</p>}
          {guide.ways.length > 0 && (
            <div
              className={guide.ways.length > 1 ? 'grid gap-x-5 gap-y-3 sm:grid-cols-2' : undefined}
            >
              {guide.ways.map((way, index) => {
                const wayId = `${id}-way-${index}`
                return (
                  <div key={way.title ?? index}>
                    {way.title && (
                      <h5 id={wayId} className="mb-1.5 text-[12px] font-semibold text-ink-2">
                        {way.title}
                      </h5>
                    )}
                    <ol
                      className="flex flex-col gap-1.5"
                      aria-labelledby={way.title ? wayId : undefined}
                    >
                      {way.steps.map((step, n) => (
                        <li key={step} className="flex gap-2 text-[13px] leading-snug text-ink">
                          <span
                            aria-hidden="true"
                            className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface-metric text-[11px] font-semibold text-ink-2 tabular-nums"
                          >
                            {n + 1}
                          </span>
                          <span className="min-w-0">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )
              })}
            </div>
          )}

          <ul className="mt-2.5 flex flex-col gap-1 text-[12px] leading-normal text-ink-2">
            {notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>

          <ul className="mt-2.5 flex flex-col gap-1.5 border-t-[0.5px] border-line pt-2.5 text-[12px] leading-normal text-ink-2">
            <li className="flex gap-2">
              <KeyRound size={14} aria-hidden="true" className="mt-px shrink-0 text-ink-3" />
              <span>
                {SHARED_NOTES.key} {SHARED_NOTES.separate}
              </span>
            </li>
            <li className="flex gap-2">
              <Clock size={14} aria-hidden="true" className="mt-px shrink-0 text-ink-3" />
              <span>{SHARED_NOTES.refresh}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

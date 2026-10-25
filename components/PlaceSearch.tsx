'use client'
// Type a town, pick it from suggestions. Used by setup's location step and the
// header's location panel. It follows the WAI-ARIA combobox pattern with a list
// popup: focus stays in the text field, the arrow keys move the highlighted
// option (announced through aria-activedescendant), Enter picks it, Escape closes
// the list. Enter or "Go" without a highlighted option picks the best match.
import { useId, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { searchPlaces, type PlaceSuggestion } from '@/lib/geocoding'
import type { Location } from '@/lib/types'
import { usePlaceSuggestions } from '@/lib/use-place-suggestions'

export type PlaceSearchMiss = 'none' | 'error'

interface Props {
  /** The text field's id, for an outside `<label htmlFor>`. */
  id?: string
  /** The accessible name when there is no visible label. */
  ariaLabel?: string
  placeholder: string
  value: string
  onValueChange: (value: string) => void
  /** Called with the chosen place; its coordinates are already rounded. */
  onSelect: (location: Location) => void
  /** Called when "Go" finds nothing ('none') or the search fails ('error'). */
  onMiss: (reason: PlaceSearchMiss) => void
  /** Another lookup is running (such as "Use my location"); "Go" waits. */
  busy?: boolean
  /** `sm` for the compact header panel. */
  size?: 'md' | 'sm'
  autoFocus?: boolean
}

function suggestionLabel({ location, detail }: PlaceSuggestion): string {
  return detail ? `${location.city}, ${detail}` : location.city
}

export default function PlaceSearch({
  id,
  ariaLabel,
  placeholder,
  value,
  onValueChange,
  onSelect,
  onMiss,
  busy = false,
  size = 'md',
  autoFocus = false,
}: Props) {
  const baseId = useId()
  const inputId = id ?? `${baseId}-input`
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [submitting, setSubmitting] = useState(false)
  const { status, suggestions } = usePlaceSuggestions(value)

  const showList = open && suggestions.length > 0
  const message = !open
    ? null
    : status === 'done' && suggestions.length === 0
      ? `No places match “${value.trim()}”.`
      : status === 'error'
        ? 'Suggestions are unavailable right now. Press Go to search.'
        : status === 'loading' && suggestions.length === 0
          ? 'Searching…'
          : null
  const activeIndex = showList && active < suggestions.length ? active : -1
  // What a screen reader hears when the list changes (the visible text says the rest).
  const announcement =
    open && status === 'done' && suggestions.length > 0
      ? `${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}. Use the up and down arrow keys to choose.`
      : open && status !== 'loading'
        ? (message ?? '')
        : ''

  function choose(suggestion: PlaceSuggestion) {
    setOpen(false)
    setActive(-1)
    onValueChange(suggestion.location.city)
    onSelect(suggestion.location)
  }

  async function submit() {
    const query = value.trim()
    if (!query || submitting) return
    setOpen(false)
    setActive(-1)
    setSubmitting(true)
    try {
      // The same search the suggestions use, so it is usually answered from the cache.
      const [best] = await searchPlaces(query)
      if (best) onSelect(best.location)
      else onMiss('none')
    } catch {
      onMiss('error')
    } finally {
      setSubmitting(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        setOpen(true)
        if (suggestions.length === 0) return
        const last = suggestions.length - 1
        if (event.key === 'ArrowDown') setActive(activeIndex >= last ? 0 : activeIndex + 1)
        else setActive(activeIndex <= 0 ? last : activeIndex - 1)
        return
      }
      case 'Enter': {
        event.preventDefault()
        const highlighted = activeIndex >= 0 ? suggestions[activeIndex] : undefined
        if (highlighted) choose(highlighted)
        else if (!busy) void submit()
        return
      }
      case 'Escape':
        // Close the list first; a second Escape belongs to whatever holds the field.
        if (open && (showList || message)) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          setActive(-1)
        }
        return
      case 'Tab':
        setOpen(false)
        return
    }
  }

  const small = size === 'sm'

  return (
    <div className="relative">
      <div className={clsx('flex items-center', small ? 'gap-1.5' : 'gap-2')}>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          // The suggestions replace the browser's own autofill list.
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          onChange={event => {
            onValueChange(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={clsx('min-w-0 flex-1', small && 'px-2.5 py-[7px] text-[13px]')}
        />
        <button
          type="button"
          className={clsx(
            'btn shrink-0',
            small ? 'px-3 py-[7px] text-[13px]' : 'self-stretch px-4',
          )}
          onClick={() => void submit()}
          disabled={busy || submitting}
        >
          {small && submitting ? '…' : 'Go'}
        </button>
      </div>

      <div
        hidden={!showList && !message}
        className="absolute inset-x-0 top-[calc(100%+4px)] z-[110] overflow-hidden rounded-[12px] border-[0.5px] border-line-strong bg-surface-card shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggested places"
          hidden={!showList}
          aria-busy={status === 'loading'}
          className="m-0 list-none p-1"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={optionId(index)}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-label={suggestionLabel(suggestion)}
              // Keep focus in the field, so the list stays open and the pick lands.
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(suggestion)}
              onMouseMove={() => {
                if (index !== activeIndex) setActive(index)
              }}
              className={clsx(
                'flex cursor-pointer flex-col rounded-[8px]',
                small ? 'px-2.5 py-1.5' : 'px-3 py-2',
                index === activeIndex && 'bg-accent-soft',
              )}
            >
              <span
                className={clsx(
                  'truncate font-semibold text-ink',
                  small ? 'text-[13px]' : 'text-[14px]',
                )}
              >
                {suggestion.location.city}
              </span>
              {suggestion.detail && (
                <span
                  className={clsx('truncate text-ink-3', small ? 'text-[11px]' : 'text-[12px]')}
                >
                  {suggestion.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!showList && message && (
          <p
            className={clsx(
              'm-0 text-ink-2',
              small ? 'px-3 py-2 text-[12px]' : 'px-3.5 py-2.5 text-[13px]',
            )}
          >
            {message}
          </p>
        )}
      </div>

      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  )
}

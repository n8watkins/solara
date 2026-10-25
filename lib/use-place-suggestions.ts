'use client'
import { useEffect, useState } from 'react'
import { PLACE_SEARCH_MIN_LENGTH, searchPlaces, type PlaceSuggestion } from './geocoding'

/** Typing pauses this long before a place search starts. */
export const PLACE_SEARCH_DEBOUNCE_MS = 300

export type PlaceSuggestionsStatus = 'idle' | 'loading' | 'done' | 'error'

interface Settled {
  query: string
  status: 'done' | 'error'
  suggestions: PlaceSuggestion[]
}

const NONE: Settled = { query: '', status: 'done', suggestions: [] }

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Place suggestions for what someone is typing: debounced by
 * {@link PLACE_SEARCH_DEBOUNCE_MS}, and only the latest query counts. A search
 * that is still waiting for its turn (the helper sends at most one per second)
 * is cancelled when the query changes, so it never reaches the network.
 *
 * While someone keeps typing (or deletes a letter), `suggestions` keeps the last
 * answer until the new one arrives, so the list does not flicker; `status` says
 * whether it belongs to the current query.
 */
export function usePlaceSuggestions(query: string): {
  status: PlaceSuggestionsStatus
  suggestions: PlaceSuggestion[]
} {
  const trimmed = query.trim()
  const searchable = trimmed.length >= PLACE_SEARCH_MIN_LENGTH
  const [settled, setSettled] = useState<Settled>(NONE)

  useEffect(() => {
    if (!searchable) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchPlaces(trimmed, { signal: controller.signal }).then(
        suggestions => {
          if (!controller.signal.aborted)
            setSettled({ query: trimmed, status: 'done', suggestions })
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbort(error)) return
          setSettled({ query: trimmed, status: 'error', suggestions: [] })
        },
      )
    }, PLACE_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, searchable])

  if (!searchable) return { status: 'idle', suggestions: [] }
  if (settled.query === trimmed) return settled
  const now = trimmed.toLocaleLowerCase()
  const before = settled.query.toLocaleLowerCase()
  const related = before !== '' && (now.startsWith(before) || before.startsWith(now))
  return { status: 'loading', suggestions: related ? settled.suggestions : [] }
}

'use client'
import { useEffect, useRef, useState } from 'react'

export interface StatusFlash {
  /** The message showing now, or null. */
  message: string | null
  /** Shows `message` for `ms`; a newer message is never cleared by an older timer. */
  flash: (message: string, ms?: number) => void
  clear: () => void
}

/** A short-lived status message, for a `role="status"` line after an action. */
export function useStatusFlash(defaultMs = 3500): StatusFlash {
  const [message, setMessage] = useState<string | null>(null)
  const timers = useRef(new Set<number>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const id of pending) window.clearTimeout(id)
      pending.clear()
    }
  }, [])

  function flash(next: string, ms = defaultMs) {
    setMessage(next)
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      setMessage(current => (current === next ? null : current))
    }, ms)
    timers.current.add(id)
  }

  return { message, flash, clear: () => setMessage(null) }
}

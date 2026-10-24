import { useEffect, useRef, useState } from 'react'

/** How long a flashed message stays, in ms. */
export const FLASH_MS = 4500

/**
 * A short status message: `flash` shows one that clears itself after `ms`,
 * `hold` shows one until the next call (for "Saving…" before the result). A
 * newer message always replaces an older one, and no timer outlives the
 * component.
 */
export function useFlashMessage() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clearTimer, [])

  function hold(next: string) {
    clearTimer()
    setMessage(next)
  }

  function flash(next: string, ms = FLASH_MS) {
    hold(next)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setMessage(null)
    }, ms)
  }

  return { message, flash, hold }
}

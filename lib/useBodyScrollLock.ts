import { useEffect } from 'react'

/**
 * Locks `document.body` scroll while the calling component is mounted, so the
 * page behind a fullscreen/modal overlay can't scroll out from under it.
 *
 * SSR-safe: `document` is only touched inside the effect (never during render),
 * and the original `overflow` value is restored on unmount. Nested overlays are
 * handled with a shared counter so the lock only lifts once the last one closes.
 *
 * @param locked  when false the hook is inert (handy for conditional overlays)
 */
let lockCount = 0
let savedOverflow = ''

export function useBodyScrollLock(locked: boolean = true) {
  useEffect(() => {
    if (!locked) return
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow
      }
    }
  }, [locked])
}

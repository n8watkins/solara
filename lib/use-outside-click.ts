'use client'
import { useEffect, useEffectEvent, type RefObject } from 'react'

/**
 * While `active`, calls `onOutside` for a mouse press outside `ref` (the usual
 * "click away closes it" for menus and popovers).
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
) {
  const handle = useEffectEvent((event: MouseEvent) => {
    if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
  })
  useEffect(() => {
    if (!active) return
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [active])
}

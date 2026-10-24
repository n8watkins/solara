'use client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { CalendarDay } from '@/lib/calendar-grid'
import type { Activity, SafeActivityWindow } from '@/lib/types'

/** A lower-UV window picked in the grid. */
export interface WindowSelection {
  act: Activity
  win: SafeActivityWindow
  day: CalendarDay
  /** Identifies the chip: `date:activity:index`. */
  key: string
}

/**
 * The window details sheet: focus moves into it on open, Escape closes it, and focus
 * returns to the chip that opened it.
 */
export function useWindowSheet() {
  const [selected, setSelected] = useState<WindowSelection | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const chips = useRef(new Map<string, HTMLButtonElement>())
  const returnFocusKey = useRef<string | null>(null)

  function close() {
    setSelected(null)
    const key = returnFocusKey.current
    returnFocusKey.current = null
    // The chip stays mounted while the sheet is open, so focus can move back at once.
    if (key) chips.current.get(key)?.focus()
  }

  /** Closes without moving focus, when something else takes over. */
  function dismiss() {
    setSelected(null)
    returnFocusKey.current = null
  }

  function toggle(selection: WindowSelection) {
    if (selected?.key === selection.key) {
      close()
    } else {
      returnFocusKey.current = selection.key
      setSelected(selection)
    }
  }

  /** Ref callback for the chip with `key`, so focus can return to it. */
  function chipRef(key: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) chips.current.set(key, el)
      else chips.current.delete(key)
    }
  }

  const selectedKey = selected?.key
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  })
  useEffect(() => {
    if (!selectedKey) return
    sheetRef.current?.focus()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedKey])

  return { selected, sheetRef, close, dismiss, toggle, chipRef }
}

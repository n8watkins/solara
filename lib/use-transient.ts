'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A value that clears itself `ms` after it was last shown, for short
 * confirmations such as "Running added". Showing a new value restarts the
 * timer, and the timer never outlives the component.
 */
export function useTransient<T>(ms: number): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const show = useCallback(
    (next: T) => {
      clearTimeout(timer.current)
      setValue(next)
      timer.current = setTimeout(() => setValue(null), ms)
    },
    [ms],
  )

  return [value, show]
}

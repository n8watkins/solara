'use client'
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'

/**
 * The calendar grid's scroll box. Column widths depend on the space the grid
 * actually has, not the viewport, so its width is observed; the horizontal scroll
 * position drives the pager. It scrolls back to the top whenever `resetKey` changes,
 * since each view opens at its first hour.
 */
export function useGridViewport(resetKey: string) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  /** Callback ref for the scrolling grid element: measures it while it is mounted. */
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      elRef.current = null
    }
  }, [])

  useEffect(() => {
    if (elRef.current) elRef.current.scrollTop = 0
  }, [resetKey])

  return {
    gridRef,
    /** The grid's inner width in px, or null before it is measured. */
    width,
    scrollLeft,
    onScroll: (e: UIEvent<HTMLDivElement>) => setScrollLeft(e.currentTarget.scrollLeft),
    /** Smoothly scrolls horizontally to `left` px. */
    scrollToLeft: (left: number) => elRef.current?.scrollTo({ left, behavior: 'smooth' }),
  }
}

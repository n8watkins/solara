'use client'
import { useEffect, useState, type RefObject } from 'react'

/** The horizontally visible part of an element, in px from its own left edge. */
export interface VisibleSpan {
  left: number
  right: number
  /** True when a scroll container clips the element (it is wider than its view). */
  clipped: boolean
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowX } = getComputedStyle(node)
    if (overflowX === 'auto' || overflowX === 'scroll') return node
  }
  return null
}

/**
 * Which slice of `ref`'s element its nearest horizontal scroller shows, kept current
 * as that scroller scrolls or resizes. Null before mount. Without a scroller the
 * whole element counts as visible.
 */
export function useVisibleSpan(ref: RefObject<HTMLElement | null>): VisibleSpan | null {
  const [span, setSpan] = useState<VisibleSpan | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const scroller = scrollParent(el)
    let frame: number | null = null
    const measure = () => {
      frame = null
      const box = el.getBoundingClientRect()
      let left = 0
      let right = box.width
      if (scroller) {
        const view = scroller.getBoundingClientRect()
        const viewLeft = view.left + scroller.clientLeft
        left = Math.max(0, viewLeft - box.left)
        right = Math.min(box.width, viewLeft + scroller.clientWidth - box.left)
      }
      const clipped = right - left < box.width - 0.5
      setSpan(prev =>
        prev && prev.left === left && prev.right === right && prev.clipped === clipped
          ? prev
          : { left, right, clipped },
      )
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(el)
    if (scroller) observer?.observe(scroller)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      scroller?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [ref])
  return span
}

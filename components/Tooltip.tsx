'use client'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { shiftIntoView } from '@/lib/roving-focus'
import styles from './Tooltip.module.css'

interface Props {
  text: string
  children: ReactNode
}

// Keep the bubble at least this far from the viewport edges.
const EDGE = 8

/**
 * A "?" toggletip. The trigger is a real button, so it is reachable by
 * keyboard, and the text is its accessible description, so screen readers
 * read it on focus. The bubble shows on hover, focus or tap, stays open while
 * the pointer is over it, and Escape dismisses it (WCAG 1.4.13).
 */
export default function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false)
  const [shift, setShift] = useState(0)
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)

  // Nudge the bubble sideways so it never runs off a narrow screen.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!show || !bubble) return
    const rect = bubble.getBoundingClientRect()
    const next = shiftIntoView(
      rect.left - shift,
      rect.width,
      document.documentElement.clientWidth,
      EDGE,
    )
    if (next !== shift) setShift(next)
  }, [show, shift])

  // Tapping elsewhere closes a bubble opened by tap.
  useEffect(() => {
    if (!show) return
    function handle(event: PointerEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setShow(false)
    }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [show])

  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      style={{ position: 'relative' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <button
        type="button"
        className={styles.trigger}
        aria-label="More info"
        aria-describedby={id}
        aria-expanded={show}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        // Hover and focus already open it on desktop; a tap must not toggle it
        // shut again, so a click only ever opens.
        onClick={() => setShow(true)}
        onKeyDown={event => {
          if (event.key === 'Escape' && show) {
            event.preventDefault()
            event.stopPropagation()
            setShow(false)
          }
        }}
      >
        <span aria-hidden="true" className={styles.icon}>
          ?
        </span>
      </button>
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        hidden={!show}
        className={styles.bubble}
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        {text}
      </span>
    </span>
  )
}

'use client'
import { useEffect, useRef, useState } from 'react'

const TIPS = [
  {
    icon: '📈',
    title: 'Higher UV means more risk',
    body: 'As the UV index rises, skin and eye damage can happen faster.',
  },
  {
    icon: '🧴',
    title: 'Protect at UV 3+',
    body: 'Public-health guidance recommends sun protection when the UV index is 3 or higher.',
  },
  {
    icon: '👒',
    title: 'Use layers of protection',
    body: 'Combine shade, clothing, a hat, sunglasses, and broad-spectrum sunscreen when protection is needed.',
  },
  {
    icon: '☁️',
    title: 'Clouds are not a shield',
    body: 'UV can remain high under cloud cover, so check the UV index instead of judging by brightness.',
  },
  {
    icon: '🏖️',
    title: 'Reflections matter',
    body: 'Water, sand, snow, and other bright surfaces can increase UV exposure.',
  },
  {
    icon: '🌤️',
    title: 'Vitamin D varies',
    body: 'Sun exposure is not a precise vitamin D dose. Ask a clinician about diet or supplements if you are concerned.',
  },
]

export default function TipCarousel() {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  // Guards the scroll handler from re-firing while WE animate to a tip (auto-advance
  // or dot tap), so it doesn't fight the programmatic scroll.
  const programmatic = useRef(false)
  const programmaticTimer = useRef<number | null>(null)

  function goTo(i: number) {
    const track = trackRef.current
    if (!track) {
      setIdx(i)
      return
    }
    const slide = track.children[i] as HTMLElement | undefined
    if (!slide) {
      setIdx(i)
      return
    }
    programmatic.current = true
    track.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' })
    setIdx(i)
    if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
    programmaticTimer.current = window.setTimeout(() => {
      programmatic.current = false
    }, 400)
  }

  // Auto-advance; pauses on hover/focus and respects reduced motion.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (paused || reduceMotion) return
    const t = setInterval(() => goTo((idx + 1) % TIPS.length), 6500)
    return () => clearInterval(t)
  }, [paused, idx])

  // Track the visible slide as the user swipes, debounced to a frame.
  function onScroll() {
    if (programmatic.current) return
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const track = trackRef.current
      if (!track) return
      const i = Math.round(track.scrollLeft / track.clientWidth)
      if (i !== idx && i >= 0 && i < TIPS.length) setIdx(i)
    })
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
    },
    [],
  )

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        background: 'rgba(251,191,36,0.09)',
        border: '0.5px solid rgba(251,191,36,0.28)',
        borderRadius: '12px',
        padding: '10px 12px',
        maxWidth: '680px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="tip-track"
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch' as never,
        }}
      >
        {TIPS.map(tip => (
          <div
            key={tip.title}
            style={{
              flex: '0 0 100%',
              minWidth: '100%',
              scrollSnapAlign: 'start',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '20px', flexShrink: 0 }}>{tip.icon}</span>
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  lineHeight: 1.2,
                }}
              >
                {tip.title}
              </p>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: '12.5px',
                  color: 'var(--text-2)',
                  lineHeight: 1.4,
                }}
              >
                {tip.body}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '5px', marginTop: '8px', justifyContent: 'center' }}>
        {TIPS.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === idx ? '16px' : '6px',
              height: '6px',
              borderRadius: '3px',
              border: 'none',
              cursor: 'pointer',
              background: i === idx ? 'var(--accent)' : 'rgba(251,191,36,0.35)',
              transition: 'all 0.3s ease',
              padding: 0,
            }}
            aria-label={`Show tip ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

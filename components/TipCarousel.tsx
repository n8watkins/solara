'use client'
import { useEffect, useRef, useState } from 'react'

const TIPS = [
  { icon: '🌤️', title: 'UV & vitamin D', body: 'Skin needs UVB to make vitamin D — a few minutes with arms and legs bare (no glass, no SPF) on a sunny day.' },
  { icon: '🧴', title: 'SPF blocks vitamin D', body: 'SPF 30+ blocks ~97% of UVB. Skip it for the first few minutes, then apply before you burn.' },
  { icon: '⏰', title: 'Timing matters', body: 'Vitamin D peaks midday (10am–2pm) — but so does burn risk. A low-UV morning gives D without the damage.' },
  { icon: '💡', title: 'Glass blocks UVB', body: 'A sunny window won\'t make vitamin D — UVB doesn\'t pass through standard glass. Get outside.' },
  { icon: '🔄', title: 'Not needed daily', body: 'Your body stores vitamin D for weeks. A few good outdoor sessions a week is plenty.' },
  { icon: '🌍', title: 'Skin tone matters', body: 'More melanin means less UVB absorbed — darker skin needs more sun time for the same vitamin D.' },
]

export default function TipCarousel() {
  const [idx, setIdx]       = useState(0)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  // Guards the scroll handler from re-firing while WE animate to a tip (auto-advance
  // or dot tap), so it doesn't fight the programmatic scroll.
  const programmatic = useRef(false)
  const programmaticTimer = useRef<number | null>(null)

  function goTo(i: number) {
    const track = trackRef.current
    if (!track) { setIdx(i); return }
    const slide = track.children[i] as HTMLElement | undefined
    if (!slide) { setIdx(i); return }
    programmatic.current = true
    track.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' })
    setIdx(i)
    if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
    programmaticTimer.current = window.setTimeout(() => { programmatic.current = false }, 400)
  }

  // Auto-advance; pauses on hover/focus and respects reduced motion.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (paused || reduceMotion) return
    const t = setInterval(() => goTo((idx + 1) % TIPS.length), 6500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
  }, [])

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
              flex: '0 0 100%', minWidth: '100%',
              scrollSnapAlign: 'start',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}
          >
            <span style={{ fontSize: '20px', flexShrink: 0 }}>{tip.icon}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                {tip.title}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--text-2)', lineHeight: 1.4 }}>
                {tip.body}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '5px', marginTop: '8px', justifyContent: 'center' }}>
        {TIPS.map((_, i) => (
          <button key={i} onClick={() => goTo(i)} style={{
            width: i === idx ? '16px' : '6px', height: '6px',
            borderRadius: '3px', border: 'none', cursor: 'pointer',
            background: i === idx ? 'var(--accent)' : 'rgba(251,191,36,0.35)',
            transition: 'all 0.3s ease', padding: 0,
          }} aria-label={`Show tip ${i + 1}`} />
        ))}
      </div>
    </div>
  )
}

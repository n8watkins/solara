'use client'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

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
  // `paused` is the temporary hover/focus pause; `stopped` is the user's
  // explicit choice from the pause button (WCAG 2.2.2).
  const [paused, setPaused] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [canAutoplay, setCanAutoplay] = useState(false)
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

  // Reduced motion turns autoplay off entirely, and with it the pause button.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The media query is browser-only; reading it after hydration keeps the static export's markup stable.
    setCanAutoplay(!reduceMotion)
  }, [])

  // Auto-advance; pauses on hover/focus or when the user stops it.
  useEffect(() => {
    if (paused || stopped || !canAutoplay) return
    const t = setInterval(() => goTo((idx + 1) % TIPS.length), 6500)
    return () => clearInterval(t)
  }, [paused, stopped, canAutoplay, idx])

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

  const autoplay = !paused && !stopped
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Sun safety tips"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="box-border w-full rounded-xl border-[0.5px] border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.09)] px-3 pt-2.5 pb-px"
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        // Focusable so keyboard users can scroll it with the arrow keys.
        tabIndex={0}
        aria-live={autoplay ? 'off' : 'polite'}
        className="tip-track flex snap-x snap-mandatory overflow-x-auto rounded-md [scrollbar-width:none]"
      >
        {TIPS.map((tip, i) => (
          <div
            key={tip.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${TIPS.length}`}
            aria-hidden={i !== idx}
            className="flex min-w-full flex-[0_0_100%] snap-start items-center gap-2.5"
          >
            <span aria-hidden="true" className="shrink-0 text-[20px]">
              {tip.icon}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-[1.2] font-bold text-ink">{tip.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-2">{tip.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center">
        {TIPS.map((_, i) => (
          // A 24 px target around the small visible dot (WCAG 2.5.8).
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show tip ${i + 1}`}
            aria-current={i === idx ? 'true' : undefined}
            className="flex h-6 min-w-6 items-center justify-center rounded-md px-0.5"
          >
            <span
              aria-hidden="true"
              className={clsx(
                'block h-1.5 rounded-[3px] transition-all duration-300 ease-[ease]',
                i === idx ? 'w-4 bg-accent' : 'w-1.5 bg-[rgba(251,191,36,0.35)]',
              )}
            />
          </button>
        ))}
        {canAutoplay && (
          <button
            type="button"
            onClick={() => setStopped(s => !s)}
            aria-label={stopped ? 'Play tips' : 'Pause tips'}
            className="ml-0.5 flex size-6 items-center justify-center rounded-md p-0 text-[10px] leading-none text-ink-3"
          >
            {stopped ? (
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 1.2v7.6L8.6 5z" fill="currentColor" />
              </svg>
            ) : (
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
                <rect x="1.8" y="1.2" width="2.2" height="7.6" rx="0.6" fill="currentColor" />
                <rect x="6" y="1.2" width="2.2" height="7.6" rx="0.6" fill="currentColor" />
              </svg>
            )}
          </button>
        )}
      </div>
    </section>
  )
}

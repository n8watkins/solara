'use client'
import { useEffect, useState } from 'react'

const TIPS = [
  { icon: '🌤️', title: 'UV & vitamin D', body: 'Your skin needs UVB light to produce vitamin D. A few minutes with arms and legs exposed — no glass, no sunscreen — is enough on a sunny day.' },
  { icon: '🧴', title: 'Sunscreen blocks vitamin D', body: 'SPF 30+ blocks ~97% of UVB. For your vitamin D window, skip sunscreen for the first few minutes, then apply before you burn.' },
  { icon: '⏰', title: 'Timing matters', body: 'Vitamin D production peaks when UV is high (10am–2pm), but so does burn risk. A low-UV morning window gives you D without the damage.' },
  { icon: '💡', title: 'Glass blocks UVB', body: 'Sitting by a sunny window won\'t produce vitamin D. UVB doesn\'t pass through standard glass — you need to be outside.' },
  { icon: '🔄', title: 'You don\'t need it daily', body: 'Your body stores vitamin D for weeks. A few good outdoor sessions per week is plenty for most people.' },
  { icon: '🌍', title: 'Skin tone matters', body: 'Darker skin has more melanin, which reduces UVB absorption. People with darker skin tones need more sun time to produce the same vitamin D.' },
]

export default function TipCarousel() {
  const [idx, setIdx]       = useState(0)
  const [fade, setFade]     = useState(true)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (paused || reduceMotion) return
    const t = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIdx(i => (i + 1) % TIPS.length)
        setFade(true)
      }, 300)
    }, 6500)
    return () => clearInterval(t)
  }, [paused])

  const tip = TIPS[idx]

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        background: 'rgba(251,191,36,0.09)',
        border: '0.5px solid rgba(251,191,36,0.28)',
        borderRadius: '16px',
        padding: '16px 18px',
        maxWidth: '680px',
        width: '100%',
        margin: '0 auto',
        boxShadow: '0 10px 28px rgba(120, 53, 15, 0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <span style={{ fontSize: '24px', flexShrink: 0, marginTop: '1px' }}>{tip.icon}</span>
        <div style={{
          opacity: fade ? 1 : 0,
          transition: 'opacity 0.3s ease',
          flex: 1,
        }}>
          <p style={{ margin: '0 0 5px', fontSize: '15px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>
            {tip.title}
          </p>
          <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--text-2)', lineHeight: '1.6' }}>
            {tip.body}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '5px', marginTop: '12px', justifyContent: 'center' }}>
        {TIPS.map((_, i) => (
          <button key={i} onClick={() => { setFade(false); setTimeout(() => { setIdx(i); setFade(true) }, 200) }} style={{
            width: i === idx ? '18px' : '7px', height: '7px',
            borderRadius: '4px', border: 'none', cursor: 'pointer',
            background: i === idx ? 'var(--accent)' : 'rgba(251,191,36,0.35)',
            transition: 'all 0.3s ease', padding: 0,
          }} aria-label={`Show tip ${i + 1}`} />
        ))}
      </div>
    </div>
  )
}

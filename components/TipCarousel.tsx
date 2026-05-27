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

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIdx(i => (i + 1) % TIPS.length)
        setFade(true)
      }, 300)
    }, 6000)
    return () => clearInterval(t)
  }, [])

  const tip = TIPS[idx]

  return (
    <div style={{
      background: 'rgba(251,191,36,0.08)',
      border: '0.5px solid rgba(251,191,36,0.25)',
      borderRadius: '14px', padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '20px', flexShrink: 0, marginTop: '1px' }}>{tip.icon}</span>
        <div style={{
          opacity: fade ? 1 : 0,
          transition: 'opacity 0.3s ease',
          flex: 1,
        }}>
          <p style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            {tip.title}
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.55' }}>
            {tip.body}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '10px', justifyContent: 'center' }}>
        {TIPS.map((_, i) => (
          <button key={i} onClick={() => { setFade(false); setTimeout(() => { setIdx(i); setFade(true) }, 200) }} style={{
            width: i === idx ? '16px' : '6px', height: '6px',
            borderRadius: '3px', border: 'none', cursor: 'pointer',
            background: i === idx ? 'var(--accent)' : 'rgba(251,191,36,0.3)',
            transition: 'all 0.3s ease', padding: 0,
          }} />
        ))}
      </div>
    </div>
  )
}

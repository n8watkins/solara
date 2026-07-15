'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseActivityShareParams } from '@/lib/share'
import { fmtClock } from '@/lib/weather'

function ShareContent() {
  const sharedPlan = parseActivityShareParams(useSearchParams())

  if (!sharedPlan) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="card" style={{ width: '100%', maxWidth: '520px', textAlign: 'center', padding: '32px 26px' }}>
          <p style={{ fontSize: '42px', margin: '0 0 12px' }}>☀️</p>
          <h1 style={{ margin: '0 0 10px', fontSize: '26px', color: 'var(--text)' }}>This shared plan is incomplete</h1>
          <p style={{ margin: '0 0 22px', fontSize: '15px', color: 'var(--text-2)', lineHeight: 1.55 }}>
            The link is missing activity or time information. Ask the sender for a new link, or create a fresh plan in Solara.
          </p>
          <a href="/" className="btn btn-primary" style={{ display: 'inline-flex', textDecoration: 'none', justifyContent: 'center', padding: '11px 18px' }}>
            Open Solara
          </a>
        </div>
      </main>
    )
  }

  const { activity, icon, city, region, date, from, to, uv } = sharedPlan
  const place = `${city}${region ? `, ${region}` : ''}`

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '560px', textAlign: 'center', padding: '32px 26px' }}>
        <p style={{ fontSize: '46px', margin: '0 0 12px' }}>{icon}</p>
        <p style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 750 }}>Solara activity window</p>
        <h1 style={{ margin: '0 0 10px', fontSize: '28px', color: 'var(--text)', lineHeight: 1.15 }}>{activity}</h1>
        <p style={{ margin: '0 0 22px', fontSize: '16px', color: 'var(--text-2)', lineHeight: 1.5 }}>
          {date} · {fmtClock(from)}–{fmtClock(to)} · {place}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: uv ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '24px' }}>
          <div className="metric-card">
            <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Recommended window</p>
            <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{fmtClock(from)}–{fmtClock(to)}</p>
          </div>
          {uv && (
            <div className="metric-card">
              <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Peak UV</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{uv}</p>
            </div>
          )}
        </div>
        <p style={{ margin: '0 0 22px', fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.55 }}>
          This is a forecast-based planning estimate, not medical advice. Recheck current UV and use appropriate sun protection.
        </p>
        <a href="/" className="btn btn-primary" style={{ display: 'inline-flex', textDecoration: 'none', justifyContent: 'center', padding: '11px 18px' }}>
          Open Solara
        </a>
      </div>
    </main>
  )
}

export default function SharePage() {
  return (
    <Suspense fallback={<main style={{ minHeight: '100vh', background: 'var(--bg)' }} />}>
      <ShareContent />
    </Suspense>
  )
}

'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtHour } from '@/lib/weather'

function ShareContent() {
  const params = useSearchParams()
  const activity = params.get('a') || 'Outdoor activity'
  const icon = params.get('icon') || '☀️'
  const city = params.get('city') || 'your area'
  const region = params.get('region') || ''
  const date = params.get('date') || 'Today'
  const from = Number(params.get('from') || 0)
  const to = Number(params.get('to') || 0)
  const uv = params.get('uv')
  const place = `${city}${region ? `, ${region}` : ''}`

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '560px', textAlign: 'center', padding: '32px 26px' }}>
        <p style={{ fontSize: '46px', margin: '0 0 12px' }}>{icon}</p>
        <p style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 750 }}>Solara activity window</p>
        <h1 style={{ margin: '0 0 10px', fontSize: '28px', color: 'var(--text)', lineHeight: 1.15 }}>{activity}</h1>
        <p style={{ margin: '0 0 22px', fontSize: '16px', color: 'var(--text-2)', lineHeight: 1.5 }}>
          {date} · {fmtHour(from)}–{fmtHour(to)} · {place}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: uv ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '24px' }}>
          <div className="metric-card">
            <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Recommended window</p>
            <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{fmtHour(from)}–{fmtHour(to)}</p>
          </div>
          {uv && (
            <div className="metric-card">
              <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Peak UV</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{uv}</p>
            </div>
          )}
        </div>
        <p style={{ margin: '0 0 22px', fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.55 }}>
          This is a shared Solara planning window. Check current conditions before heading out — UV and weather can change.
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

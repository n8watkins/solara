'use client'
import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import DataAttribution from '@/components/DataAttribution'
import { formatShareDate, parseActivityShareParams, shareDateStatus } from '@/lib/share'
import { loadLocalPrefs } from '@/lib/prefs'
import { resolveUnits, unitFormatters } from '@/lib/units'

function ShareContent() {
  const sharedPlan = parseActivityShareParams(useSearchParams())

  if (!sharedPlan) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          className="card"
          style={{ width: '100%', maxWidth: '520px', textAlign: 'center', padding: '32px 26px' }}
        >
          <p style={{ fontSize: '42px', margin: '0 0 12px' }}>☀️</p>
          <h1
            style={{ margin: '0 0 10px', fontSize: '26px', fontWeight: 750, color: 'var(--text)' }}
          >
            This shared link can&apos;t be shown
          </h1>
          <p
            style={{
              margin: '0 0 22px',
              fontSize: '15px',
              color: 'var(--text-2)',
              lineHeight: 1.55,
            }}
          >
            The link is incomplete, out of date or contains text Solara doesn&apos;t display. Ask
            the sender for a new link, or plan your own lower-UV window in Solara.
          </p>
          <Link
            href="/"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              textDecoration: 'none',
              justifyContent: 'center',
              padding: '11px 18px',
            }}
          >
            Open Solara
          </Link>
        </div>
      </main>
    )
  }

  const { activity, icon, city, region, date, from, to, uv } = sharedPlan
  const place = `${city}${region ? `, ${region}` : ''}`
  const isPast = shareDateStatus(date) === 'past'
  // The viewer's clock: their saved choice on this device, else their locale's.
  // (This content renders only in the browser: useSearchParams opts it out of the
  // static prerender.)
  const fmt = unitFormatters(resolveUnits(loadLocalPrefs()))

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: '560px', textAlign: 'center', padding: '32px 26px' }}
      >
        <p style={{ fontSize: '46px', margin: '0 0 12px' }}>{icon}</p>
        <p
          style={{
            margin: '0 0 6px',
            fontSize: '13px',
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 750,
          }}
        >
          Shared Solara plan
        </p>
        <h1
          style={{
            margin: '0 0 10px',
            fontSize: '28px',
            fontWeight: 750,
            color: 'var(--text)',
            lineHeight: 1.15,
          }}
        >
          {activity}
        </h1>
        <p
          style={{ margin: '0 0 22px', fontSize: '16px', color: 'var(--text-2)', lineHeight: 1.5 }}
        >
          {formatShareDate(date)} · {fmt.time(from)}–{fmt.time(to)} · {place}
        </p>
        {isPast && (
          <p
            role="status"
            style={{
              margin: '0 0 18px',
              padding: '10px 12px',
              borderRadius: '10px',
              fontSize: '14px',
              color: 'var(--text)',
              background: 'var(--bg-metric)',
              border: '0.5px solid var(--border-md)',
            }}
          >
            This plan was for a day that has passed. Open Solara for today&apos;s forecast.
          </p>
        )}
        <div
          style={{
            display: 'grid',
            // Side by side when there is room, stacked on phones.
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
            marginBottom: '24px',
          }}
        >
          <div className="metric-card">
            <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>
              Recommended window
            </p>
            <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>
              {fmt.time(from)}–{fmt.time(to)}
            </p>
          </div>
          {uv && (
            <div className="metric-card">
              <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Peak UV</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>
                {uv}
              </p>
            </div>
          )}
        </div>
        <p
          style={{ margin: '0 0 22px', fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.55 }}
        >
          This is a forecast-based planning estimate, not medical advice. Recheck current UV and use
          appropriate sun protection. The activity and place names were written by the person who
          shared this link.
        </p>
        <Link
          href="/"
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            textDecoration: 'none',
            justifyContent: 'center',
            padding: '11px 18px',
          }}
        >
          Plan your own lower-UV window
        </Link>
        <DataAttribution style={{ marginTop: '22px' }} />
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

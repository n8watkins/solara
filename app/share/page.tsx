'use client'
import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'
import clsx from 'clsx'
import { useSearchParams } from 'next/navigation'
import DataAttribution from '@/components/DataAttribution'
import { formatShareDate, parseActivityShareParams, shareDateStatus } from '@/lib/share'
import { loadLocalPrefs } from '@/lib/prefs'
import { resolveUnits, unitFormatters } from '@/lib/units'

/** The centered card every share page state uses, with the call to action. */
function ShareCard({
  width,
  children,
  cta,
  footer,
}: {
  width: 'narrow' | 'wide'
  children: ReactNode
  cta: string
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div
        className={clsx(
          'card w-full px-[26px] py-8 text-center',
          width === 'narrow' ? 'max-w-[520px]' : 'max-w-[560px]',
        )}
      >
        {children}
        <Link href="/" className="btn btn-primary justify-center px-[18px] py-[11px] no-underline">
          {cta}
        </Link>
        {footer}
      </div>
    </main>
  )
}

function ShareContent() {
  const sharedPlan = parseActivityShareParams(useSearchParams())

  if (!sharedPlan) {
    return (
      <ShareCard width="narrow" cta="Open Solara">
        <p className="mb-3 text-[42px]">☀️</p>
        <h1 className="mb-2.5 text-[26px] font-[750] text-ink">
          This shared link can&apos;t be shown
        </h1>
        <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
          The link is incomplete, out of date or contains text Solara doesn&apos;t display. Ask the
          sender for a new link, or plan your own lower-UV window in Solara.
        </p>
      </ShareCard>
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
    <ShareCard
      width="wide"
      cta="Plan your own lower-UV window"
      footer={<DataAttribution className="mt-[22px]" />}
    >
      <p className="mb-3 text-[46px]">{icon}</p>
      <p className="mb-1.5 text-[13px] font-[750] tracking-[0.08em] text-ink-3 uppercase">
        Shared Solara plan
      </p>
      <h1 className="mb-2.5 text-[28px] leading-[1.15] font-[750] text-ink">{activity}</h1>
      <p className="mb-[22px] text-[16px] leading-normal text-ink-2">
        {formatShareDate(date)} · {fmt.time(from)}–{fmt.time(to)} · {place}
      </p>
      {isPast && (
        <p
          role="status"
          className="mb-[18px] rounded-[10px] border-[0.5px] border-line-strong bg-surface-metric px-3 py-2.5 text-[14px] text-ink"
        >
          This plan was for a day that has passed. Open Solara for today&apos;s forecast.
        </p>
      )}
      {/* Side by side when there is room, stacked on phones. */}
      <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
        <ShareMetric label="Recommended window" value={`${fmt.time(from)}–${fmt.time(to)}`} />
        {uv && <ShareMetric label="Peak UV" value={uv} />}
      </div>
      <p className="mb-[22px] text-[14px] leading-[1.55] text-ink-3">
        This is a forecast-based planning estimate, not medical advice. Recheck current UV and use
        appropriate sun protection. The activity and place names were written by the person who
        shared this link.
      </p>
    </ShareCard>
  )
}

function ShareMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <p className="mb-1 text-[12px] text-ink-3">{label}</p>
      <p className="text-[22px] font-extrabold text-accent">{value}</p>
    </div>
  )
}

export default function SharePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-surface" />}>
      <ShareContent />
    </Suspense>
  )
}

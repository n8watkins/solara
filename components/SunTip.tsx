'use client'
import { useState } from 'react'
import { hideTips, takeTip } from '@/lib/tips'

/**
 * One sun safety tip, static and dismissible; a different one each visit
 * (lib/tips.ts).
 */
export default function SunTip() {
  // Read once per mount: the dashboard renders only in the browser, after the forecast.
  const [tip, setTip] = useState(() => takeTip())
  if (!tip) return null
  return (
    <aside
      role="note"
      aria-label="Sun safety tip"
      className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.09)] py-2.5 pr-1.5 pl-3"
    >
      <span aria-hidden="true" className="mt-px shrink-0 text-[20px] leading-none">
        {tip.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[1.2] font-bold text-ink">{tip.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-2">{tip.body}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          hideTips()
          setTip(null)
        }}
        aria-label="Hide tips"
        title="Hide tips"
        className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-[17px] text-ink-3"
      >
        <span aria-hidden="true">×</span>
      </button>
    </aside>
  )
}

'use client'
import { Cloud, CloudSun, Droplets, Shirt, TrendingUp, Waves, type LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { useState } from 'react'
import { hideTips, takeTip, type TipIcon } from '@/lib/tips'

const ICONS: Record<TipIcon, LucideIcon> = {
  trend: TrendingUp,
  sunscreen: Droplets,
  layers: Shirt,
  cloud: Cloud,
  reflection: Waves,
  vitamin: CloudSun,
}

/**
 * One sun safety tip, static and dismissible; a different one each visit
 * (lib/tips.ts).
 */
export default function SunTip() {
  // Read once per mount: the dashboard renders only in the browser, after the forecast.
  const [tip, setTip] = useState(() => takeTip())
  if (!tip) return null
  const Icon = ICONS[tip.icon]
  return (
    <aside
      role="note"
      aria-label="Sun safety tip"
      className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.09)] py-2.5 pr-1.5 pl-3"
    >
      <Icon size={20} className="mt-px shrink-0 text-accent" />
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
        <X size={17} />
      </button>
    </aside>
  )
}

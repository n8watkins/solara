'use client'
import { Plane } from 'lucide-react'
import clsx from 'clsx'
import type { Location } from '@/lib/types'
import { NOTICE_TONES } from './AppNotice'
import m from '@/messages/travel'

/**
 * The travel prompt (ROADMAP item 54): a calm banner above the dashboard when the device
 * is far from the place shown. "Switch" shows the place on this device (home stays home);
 * "Not now" hides it for a day around that place. Loaded only when it shows
 * (components/deferred.tsx).
 */
export default function TravelBanner({
  place,
  onSwitch,
  onNotNow,
}: {
  place: Location
  onSwitch: () => void
  onNotNow: () => void
}) {
  return (
    <div
      role="status"
      data-testid="travel-banner"
      className={clsx(
        'mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border-[0.5px] px-4 py-3 text-[14px]',
        NOTICE_TONES.info,
      )}
    >
      <Plane size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-[1_1_14rem]">{m.seemToBeIn(place.city)}</span>
      <span className="ml-auto flex shrink-0 gap-2">
        <button type="button" className="btn text-[12px]" onClick={onNotNow}>
          {m.notNow}
        </button>
        <button type="button" className="btn btn-primary text-[12px]" onClick={onSwitch}>
          {m.switchHere}
        </button>
      </span>
    </div>
  )
}

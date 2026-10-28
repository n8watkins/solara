'use client'
import { useEffect, useId, useState } from 'react'
import clsx from 'clsx'
import { UserRoundCheck } from 'lucide-react'
import {
  clearReplacedGuestPlan,
  readReplacedGuestPlan,
  replacedGuestPlanLines,
} from '@/lib/guest-replaced'
import { NOTICE_TONES } from './AppNotice'

/**
 * Tells someone who signed in from guest mode to an account that already existed that
 * the account kept its own plan, and what the guest plan on this device held that was
 * not added to it (lib/guest-replaced.ts). Shown once: the record is removed as soon as
 * the notice shows, and the notice stays until it is dismissed.
 */
export default function GuestPlanNotice({ uid }: { uid: string }) {
  const [replaced, setReplaced] = useState(() => readReplacedGuestPlan(uid))
  const titleId = useId()
  useEffect(() => {
    if (replaced) clearReplacedGuestPlan()
  }, [replaced])
  if (!replaced) return null
  const lines = replacedGuestPlanLines(replaced)
  return (
    <div
      role="status"
      aria-labelledby={titleId}
      className={clsx(
        // Phones put "Got it" under the text, so the text keeps the notice's full width.
        'mb-4 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-3 rounded-xl border-[0.5px] px-4 py-3.5 text-[14px] sm:grid-cols-[auto_1fr_auto]',
        NOTICE_TONES.info,
      )}
    >
      <UserRoundCheck aria-hidden="true" size={18} strokeWidth={2.25} className="mt-px" />
      <div className="min-w-0">
        <p id={titleId} className="font-semibold">
          Welcome back. Your account kept its own plan.
        </p>
        <p className="mt-1 leading-[1.45]">
          The guest plan from this device wasn&apos;t added to it, so these weren&apos;t saved:
        </p>
        <ul className="mt-1.5 list-disc pl-5 leading-[1.45]">
          {lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1.5 leading-[1.45]">You can add any of them again whenever you like.</p>
      </div>
      <button
        type="button"
        className="btn col-start-2 justify-self-start text-[12px] sm:col-start-3 sm:row-start-1"
        onClick={() => setReplaced(null)}
      >
        Got it
      </button>
    </div>
  )
}

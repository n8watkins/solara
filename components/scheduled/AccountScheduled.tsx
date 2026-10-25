'use client'
import { memo, useEffect } from 'react'
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar'
import type { ScheduledController } from '@/lib/scheduled-context'
import type { Activity } from '@/lib/types'

/** The live controller of one account, as AccountScheduled reports it. */
export interface AccountController {
  uid: string
  controller: ScheduledController
}

/**
 * Runs the scheduled-activities controller of one signed-in account
 * (hooks/useGoogleCalendar.ts) and reports it to components/ScheduledProvider.tsx,
 * which provides it. It draws nothing: it sits beside the screens rather than around
 * them, so it can load after them (components/deferred.tsx) without remounting them.
 * Memoized, so the provider's re-render on each report never runs it again.
 */
function AccountScheduled({
  uid,
  activities,
  onController,
}: {
  uid: string
  activities: readonly Activity[]
  onController: (live: AccountController | null) => void
}) {
  const controller = useGoogleCalendar(uid, activities)
  useEffect(() => onController({ uid, controller }), [uid, controller, onController])
  useEffect(() => () => onController(null), [onController])
  return null
}

export default memo(AccountScheduled)

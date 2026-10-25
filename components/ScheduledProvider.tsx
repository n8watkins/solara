'use client'
import type { ReactNode } from 'react'
import { firebaseEnabled } from '@/lib/firebase'
import { isCalendarConfigured } from '@/lib/gcal-view'
import { DISABLED_SCHEDULED, ScheduledContext } from '@/lib/scheduled-context'
import type { Activity } from '@/lib/types'
import { AccountScheduled } from './deferred'

interface Props {
  /** The signed-in account, or null. Switching accounts drops everything in memory. */
  uid: string | null
  /** The account's activities, to decorate events found only in Google. */
  activities: readonly Activity[]
  children: ReactNode
}

/**
 * Supplies the scheduled-activities controller (lib/scheduled-context.ts): the real
 * one from hooks/useGoogleCalendar.ts for a signed-in account (loaded with the other
 * signed-in parts, components/deferred.tsx), or the disabled one.
 */
export default function ScheduledProvider({ uid, activities, children }: Props) {
  const enabled = !!uid && firebaseEnabled && isCalendarConfigured()
  if (!enabled) {
    return <ScheduledContext value={DISABLED_SCHEDULED}>{children}</ScheduledContext>
  }
  // Keyed by account so nothing (state or refs) survives a switch.
  return (
    <AccountScheduled key={uid} uid={uid} activities={activities}>
      {children}
    </AccountScheduled>
  )
}

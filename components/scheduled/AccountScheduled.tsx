'use client'
import type { ReactNode } from 'react'
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar'
import { ScheduledContext } from '@/lib/scheduled-context'
import type { Activity } from '@/lib/types'

/**
 * The scheduled-activities controller of one signed-in account (hooks/useGoogleCalendar.ts),
 * for components/ScheduledProvider.tsx, which loads it only for someone signed in.
 */
export default function AccountScheduled({
  uid,
  activities,
  children,
}: {
  uid: string
  activities: readonly Activity[]
  children: ReactNode
}) {
  const controller = useGoogleCalendar(uid, activities)
  return <ScheduledContext value={controller}>{children}</ScheduledContext>
}

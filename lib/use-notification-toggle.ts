'use client'
import { useState } from 'react'
import type { User } from 'firebase/auth'
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabledLocally,
} from './notifications'

/** Whether this device gets morning notifications, could, or never can. */
export type NotificationStatus = 'enabled' | 'blocked' | 'default'

/**
 * The status shown in Settings. `permission` is null where the browser has no
 * Notification API, which counts as blocked: there is nothing to turn on.
 */
export function notificationStatus(
  permission: NotificationPermission | null,
  enabledLocally: boolean,
): NotificationStatus {
  if (permission === 'granted') return enabledLocally ? 'enabled' : 'default'
  if (permission === 'denied' || permission === null) return 'blocked'
  return 'default'
}

function browserPermission(): NotificationPermission | null {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null
}

function readStatus(user: User | null | undefined): NotificationStatus {
  const permission = browserPermission()
  return notificationStatus(
    permission,
    permission === 'granted' && !!user && notificationsEnabledLocally(user.uid),
  )
}

/** Turns morning notifications on or off for this device and tracks the result. */
export function useNotificationToggle(user: User | null | undefined) {
  // Settings only ever renders in the browser (it opens from the client-only
  // app), so the permission is read on first render instead of in an effect.
  const [status, setStatus] = useState<NotificationStatus>(() => readStatus(user))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: (uid: string) => Promise<void>, failure: string) {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      await action(user.uid)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure)
    } finally {
      setStatus(readStatus(user))
      setLoading(false)
    }
  }

  return {
    status,
    loading,
    error,
    enable: () => run(enableNotifications, 'Could not enable notifications'),
    disable: () => run(disableNotifications, 'Could not disable notifications'),
  }
}

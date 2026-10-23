'use client'

import { useState } from 'react'
import type { User } from 'firebase/auth'
import { enableNotifications, notificationRegistrationConfigured } from '@/lib/notifications'

interface Props {
  user: User | null
  onDismiss: () => void
}

export default function NotificationBanner({ user, onDismiss }: Props) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  if (!notificationRegistrationConfigured()) return null

  async function handleEnable() {
    if (!user) return
    setLoading(true)
    try {
      await enableNotifications(user.uid)
      setStatus('success')
      setTimeout(onDismiss, 2000)
    } catch {
      setStatus('error')
    }
    setLoading(false)
  }

  if (status === 'success') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-sm text-green-800">
        <span>✓</span>
        <span>Notifications enabled. We will send a local-morning planning summary to this device.</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
        <span>⚠️</span>
        <span>Notifications could not be enabled. Check browser permission and your connection, then try again.</span>
        <button className="ml-auto text-amber-600 hover:text-amber-800" onClick={onDismiss}>✕</button>
      </div>
    )
  }

  return (
    <div className="mb-4 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
      <span className="text-lg">🔔</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-orange-900">Get morning sun alerts</p>
        <p className="text-xs text-orange-700 mt-0.5">Get a lower-UV planning summary each local morning.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          className="btn btn-primary text-xs px-3 py-1.5"
          onClick={handleEnable}
          disabled={loading}
        >
          {loading ? '...' : 'Enable'}
        </button>
        <button className="text-orange-400 hover:text-orange-600 text-lg leading-none" onClick={onDismiss}>✕</button>
      </div>
    </div>
  )
}

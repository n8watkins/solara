'use client'

import { useState } from 'react'
import { User } from 'firebase/auth'
import { requestNotificationPermission, saveFCMToken, saveFCMTokenLocally } from '@/lib/notifications'

interface Props {
  user: User | null
  onDismiss: () => void
}

export default function NotificationBanner({ user, onDismiss }: Props) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'denied'>('idle')

  async function handleEnable() {
    setLoading(true)
    const token = await requestNotificationPermission()
    if (token) {
      saveFCMTokenLocally(token)
      if (user) await saveFCMToken(user.uid, token)
      setStatus('success')
      setTimeout(onDismiss, 2000)
    } else {
      setStatus('denied')
    }
    setLoading(false)
  }

  if (status === 'success') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-sm text-green-800">
        <span>✓</span>
        <span>Notifications enabled — we'll alert you when your sun window opens each morning.</span>
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
        <span>⚠️</span>
        <span>Notification permission denied. You can enable it in your browser settings.</span>
        <button className="ml-auto text-amber-600 hover:text-amber-800" onClick={onDismiss}>✕</button>
      </div>
    )
  }

  return (
    <div className="mb-4 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
      <span className="text-lg">🔔</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-orange-900">Get morning sun alerts</p>
        <p className="text-xs text-orange-700 mt-0.5">We'll notify you when your activity window opens each day.</p>
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

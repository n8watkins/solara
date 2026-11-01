'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { loadAllMessages, loadInitialMessages } from '@/lib/i18n'

/**
 * Shows `children` once the page's language has every translation (lib/i18n.ts): for the
 * pages outside the app that render on their own (the account page, a shared plan). In
 * English that is at once; `fallback` shows meanwhile, and for good if they cannot load,
 * after which the page shows in English.
 */
export default function MessagesGate({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    const show = () => active && setReady(true)
    loadInitialMessages()
      .then(loadAllMessages)
      .then(show, error => {
        console.error('Could not load the translations:', error)
        show()
      })
    return () => {
      active = false
    }
  }, [])
  return ready ? children : fallback
}

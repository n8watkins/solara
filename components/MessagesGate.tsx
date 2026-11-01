'use client'
import { useEffect, useState, type ReactNode } from 'react'
import {
  loadAllMessages,
  loadInitialMessages,
  loadMessages,
  localizeTitle,
  type LazyNamespace,
} from '@/lib/i18n'

/**
 * Shows `children` once the page's language has the translations they read (lib/i18n.ts):
 * for the pages outside the app that render on their own (the account page, a shared
 * plan). `messages` names the namespaces beyond the opening screen's that the page reads
 * (messages/i18n.test.ts checks them), or 'all' (the UI harness). In English that is at
 * once; `fallback` shows meanwhile, and for good if they cannot load, after which the page
 * shows in English. The fallback is as tall as the screen by default, so the footer below
 * never paints at the top and jumps down when the page arrives (REVIEW10 QA L1).
 */
export default function MessagesGate({
  children,
  messages,
  fallback = <main className="min-h-screen bg-surface" />,
}: {
  children: ReactNode
  messages: readonly LazyNamespace[] | 'all'
  fallback?: ReactNode
}) {
  const [ready, setReady] = useState(false)
  // Read once: the page's namespaces never change while it is open.
  const [wanted] = useState(messages)
  useEffect(() => {
    let active = true
    const show = () => {
      if (!active) return
      setReady(true)
      localizeTitle()
    }
    loadInitialMessages()
      .then(() => (wanted === 'all' ? loadAllMessages() : loadMessages(wanted)))
      .then(show, error => {
        console.error('Could not load the translations:', error)
        show()
      })
    return () => {
      active = false
    }
  }, [wanted])
  return ready ? children : fallback
}

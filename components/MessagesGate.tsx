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
 * never paints at the top and jumps down when the page arrives, and the page waits for its
 * font too (FONT_WAIT_MS at most), so its text never reflows when the font swaps in
 * (REVIEW10 QA L1).
 */
const FONT_WAIT_MS = 1000

/** Resolves once the page's fonts have loaded, or after FONT_WAIT_MS. */
function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  return Promise.race([
    document.fonts.ready.then(() => {}),
    new Promise<void>(resolve => setTimeout(resolve, FONT_WAIT_MS)),
  ])
}

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
    Promise.all([
      loadInitialMessages().then(() =>
        wanted === 'all' ? loadAllMessages() : loadMessages(wanted),
      ),
      fontsReady(),
    ]).then(show, error => {
      console.error('Could not load the translations:', error)
      show()
    })
    return () => {
      active = false
    }
  }, [wanted])
  return ready ? children : fallback
}

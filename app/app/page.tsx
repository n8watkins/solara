'use client'

import { useSyncExternalStore } from 'react'
import App from '@/components/App'
import { AccountLoading } from '@/components/AccountStatus'
import { initialMessagesReady, loadInitialMessages, subscribeMessages } from '@/lib/i18n'

// The app (guest or signed in). Client-only: it reads the browser's auth session,
// the guest plan and the clock, none of which exist at build time, so the exported
// page shows the loading screen (which also keeps the footer below the fold instead
// of jumping down) and the app renders right after hydration. App is imported
// statically, so its code downloads with the page's own scripts instead of after
// them (a lazy import would add a round trip before anything shows).
const noSubscription = () => () => {}

// The page's language starts with the page's own scripts: English at once, another
// language once its opening screen's text has arrived (lib/i18n.ts).
if (typeof window !== 'undefined') void loadInitialMessages().catch(() => {})

export default function AppPage() {
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  const messagesReady = useSyncExternalStore(subscribeMessages, initialMessagesReady, () => false)
  return inBrowser && messagesReady ? <App /> : <AccountLoading />
}

'use client'

import { useSyncExternalStore } from 'react'
import App from '@/components/App'
import { AccountLoading } from '@/components/AccountStatus'

// The app (guest or signed in). Client-only: it reads the browser's auth session,
// the guest plan and the clock, none of which exist at build time, so the exported
// page shows the loading screen (which also keeps the footer below the fold instead
// of jumping down) and the app renders right after hydration. App is imported
// statically, so its code downloads with the page's own scripts instead of after
// them (a lazy import would add a round trip before anything shows).
const noSubscription = () => () => {}

export default function AppPage() {
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  return inBrowser ? <App /> : <AccountLoading />
}

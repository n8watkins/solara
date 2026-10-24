'use client'

import dynamic from 'next/dynamic'

// The app (guest or signed in). Client-only: it reads the browser's auth session,
// the guest plan and the clock, none of which exist at build time.
const App = dynamic(() => import('@/components/App'), { ssr: false })

export default function AppPage() {
  return <App />
}

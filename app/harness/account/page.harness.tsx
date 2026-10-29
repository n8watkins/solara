'use client'
// UI harness route for the account page's signed-in controls (/harness/account/), which
// the real page shows only after Firebase confirms a session. Only built with
// NEXT_PUBLIC_UI_HARNESS=1, like app/harness/page.harness.tsx.
import dynamic from 'next/dynamic'

// Client-only: the fixture is chosen from the address, which a prerender cannot see.
const AccountHarness = dynamic(() => import('@/tests/harness/AccountHarness'), { ssr: false })

export default function AccountHarnessPage() {
  return <AccountHarness />
}

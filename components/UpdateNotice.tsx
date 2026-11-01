'use client'
import { useState } from 'react'
import type { UpdateReason } from '@/lib/stale-build'
import AppNotice from './AppNotice'
import t from '@/messages/app'
import m from '@/messages/updates'

/**
 * Says why the page just reloaded: Solara was deployed while it was open, and code it
 * asked for was gone (lib/stale-build.ts). Its own chunk, loaded only then; after the
 * reload every chunk is the new version's, so it loads.
 */
export default function UpdateNotice({ reason }: { reason: UpdateReason }) {
  const [shown, setShown] = useState(true)
  if (!shown) return null
  return (
    <AppNotice
      tone="info"
      role="status"
      action={{ label: t.dismiss, onClick: () => setShown(false) }}
    >
      {reason === 'sign-in' ? m.reloadedSignIn : m.reloaded}
    </AppNotice>
  )
}

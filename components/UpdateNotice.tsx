'use client'
import { useState } from 'react'
import type { UpdateReason } from '@/lib/stale-build'
import AppNotice from './AppNotice'
import t from '@/messages/app'

/**
 * Says why the page just reloaded: Solara was deployed while it was open, and code it
 * asked for was gone (lib/stale-build.ts). Part of the first load, not loaded on demand:
 * when the deploy is still settling, the reloaded page may not be able to load anything
 * else, and the notice must still show.
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
      {reason === 'sign-in' ? t.updatedReloadedSignIn : t.updatedReloaded}
    </AppNotice>
  )
}

// Gentle upsell (decision D7): each nudge shows at a natural moment, never as a
// pop-up on first arrival, and once dismissed it stays dismissed on this device.
import { useState } from 'react'

export type UpsellId = 'save-plan' | 'morning-alert'

export const UPSELL_DISMISSED_KEY = 'solara_upsells_dismissed'

function readDismissed(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(UPSELL_DISMISSED_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

export function isUpsellDismissed(id: UpsellId): boolean {
  return id in readDismissed()
}

/** Remembers on this device that the nudge was dismissed (with when, for support). */
export function dismissUpsell(id: UpsellId, now = new Date()): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      UPSELL_DISMISSED_KEY,
      JSON.stringify({ ...readDismissed(), [id]: now.toISOString() }),
    )
  } catch {}
}

/** Whether a nudge was dismissed on this device, and a way to dismiss it. */
export function useUpsellDismissal(id: UpsellId): [dismissed: boolean, dismiss: () => void] {
  const [dismissed, setDismissed] = useState(() => isUpsellDismissed(id))
  return [
    dismissed,
    () => {
      dismissUpsell(id)
      setDismissed(true)
    },
  ]
}

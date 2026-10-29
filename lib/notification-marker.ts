// One notification per delivery on this device. The push worker
// (scripts/sw/firebase-messaging-sw.ts), a push that arrives while Solara is open
// (lib/notifications.ts) and the reapply timer's own reminder (ReapplyTimer) each claim a
// marker named `<scope>:<key>` in this cache before they show anything, so whichever
// comes first shows it and the others do not.

/** The Cache Storage name the push worker uses too. */
export const DELIVERY_CACHE = 'solara-notification-deliveries-v1'

function marker(scopedKey: string): Request {
  return new Request(`/notification-delivery/${encodeURIComponent(scopedKey)}`)
}

/**
 * Claims the delivery `scopedKey` for showing: true when nothing on this device showed
 * it yet. Where Cache Storage is missing (some private windows), it is always true.
 */
export async function claimDelivery(scopedKey: string): Promise<boolean> {
  if (typeof caches === 'undefined') return true
  try {
    const cache = await caches.open(DELIVERY_CACHE)
    if (await cache.match(marker(scopedKey))) return false
    await cache.put(marker(scopedKey), new Response('shown'))
    return true
  } catch {
    return true
  }
}

/** Gives a claimed delivery back, when showing it failed. */
export async function releaseDelivery(scopedKey: string): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(DELIVERY_CACHE)
    await cache.delete(marker(scopedKey))
  } catch {}
}

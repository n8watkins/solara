/**
 * Pure helpers for the messaging service worker's notification clicks.
 * Kept free of service-worker globals so they can be unit tested.
 */

/**
 * The URL a notification click may open: the payload's link when it resolves to
 * an http(s) URL on Solara's own origin, otherwise the app (`/app/`). This stops
 * a notification payload from sending people to another site.
 */
export function safeNotificationUrl(link: unknown, origin: string): string {
  const home = new URL('/app/', origin).href
  if (typeof link !== 'string' || !link.trim()) return home
  try {
    const url = new URL(link, origin)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== origin)
      return home
    return url.href
  } catch {
    return home
  }
}

/**
 * Which open window to reuse for a click: one already showing `target`, else
 * any window on Solara's origin, else -1 to open a new one.
 */
export function chooseWindowClient(clientUrls: string[], target: string, origin: string): number {
  const exact = clientUrls.indexOf(target)
  if (exact !== -1) return exact
  return clientUrls.findIndex(url => {
    try {
      return new URL(url).origin === origin
    } catch {
      return false
    }
  })
}

// Kept out of lib/guest.ts, which is in every first load: only setup calls it.

/**
 * Asks the browser to keep this site's storage, so the guest plan is not cleared when
 * the device runs short of space (REVIEW10 VERIFY10 N4). Chromium and Safari decide on
 * their own, without asking the person; Firefox would show a permission prompt, so it is
 * not asked. It is a request, not a promise: Safari can still clear a site that has not
 * been opened for 7 days of browser use, which is why the copy offers sign-in instead of
 * promising the plan stays. Resolves to whether storage is persistent.
 */
export async function requestPersistentStorage(
  nav: Pick<Navigator, 'storage' | 'userAgent'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): Promise<boolean> {
  if (!nav?.storage?.persist || /\bFirefox\//.test(nav.userAgent)) return false
  const { storage } = nav
  try {
    if (await storage.persisted?.()) return true
    return await storage.persist()
  } catch {
    return false
  }
}

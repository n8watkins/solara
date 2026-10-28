// What the app header shows for the signed-in account and the current UV.
import { formatUV, uvBand, uvLabel, type UVBand } from './weather'

/** The letter on the avatar when the account has no photo. */
export function accountInitial(user: { displayName: string | null; email: string | null }): string {
  return (user.displayName ?? user.email ?? '?').trim().charAt(0).toUpperCase()
}

/** The header's current-UV chip, or null when the UV is unknown. */
export function headerUV(
  currentUV: number | null | undefined,
): { band: UVBand; value: string; level: string } | null {
  if (typeof currentUV !== 'number' || !Number.isFinite(currentUV)) return null
  return {
    band: uvBand(currentUV),
    value: formatUV(currentUV),
    level: uvLabel(currentUV),
  }
}

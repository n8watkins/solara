// Push notification settings shared by the Functions that send alerts
// (functions/src/notifications/alerts.ts) and a native Android app, which must create the
// notification channel with this id before Android shows a message sent to it.
import { sha256, utf8Bytes } from './sha256'

/** The Android notification channel UV, morning and event alerts are posted to. */
export const ANDROID_ALERT_CHANNEL_ID = 'solara-alerts'

/** The channel's name and description, as the Android app's settings show them. */
export const ANDROID_ALERT_CHANNEL = Object.freeze({
  id: ANDROID_ALERT_CHANNEL_ID,
  name: 'Sun alerts',
  description: 'Morning plans, UV alerts and event heads-ups from Solara.',
})

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Unpadded base64url of `bytes`. */
function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += BASE64URL[a >> 2]
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b !== undefined) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c !== undefined) out += BASE64URL[c & 63]
  }
  return out
}

/**
 * The per-account value a device shows one delivery under (`<scope>:<key>`), so a resent
 * push never shows twice: a hash of the account id, never the id itself. The Functions
 * put it in every push, and the web app's reapply timer tags its own reminder with it
 * (`reapplyReminderTag`), so the timer and the push show one notification.
 */
export function deliveryScope(uid: string): string {
  return base64url(sha256(utf8Bytes(`solara-notification:${uid}`))).slice(0, 22)
}

/** The delivery key of a reapply reminder: one per "remind me at" record. */
export function reapplyDeliveryKey(reminderId: string): string {
  return `reapply-v1:${reminderId}`
}

/** The tag a reapply reminder's push and the browser's own reminder share. */
export function reapplyReminderTag(uid: string, reminderId: string): string {
  return `${deliveryScope(uid)}:${reapplyDeliveryKey(reminderId)}`
}

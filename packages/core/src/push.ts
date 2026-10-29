// Push notification settings shared by the Functions that send alerts
// (functions/src/notifications/alerts.ts) and a native Android app, which must create the
// notification channel with this id before Android shows a message sent to it.

/** The Android notification channel UV, morning and event alerts are posted to. */
export const ANDROID_ALERT_CHANNEL_ID = 'solara-alerts'

/** The channel's name and description, as the Android app's settings show them. */
export const ANDROID_ALERT_CHANNEL = Object.freeze({
  id: ANDROID_ALERT_CHANNEL_ID,
  name: 'Sun alerts',
  description: 'Morning plans, UV alerts and event heads-ups from Solara.',
})

// Structured logging rules for every Function.
//
// Log through `logger` from `firebase-functions/logger` (never `console`), with a short
// constant message and the details as structured fields, so Cloud Logging can filter on
// them and attach the right severity:
//
//   logger.warn('stripeWebhook signature rejected', loggableError(error))
//
// Never log bearer or App Check tokens, feed or FCM tokens, email addresses or
// coordinates. Log ids (uid, event id, device id) instead. Text that comes from a third
// party (an SDK error message) goes through `redact` first; `loggableError` does that.

// The redaction rules are shared with the web app's error reports.
import { redact } from '#core'

export { redact }

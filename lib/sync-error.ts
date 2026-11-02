// The banner shown when saving preferences to the account fails (components/App.tsx).
import { NewerPreferencesVersionError } from '@solara/core/prefs-rules'
import m from '@/messages/dashboard'

/** A failed cloud save: retry it, or reload when a newer Solara wrote the document. */
export interface SyncError {
  message: string
  reload: boolean
}

export function syncErrorFor(error: unknown): SyncError {
  return error instanceof NewerPreferencesVersionError
    ? {
        message: m.syncNewerVersion,
        reload: true,
      }
    : {
        message: m.syncFailed,
        reload: false,
      }
}

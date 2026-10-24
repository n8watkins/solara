// The banner shown when saving preferences to the account fails (components/App.tsx).
import { NewerPreferencesVersionError } from '@solara/core'

/** A failed cloud save: retry it, or reload when a newer Solara wrote the document. */
export interface SyncError {
  message: string
  reload: boolean
}

export function syncErrorFor(error: unknown): SyncError {
  return error instanceof NewerPreferencesVersionError
    ? {
        message:
          'Solara was updated in another tab or device. Reload to keep editing your settings.',
        reload: true,
      }
    : {
        message: 'Saved on this device, but cloud sync failed. Retry when your connection returns.',
        reload: false,
      }
}

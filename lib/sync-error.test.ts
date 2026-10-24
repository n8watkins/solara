import { describe, expect, it } from 'vitest'
import { NewerPreferencesVersionError } from '@solara/core'
import { syncErrorFor } from './sync-error'

describe('syncErrorFor', () => {
  it('asks for a reload when a newer Solara wrote the account', () => {
    expect(syncErrorFor(new NewerPreferencesVersionError(99))).toMatchObject({ reload: true })
  })

  it('offers a retry for any other failure, such as a dropped connection', () => {
    expect(syncErrorFor(new Error('unavailable'))).toEqual({
      message: 'Saved on this device, but cloud sync failed. Retry when your connection returns.',
      reload: false,
    })
    expect(syncErrorFor('offline')).toMatchObject({ reload: false })
  })
})

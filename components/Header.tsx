'use client'

import { useState } from 'react'
import { User, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import { saveFirestorePrefs, saveLocalPrefs } from '@/lib/prefs'
import { UserPreferences } from '@/lib/types'
import PreferencesModal from './PreferencesModal'

interface Props {
  user: User | null
  prefs: UserPreferences
  onPrefsUpdate: (p: UserPreferences) => void
}

export default function Header({ user, prefs, onPrefsUpdate }: Props) {
  const [showPrefs, setShowPrefs] = useState(false)

  async function handleSignIn() {
    if (!auth || !googleProvider) return
    try {
      const result = await signInWithPopup(auth, googleProvider)
      if (result.user && prefs) {
        await saveFirestorePrefs(result.user.uid, { ...prefs, uid: result.user.uid })
      }
    } catch (e) {
      console.error(e)
    }
  }

  async function handleSignOut() {
    if (!auth) return
    await signOut(auth)
  }

  async function handlePrefsUpdate(updated: UserPreferences) {
    saveLocalPrefs(updated)
    if (user) await saveFirestorePrefs(user.uid, updated)
    onPrefsUpdate(updated)
    setShowPrefs(false)
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">☀️</span>
            <span className="font-semibold text-gray-900 text-lg">Solara</span>
            <span className="text-gray-400 text-sm ml-1">· {prefs.location.city}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn text-xs" onClick={() => setShowPrefs(true)}>
              ⚙️ Preferences
            </button>
            {firebaseEnabled && (
              user
                ? <button className="btn text-xs" onClick={handleSignOut}>Sign out</button>
                : <button className="btn text-xs" onClick={handleSignIn}>Sign in with Google</button>
            )}
          </div>
        </div>
      </header>

      {showPrefs && (
        <PreferencesModal
          prefs={prefs}
          onSave={handlePrefsUpdate}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </>
  )
}

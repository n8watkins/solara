import { createContext } from 'react'
import type { UserPreferences } from './types'

/**
 * What the app does once sign-in from anywhere inside it has finished: load the
 * account, using the document sign-in just read or created (null when sign-in did
 * not create one). components/App.tsx provides it; GoogleSignInButton calls it
 * unless the caller handles sign-in itself.
 */
export const SignedInContext = createContext<((account: UserPreferences | null) => void) | null>(
  null,
)

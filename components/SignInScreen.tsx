'use client'
import { firebaseEnabled } from '@/lib/firebase'
import GoogleSignInButton from './GoogleSignInButton'
import SolaraMark from './SolaraMark'
import m from '@/messages/setup'
import app from '@/messages/app'

/**
 * The landing page's "Sign in": Google sign-in for a returning account, or a way to
 * carry on without one. What sign-in does next comes from the app's SignedInContext.
 */
export default function SignInScreen({ onContinueAsGuest }: { onContinueAsGuest: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col bg-surface px-4 pt-[max(20px,8vh)] pb-8 sm:justify-center sm:py-10">
      <div className="card mx-auto w-full max-w-[420px] text-center sm:px-8 sm:py-7">
        <SolaraMark size={38} className="mx-auto" />
        <h1 className="mt-3 mb-2 text-[22px] leading-tight font-[650] text-ink">
          {m.signInToSolara}
        </h1>
        <p className="mx-auto mb-6 max-w-[300px] text-[14px] leading-normal text-ink-2">
          {m.signInLead}
        </p>
        {firebaseEnabled ? (
          <GoogleSignInButton label={app.continueWithGoogle} size="lg" preload />
        ) : (
          <p role="status" className="text-[13px] text-ink-3">
            {m.signInUnavailable}
          </p>
        )}
        <div className="mt-5 border-t-[0.5px] border-line-strong pt-4">
          <p className="mb-1 text-[13px] text-ink-3">{m.noAccountNeeded}</p>
          <button
            type="button"
            className="btn btn-ghost mx-auto justify-center text-[14px] font-semibold text-accent"
            onClick={onContinueAsGuest}
          >
            {m.continueWithout}
          </button>
        </div>
      </div>
    </main>
  )
}

'use client'
import { firebaseEnabled } from '@/lib/firebase'
import GoogleSignInButton from './GoogleSignInButton'
import SolaraMark from './SolaraMark'

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
          Sign in to Solara
        </h1>
        <p className="mx-auto mb-6 max-w-[300px] text-[14px] leading-normal text-ink-2">
          Pick up your saved plan and sun windows on any device.
        </p>
        {firebaseEnabled ? (
          <GoogleSignInButton label="Continue with Google" size="lg" preload />
        ) : (
          <p role="status" className="text-[13px] text-ink-3">
            Sign-in is not available in this build.
          </p>
        )}
        <div className="mt-5 border-t-[0.5px] border-line-strong pt-4">
          <p className="mb-1 text-[13px] text-ink-3">No account needed to start.</p>
          <button
            type="button"
            className="btn btn-ghost mx-auto justify-center text-[14px] font-semibold text-accent"
            onClick={onContinueAsGuest}
          >
            Continue without signing in →
          </button>
        </div>
      </div>
    </main>
  )
}

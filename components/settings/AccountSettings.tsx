'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import type { TierLevel, UserPreferences } from '@/lib/types'
import { firebaseEnabled } from '@/lib/firebase'
import { signOutAndClear } from '@/lib/session'
import { goToLanding } from '@/lib/app-routes'
import { planLimitRows } from '@/lib/settings'
import { TIER_LIMITS } from '@/lib/tiers'
import GoogleSignInButton from '../GoogleSignInButton'
import { PricingModal } from '../deferred'
import { SettingsCard, SettingsError, SettingsHint } from './SettingsCard'

interface Props {
  tier: TierLevel
  user?: User | null
  /** The preferences as they would be saved now, used to seed a new account. */
  prefs: UserPreferences
  waitlisted: boolean
  onJoinWaitlist: (email: string) => void
  onSignedOut: () => void
}

/** The "Account" section: plan, plan limits, and signing in or out. */
export default function AccountSettings({
  tier,
  user,
  prefs,
  waitlisted,
  onJoinWaitlist,
  onSignedOut,
}: Props) {
  const [showPricing, setShowPricing] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function signOut() {
    setSignOutError(null)
    try {
      await signOutAndClear(user?.uid)
    } catch (error) {
      console.error('Sign-out failed:', error)
      setSignOutError('Could not safely sign out. Check your connection and try again.')
      return
    }
    onSignedOut()
    goToLanding()
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard className="flex items-center justify-between gap-3">
        <div>
          <p className="mb-[3px] text-[12px] text-ink-3">Current plan</p>
          <p
            className={clsx('text-[17px] font-bold', tier === 'paid' ? 'text-accent' : 'text-ink')}
          >
            {tier === 'paid' ? 'Pro' : user ? 'Free' : 'Not signed in'}
          </p>
        </div>
        {tier !== 'paid' && (
          <button
            type="button"
            className="btn btn-primary text-[12px] whitespace-nowrap"
            onClick={() => setShowPricing(true)}
          >
            {waitlisted ? '✓ On waitlist' : 'See Pro plans'}
          </button>
        )}
      </SettingsCard>

      <div className="flex flex-col gap-2 rounded-[10px] bg-surface-metric px-3.5 py-3">
        <p className="text-[12px] font-[650] tracking-[0.06em] text-ink-2 uppercase">Plan limits</p>
        {planLimitRows(tier, prefs.activities.length).map(({ label, value }) => (
          <div key={label} className="flex justify-between text-[13px]">
            <span className="text-ink-2">{label}</span>
            <span className={clsx('font-semibold', value === false ? 'text-ink-3' : 'text-ink')}>
              {typeof value === 'string' ? (
                value
              ) : (
                <>
                  <span aria-hidden="true">{value ? '✓' : '–'}</span>
                  <span className="sr-only">{value ? 'Included' : 'Not included'}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {user ? (
        <div className="flex flex-col gap-2">
          <SettingsCard>
            <p className="mb-0.5 text-[12px] text-ink-3">Signed in as</p>
            <p className="text-[14px] font-semibold text-ink">{user.displayName || user.email}</p>
          </SettingsCard>
          <button
            type="button"
            className="btn justify-center border-danger/30 text-danger"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          {signOutError && <SettingsError>{signOutError}</SettingsError>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <SettingsHint>
            Sign in to track {TIER_LIMITS.free.activities} activities free and sync preferences
            across devices.
          </SettingsHint>
          {firebaseEnabled ? (
            <GoogleSignInButton />
          ) : (
            <p className="text-[12px] text-ink-3 italic">
              Sign-in is not available in this build. Settings stay on this device.
            </p>
          )}
        </div>
      )}

      {showPricing && (
        <PricingModal
          user={user}
          email={user?.email ?? prefs.upgradeInterest?.email ?? ''}
          alreadyWaitlisted={waitlisted}
          onJoinWaitlist={onJoinWaitlist}
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  )
}

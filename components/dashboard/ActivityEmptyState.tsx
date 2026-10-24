import type { UserPreferences } from '@/lib/types'
import GoogleSignInButton, { ACTIVITY_SIGNIN_BLURB } from '../GoogleSignInButton'

/**
 * The Activities section with nothing to show: a sign-in prompt for guests
 * (`onAdd` absent), else a prompt to add the first activity.
 */
export default function ActivityEmptyState({
  prefs,
  onAdd,
}: {
  prefs: UserPreferences
  onAdd?: () => void
}) {
  return (
    <div className="card px-6 py-11 text-center">
      <p className="mb-2.5 text-[30px]">🏃</p>
      <p className="mb-[7px] text-[16px] font-[650] text-ink">
        {onAdd ? 'No activities set up yet' : 'Sign in to track your activities'}
      </p>
      <p className="mb-5 text-[14px] leading-[1.55] text-ink-3">
        {onAdd
          ? 'Add your outdoor activities to see forecast-based, lower-UV planning windows.'
          : `${ACTIVITY_SIGNIN_BLURB} Signing in with Google is free.`}
      </p>
      {onAdd ? (
        <button className="btn btn-primary rounded-xl px-6 py-2.5 text-[14px]" onClick={onAdd}>
          + Add Activity
        </button>
      ) : (
        // GoogleSignInButton takes only a style prop for its outer layout.
        <GoogleSignInButton seedPrefs={prefs} className="mx-auto min-w-[220px]" />
      )}
    </div>
  )
}

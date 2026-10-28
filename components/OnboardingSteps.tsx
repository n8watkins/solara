'use client'
// The four setup steps that components/Onboarding.tsx shows inside its card. The
// card hugs each step: content first, then the primary action right below it, then
// Back, so no step floats in empty space on a tall phone or a wide screen.
import { ArrowLeft, ArrowRight, MapPin, Moon } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { SKIN_OPTIONS } from '@/lib/onboarding'
import SkinSwatch from './SkinSwatch'
import { TIER_LIMITS } from '@/lib/tiers'
import { firebaseEnabled } from '@/lib/firebase'
import type { Location, SkinType, UserPreferences } from '@/lib/types'
import { formatUV, uvBand, uvLabel, type UVBand } from '@/lib/weather'
import DataAttribution from './DataAttribution'
import GoogleSignInButton from './GoogleSignInButton'
import PlaceSearch, { type PlaceSearchMiss } from './PlaceSearch'
import { SkinTypeQuiz } from './deferred'

const PRIMARY = 'btn btn-primary w-full justify-center p-[13px] text-[14px] font-semibold'
const HEADING = 'text-[20px] leading-tight font-[650] text-ink'
const LEAD = 'text-[14px] leading-normal text-ink-2'

function BackButton({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <button
      type="button"
      className="btn btn-ghost mt-2 w-full justify-center text-[13px] text-ink-3"
      onClick={onBack}
    >
      <ArrowLeft size={15} /> Back
    </button>
  )
}

/** Fills from the app's one UV palette (--color-uv-* in app/globals.css). */
const UV_FILL: Record<UVBand, string> = {
  none: 'bg-uv-none',
  low: 'bg-uv-low',
  moderate: 'bg-uv-moderate',
  high: 'bg-uv-high',
  'very-high': 'bg-uv-very-high',
  extreme: 'bg-uv-extreme',
}

export function LocationStep({
  city,
  onCityChange,
  onSelectPlace,
  onMiss,
  onGeolocate,
  loading,
  error,
}: {
  city: string
  onCityChange: (city: string) => void
  onSelectPlace: (location: Location) => void
  onMiss: (reason: PlaceSearchMiss) => void
  onGeolocate: () => void
  loading: boolean
  error: string | null
}) {
  return (
    <>
      <h1 className={clsx(HEADING, 'mb-1.5')}>Where are you?</h1>
      <p className={clsx(LEAD, 'mb-5')}>We&apos;ll show the live UV index for your area.</p>
      <label htmlFor="onboarding-city" className="text-[13px] font-semibold text-ink">
        City or location
      </label>
      <div className="mt-1.5">
        <PlaceSearch
          id="onboarding-city"
          placeholder="Type a city, e.g. Los Angeles"
          value={city}
          onValueChange={onCityChange}
          onSelect={onSelectPlace}
          onMiss={onMiss}
          busy={loading}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-normal text-danger">
          {error}
        </p>
      )}
      <div className="my-4 flex items-center gap-3 text-[12px] text-ink-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line-strong" />
        or
        <span className="h-px flex-1 bg-line-strong" />
      </div>
      <button className={PRIMARY} onClick={onGeolocate} disabled={loading}>
        {loading ? (
          'Detecting…'
        ) : (
          <>
            <MapPin size={16} /> Use my location
          </>
        )}
      </button>
      <DataAttribution compact className="mt-4 text-center text-balance" />
    </>
  )
}

export function UVPreviewStep({
  uv,
  city,
  onContinue,
  onBack,
}: {
  uv: number
  city: string
  onContinue: () => void
  onBack?: () => void
}) {
  return (
    <>
      <div className="flex flex-col items-center pt-2 pb-1 text-center">
        <h1>
          <span className="mb-0.5 block text-[13px] font-normal text-ink-3">
            UV index right now in
          </span>
          <span className="mb-3.5 block text-[16px] font-[650] text-ink">{city}</span>
        </h1>
        {uv < 0.5 ? (
          // After dark (or before sunrise) a giant "0.0 None" says nothing useful.
          <>
            <Moon size={44} strokeWidth={1.75} className="mb-2.5 text-ink-3" />
            <p className="mb-2 text-[30px] leading-none font-[750] text-ink">Sun is down</p>
            <p className="mb-[18px] text-[14px] text-ink-3">UV {formatUV(uv)} right now</p>
          </>
        ) : (
          <>
            <p className="mb-2.5 text-[68px] leading-none font-[750] text-ink">{formatUV(uv)}</p>
            {/* The band in the app's one UV palette, as on the dashboard. */}
            <p
              className={clsx(
                'mb-[18px] inline-block rounded-[20px] px-3.5 py-1 text-[14px] font-medium text-uv-ink',
                UV_FILL[uvBand(uv)],
              )}
            >
              {uvLabel(uv)}
            </p>
          </>
        )}
        <p className="max-w-[320px] text-[14px] leading-[1.55] text-ink-2">
          {uv < 0.5
            ? 'Solara plans around the hours when the sun is up. Next, set your skin type so it can personalize its estimates.'
            : 'Next, set your skin type so Solara can personalize its planning estimates.'}
        </p>
      </div>
      <button className={clsx(PRIMARY, 'mt-5')} onClick={onContinue}>
        Continue <ArrowRight size={16} />
      </button>
      <BackButton onBack={onBack} />
    </>
  )
}

export function SkinStep({
  value,
  onChange,
  onContinue,
  onBack,
}: {
  value: SkinType
  onChange: (skin: SkinType) => void
  onContinue: () => void
  onBack?: () => void
}) {
  const [quizOpen, setQuizOpen] = useState(false)
  return (
    <>
      <h1 className={clsx(HEADING, 'mb-1.5')}>Your skin type</h1>
      <p className={clsx(LEAD, 'mb-4')}>
        Personalizes your estimated burn time. The types follow the Fitzpatrick scale.
      </p>
      <div className="flex flex-col gap-[7px]">
        {SKIN_OPTIONS.map(o => {
          const selected = value === o.value
          return (
            <button
              key={o.value}
              aria-pressed={selected}
              onClick={() => onChange(o.value)}
              // The selected ring is a shadow on top of the hairline border, so
              // choosing an option never shifts the text.
              className={clsx(
                'flex items-center justify-between rounded-[10px] border-[0.5px] px-[13px] py-2.5 text-left',
                selected
                  ? 'border-accent bg-brand/8 shadow-[0_0_0_1px_var(--accent)]'
                  : 'border-line-strong bg-surface-card',
              )}
            >
              <SkinSwatch skin={o.value} size={26} />
              <div className="ml-3 min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">
                  {o.label} <span className="font-normal text-ink-3">· {o.fitzpatrick}</span>
                </p>
                <p className="text-[12px] text-ink-3">{o.desc}</p>
              </div>
              <span className="ml-3 text-[12px] whitespace-nowrap text-ink-3">{o.burnTime}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="btn btn-ghost mt-2.5 w-full justify-center text-[13px] text-accent"
        onClick={() => setQuizOpen(true)}
      >
        Not sure? Answer 5 quick questions
      </button>
      {quizOpen && (
        <SkinTypeQuiz
          onClose={() => setQuizOpen(false)}
          onUse={skin => {
            onChange(skin)
            setQuizOpen(false)
          }}
        />
      )}
      <button className={clsx(PRIMARY, 'mt-3')} onClick={onContinue}>
        Continue <ArrowRight size={16} />
      </button>
      <BackButton onBack={onBack} />
    </>
  )
}

/**
 * The last step. A visitor starts right away as a guest (the plan stays on this
 * device) or signs in free to save it; someone already signed in, whose account has
 * no plan yet, finishes by creating it.
 */
export function FinishStep({
  user,
  answers,
  onStartAsGuest,
  onCreateAccount,
  onSignedIn,
  onBack,
}: {
  user: User | null
  answers: UserPreferences
  onStartAsGuest: () => void
  onCreateAccount: (user: User) => Promise<void>
  onSignedIn: (account: UserPreferences | null) => void
  onBack?: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish(signedInUser: User) {
    setSaving(true)
    setError(null)
    try {
      await onCreateAccount(signedInUser)
    } catch (e) {
      console.error('Account setup failed:', e)
      setError('Could not save your setup. Check your connection and try again.')
      setSaving(false)
    }
  }

  if (user) {
    return (
      <>
        <div className="flex flex-col items-center pt-2 pb-1 text-center">
          <h1 className={clsx(HEADING, 'mb-2')}>Finish setting up</h1>
          <p className={clsx(LEAD, 'max-w-[320px]')}>
            Solara saves your setup to your account
            {user.email ? <> ({user.email})</> : null}, so your sun windows are ready on every
            device.
          </p>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-center text-[12px] text-danger">
            {error}
          </p>
        )}
        <button
          className={clsx(PRIMARY, 'mt-5')}
          onClick={() => void finish(user)}
          disabled={saving}
        >
          {saving ? (
            'Saving…'
          ) : (
            <>
              Finish setup <ArrowRight size={16} />
            </>
          )}
        </button>
        <BackButton onBack={onBack} />
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col items-center pt-2 pb-1 text-center">
        <h1 className={clsx(HEADING, 'mb-2')}>You&apos;re all set</h1>
        <p className={clsx(LEAD, 'max-w-[330px]')}>
          See today&apos;s lower-UV windows now. Your plan stays on this device until you sign in.
        </p>
      </div>
      <button className={clsx(PRIMARY, 'mt-5')} onClick={onStartAsGuest}>
        See today&apos;s plan <ArrowRight size={16} />
      </button>
      {firebaseEnabled && (
        <div className="mt-4 border-t-[0.5px] border-line-strong pt-4">
          <p className="mb-2.5 text-center text-[13px] leading-normal text-ink-2">
            Or sign in free to save your plan, see tomorrow too and plan up to{' '}
            {TIER_LIMITS.free.activities} activities.
          </p>
          <GoogleSignInButton
            label="Continue with Google"
            seedPrefs={answers}
            onSignedIn={(_user, account) => onSignedIn(account)}
            size="lg"
          />
        </div>
      )}
      <BackButton onBack={onBack} />
    </>
  )
}

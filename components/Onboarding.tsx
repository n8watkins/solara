'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { createAccountPrefs, defaultPrefs } from '@/lib/prefs'
import type { UserPreferences, Location, SkinType } from '@/lib/types'
import { locationFromCoordinates, searchLocation } from '@/lib/geocoding'
import {
  ONBOARDING_BACK,
  ONBOARDING_PROGRESS,
  fetchCurrentUV,
  geolocationErrorMessage,
  type OnboardingStep,
} from '@/lib/onboarding'
import { FinishStep, LocationStep, SkinStep, UVPreviewStep } from './OnboardingSteps'

interface Props {
  /** The signed-in account that has no saved plan yet, or null for a visitor. */
  user: User | null
  /**
   * Called once sign-in (or, when already signed in, account creation) has finished,
   * with the saved account document. The app shows whatever the account holds: an
   * account that already existed keeps its own plan.
   */
  onSignedIn: (account: UserPreferences | null) => void
  /** Called with the setup answers when a visitor starts without an account. */
  onStartAsGuest: (answers: UserPreferences) => void
}

/** Setup: location (with a live UV preview), skin type, then start as a guest or sign in. */
export default function Onboarding({ user, onSignedIn, onStartAsGuest }: Props) {
  const [step, setStep] = useState<OnboardingStep>('location')
  const [locLoading, setLocLoad] = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [uvNow, setUvNow] = useState<number | null>(null)
  const [uvCity, setUvCity] = useState('')
  const [skinType, setSkinType] = useState<SkinType>('fair')

  const answers: UserPreferences | null = location
    ? { ...defaultPrefs(location), skinType, onboardingComplete: true }
    : null

  function handleGeolocate() {
    setGeoError(null)
    if (!('geolocation' in navigator)) {
      setGeoError(geolocationErrorMessage(null))
      return
    }
    setLocLoad(true)
    async function resolvePosition(pos: GeolocationPosition) {
      try {
        const loc = await locationFromCoordinates(pos.coords.latitude, pos.coords.longitude)
        setLocation(loc)
        await fetchUVPreview(loc)
      } catch {
        setGeoError(geolocationErrorMessage(2))
      } finally {
        setLocLoad(false)
      }
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      error => {
        setGeoError(geolocationErrorMessage(error.code))
        setLocLoad(false)
      },
      { timeout: 15_000, maximumAge: 10 * 60_000 },
    )
  }

  async function handleCitySearch() {
    if (!cityInput.trim()) return
    setLocLoad(true)
    setGeoError(null)
    try {
      const loc = await searchLocation(cityInput)
      if (!loc) throw new Error('Not found')
      setLocation(loc)
      await fetchUVPreview(loc)
    } catch {
      setGeoError('City not found. Try a different spelling.')
    } finally {
      setLocLoad(false)
    }
  }

  // The live UV is a preview only: when it cannot load, setup moves on to skin type.
  async function fetchUVPreview(loc: Location) {
    try {
      setUvNow(await fetchCurrentUV(loc))
      setUvCity(loc.city)
      setStep('uvpreview')
    } catch {
      setStep('skin')
    }
  }

  const progress = ONBOARDING_PROGRESS[step]
  const back = ONBOARDING_BACK[step]
  const goBack = back ? () => setStep(back) : undefined

  return (
    // The card hugs its content and the column sits near the top on phones (where
    // the keyboard opens) and in the middle on larger screens.
    <main className="flex min-h-dvh flex-col bg-surface px-4 pt-[max(20px,5vh)] pb-8 sm:justify-center sm:py-10">
      <div className="mx-auto w-full max-w-[460px]">
        <div className="pb-4 text-center">
          <span aria-hidden="true" className="text-[26px]">
            ☀️
          </span>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={progress}
            aria-valuetext={`Step ${progress} of 3`}
            className="mt-2.5 flex justify-center gap-1.5"
          >
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className={clsx(
                  'h-1 w-[26px] rounded-[2px]',
                  i <= progress ? 'bg-accent' : 'bg-line-strong opacity-40',
                )}
              />
            ))}
          </div>
        </div>

        <div className="card sm:px-7 sm:py-6">
          {step === 'location' && (
            <LocationStep
              city={cityInput}
              onCityChange={setCityInput}
              onSearch={() => void handleCitySearch()}
              onGeolocate={handleGeolocate}
              loading={locLoading}
              error={geoError}
            />
          )}
          {step === 'uvpreview' && uvNow !== null && (
            <UVPreviewStep
              uv={uvNow}
              city={uvCity}
              onContinue={() => setStep('skin')}
              onBack={goBack}
            />
          )}
          {step === 'skin' && (
            <SkinStep
              value={skinType}
              onChange={setSkinType}
              onContinue={() => setStep('finish')}
              onBack={goBack}
            />
          )}
          {step === 'finish' && answers && (
            <FinishStep
              user={user}
              answers={answers}
              onStartAsGuest={() => onStartAsGuest({ ...answers, tier: 'anonymous' })}
              onCreateAccount={async signedInUser =>
                onSignedIn(await createAccountPrefs(signedInUser.uid, answers))
              }
              onSignedIn={onSignedIn}
              onBack={goBack}
            />
          )}
        </div>
      </div>
    </main>
  )
}

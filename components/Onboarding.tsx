'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { defaultPrefs } from '@/lib/prefs'
import type { UserPreferences, Location, SkinType } from '@/lib/types'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'
import { locationFromCoordinates, searchLocation } from '@/lib/geocoding'
import { ONBOARDING_PROGRESS, fetchCurrentUV, type OnboardingStep } from '@/lib/onboarding'
import { LocationStep, SignInStep, SkinStep, UVPreviewStep } from './OnboardingSteps'

interface Props {
  /**
   * Called once sign-in has finished, with the saved account document. The answers
   * never go to the app directly: they only seed a brand-new account
   * (GoogleSignInButton's `seedPrefs`), and the app shows whatever the account holds.
   */
  onComplete: (account: UserPreferences | null) => void
  user?: User | null
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<OnboardingStep>('location')
  const [locLoading, setLocLoad] = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [uvNow, setUvNow] = useState<number | null>(null)
  const [uvCity, setUvCity] = useState('')
  const [skinType, setSkinType] = useState<SkinType>('fair')

  // Setup never scrolls - lock the page while onboarding is mounted (shared,
  // ref-counted hook so it composes with any other overlay's lock).
  useBodyScrollLock()

  const collected: UserPreferences | null = location
    ? { ...defaultPrefs(location), skinType, tier: 'free', onboardingComplete: true }
    : null

  async function handleGeolocate() {
    setLocLoad(true)
    setGeoError(null)
    async function resolvePosition(pos: GeolocationPosition) {
      const loc = await locationFromCoordinates(pos.coords.latitude, pos.coords.longitude)
      setLocation(loc)
      setLocLoad(false)
      await fetchUVPreview(loc)
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      () => {
        setGeoError('Location access denied. Type a city below.')
        setLocLoad(false)
      },
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

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-surface p-4">
      <div className="mx-auto flex min-h-0 w-full max-w-[460px] flex-1 flex-col">
        <div className="shrink-0 pt-1.5 pb-3.5 text-center">
          <span className="text-[26px]">☀️</span>
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

        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 'location' && (
            <LocationStep
              city={cityInput}
              onCityChange={setCityInput}
              onSearch={() => void handleCitySearch()}
              onGeolocate={() => void handleGeolocate()}
              loading={locLoading}
              error={geoError}
            />
          )}
          {step === 'uvpreview' && uvNow !== null && (
            <UVPreviewStep uv={uvNow} city={uvCity} onContinue={() => setStep('skin')} />
          )}
          {step === 'skin' && (
            <SkinStep
              value={skinType}
              onChange={setSkinType}
              onContinue={() => setStep('signin')}
            />
          )}
          {step === 'signin' && (
            <SignInStep
              seedPrefs={collected}
              onSignedIn={onComplete}
              onBack={() => setStep('skin')}
            />
          )}
        </div>
      </div>
    </main>
  )
}

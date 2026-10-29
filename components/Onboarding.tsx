'use client'
import { useEffect, useEffectEvent, useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import { createAccountPrefs, defaultPrefs } from '@/lib/prefs'
import type { UserPreferences, Location, SkinType } from '@/lib/types'
import { CITY_PARAM, cityParam, loadCityLocation } from '@/lib/city-preset'
import { locationFromCoordinates } from '@/lib/geocoding'
import { sunPhaseAt } from '@solara/core'
import { isValidTimeZone } from '@/lib/time'
import {
  ONBOARDING_BACK,
  ONBOARDING_PROGRESS,
  fetchCurrentUV,
  geolocationErrorMessage,
  type OnboardingStep,
} from '@/lib/onboarding'
import { FinishStep, LocationStep, SkinStep, UVPreviewStep } from './OnboardingSteps'
import type { PlaceSearchMiss } from './PlaceSearch'
import SolaraMark from './SolaraMark'

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
  // A city page's link (/app/?city=<slug>, lib/city-preset.ts) starts setup on that city.
  const [initialCity] = useState(() => cityParam(window.location.search))
  const [step, setStep] = useState<OnboardingStep>('location')
  // A city page's city shows as loading until it is chosen, not as an empty search.
  const [locLoading, setLocLoad] = useState(!!initialCity)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [uvNow, setUvNow] = useState<number | null>(null)
  const [uvCity, setUvCity] = useState('')
  const [uvSunUp, setUvSunUp] = useState(false)
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

  async function handlePlaceChosen(loc: Location) {
    setGeoError(null)
    setLocLoad(true)
    try {
      setLocation(loc)
      await fetchUVPreview(loc)
    } finally {
      setLocLoad(false)
    }
  }

  // A city page's link: choose its city as if picked from the suggestions. An
  // unknown city, or a list that cannot load, leaves setup on the location step.
  const startWithCity = useEffectEvent((loc: Location) => void handlePlaceChosen(loc))
  useEffect(() => {
    if (!initialCity) return
    // Read once: drop it from the address so a reload starts setup afresh.
    const url = new URL(window.location.href)
    url.searchParams.delete(CITY_PARAM)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    let active = true
    loadCityLocation(initialCity).then(
      loc => {
        if (!active) return
        if (loc) startWithCity(loc)
        else setLocLoad(false)
      },
      () => {
        if (active) setLocLoad(false)
      },
    )
    return () => {
      active = false
    }
  }, [initialCity])

  function handlePlaceMiss(reason: PlaceSearchMiss) {
    setGeoError(
      reason === 'none'
        ? 'City not found. Try a different spelling.'
        : "Place search isn't answering right now. Try again in a moment, or use your location.",
    )
  }

  // The live UV is a preview only: when it cannot load, setup moves on to skin type.
  async function fetchUVPreview(loc: Location) {
    try {
      setUvNow(await fetchCurrentUV(loc))
      setUvCity(loc.city)
      // Whether the sun is up there now; a place without a known zone falls back to the UV.
      setUvSunUp(
        isValidTimeZone(loc.timezone) && sunPhaseAt(loc, loc.timezone, Date.now()) === 'up',
      )
      setStep('uvpreview')
    } catch {
      setStep('skin')
    }
  }

  const progress = ONBOARDING_PROGRESS[step]
  const back = ONBOARDING_BACK[step]
  const goBack = back ? () => setStep(back) : undefined

  return (
    // The card hugs its content and sits in the middle of the screen, except for the
    // location step on phones, which stays near the top where the keyboard opens.
    <main
      className={clsx(
        'flex min-h-dvh flex-col bg-surface px-4 py-8 sm:justify-center sm:py-10',
        step === 'location' ? 'pt-[max(20px,5vh)]' : 'justify-center',
      )}
    >
      <div className="mx-auto w-full max-w-[460px]">
        <div className="flex flex-col items-center pb-4">
          {/* A full page load on purpose: the landing page is static HTML with no app
              code, and next/link would add its router to every guest's first load. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[17px] font-bold text-ink no-underline"
          >
            <SolaraMark size={22} />
            Solara
          </a>
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
                  i <= progress ? 'bg-accent' : 'bg-ink-3/35',
                )}
              />
            ))}
          </div>
        </div>

        <div className="card sm:px-7 sm:py-6">
          {step === 'location' && (
            <LocationStep
              city={cityInput}
              onCityChange={city => {
                setCityInput(city)
                setGeoError(null)
              }}
              onSelectPlace={loc => void handlePlaceChosen(loc)}
              onMiss={handlePlaceMiss}
              onGeolocate={handleGeolocate}
              loading={locLoading}
              error={geoError}
            />
          )}
          {step === 'uvpreview' && uvNow !== null && (
            <UVPreviewStep
              uv={uvNow}
              city={uvCity}
              sunUp={uvSunUp}
              onContinue={() => setStep('skin')}
              onBack={goBack}
            />
          )}
          {step === 'skin' && (
            <SkinStep
              value={skinType}
              uvNow={uvNow}
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

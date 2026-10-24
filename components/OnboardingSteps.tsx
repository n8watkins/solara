'use client'
// The four setup steps that components/Onboarding.tsx shows inside its card. Each
// step fills the card; its primary action sits at the bottom, in the thumb zone.
import clsx from 'clsx'
import { SKIN_OPTIONS } from '@/lib/onboarding'
import type { SkinType, UserPreferences } from '@/lib/types'
import { uvBand, uvLabel, type UVBand } from '@/lib/weather'
import GoogleSignInButton from './GoogleSignInButton'

const PRIMARY = 'btn btn-primary w-full justify-center p-[13px]'
const HEADING = 'text-[19px] font-[650] text-ink'

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
  onSearch,
  onGeolocate,
  loading,
  error,
}: {
  city: string
  onCityChange: (city: string) => void
  onSearch: () => void
  onGeolocate: () => void
  loading: boolean
  error: string | null
}) {
  return (
    <>
      <h1 className={clsx(HEADING, 'mb-1.5')}>Where are you?</h1>
      <p className="mb-[18px] text-[14px] leading-normal text-ink-2">
        We&apos;ll show the live UV index for your area.
      </p>
      <label htmlFor="onboarding-city" className="mb-1.5 text-[13px] font-semibold text-ink">
        City or location
      </label>
      <div className="mt-1 mb-3.5 flex items-center gap-2">
        <input
          id="onboarding-city"
          placeholder="Type a city, e.g. Los Angeles"
          value={city}
          onChange={e => onCityChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSearch()
          }}
          className="flex-1"
        />
        <button className="btn" onClick={onSearch} disabled={loading}>
          Go
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-2 text-[12px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-auto">
        <button className={PRIMARY} onClick={onGeolocate} disabled={loading}>
          {loading ? 'Detecting…' : '📍 Use my location'}
        </button>
      </div>
    </>
  )
}

export function UVPreviewStep({
  uv,
  city,
  onContinue,
}: {
  uv: number
  city: string
  onContinue: () => void
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <h1>
          <span className="mb-0.5 block text-[13px] font-normal text-ink-3">
            UV index right now in
          </span>
          <span className="mb-3.5 block text-[16px] font-[650] text-ink">{city}</span>
        </h1>
        <p className="mb-2.5 text-[68px] leading-none font-[750] text-ink">{uv.toFixed(1)}</p>
        {/* The band in the app's one UV palette, as on the dashboard. */}
        <p
          className={clsx(
            'mb-[18px] inline-block rounded-[20px] px-3.5 py-1 text-[14px] font-medium text-uv-ink',
            UV_FILL[uvBand(uv)],
          )}
        >
          {uvLabel(uv)}
        </p>
        <p className="text-[14px] leading-[1.55] text-ink-2">
          Next, set your skin type so Solara can personalize its planning estimates.
        </p>
      </div>
      <button className={clsx(PRIMARY, 'mt-3.5')} onClick={onContinue}>
        Continue →
      </button>
    </>
  )
}

export function SkinStep({
  value,
  onChange,
  onContinue,
}: {
  value: SkinType
  onChange: (skin: SkinType) => void
  onContinue: () => void
}) {
  return (
    <>
      <h1 className={clsx(HEADING, 'mb-1')}>Your skin type</h1>
      <p className="mb-3.5 text-[13px] text-ink-2">
        Personalizes estimated burn time and planning UV limits.
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
              <div>
                <p className="text-[14px] font-semibold text-ink">{o.label}</p>
                <p className="text-[12px] text-ink-3">{o.desc}</p>
              </div>
              <span className="ml-3 text-[12px] whitespace-nowrap text-ink-3">{o.burnTime}</span>
            </button>
          )
        })}
      </div>
      <button className={clsx(PRIMARY, 'mt-auto')} onClick={onContinue}>
        Continue →
      </button>
    </>
  )
}

export function SignInStep({
  seedPrefs,
  onSignedIn,
  onBack,
}: {
  seedPrefs: UserPreferences | null
  onSignedIn: (account: UserPreferences | null) => void
  onBack: () => void
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <span className="mb-3 text-[34px]">🔒</span>
        <h1 className="mb-2 text-[20px] font-[650] text-ink">Sign in to finish</h1>
        <p className="max-w-[300px] text-[14px] leading-[1.55] text-ink-2">
          Solara saves your setup to your account so your sun windows are ready on every device.
        </p>
      </div>
      <div className="mt-3.5">
        <GoogleSignInButton
          label="Continue with Google"
          seedPrefs={seedPrefs}
          onSignedIn={(_user, account) => onSignedIn(account)}
          size="lg"
        />
        <button
          className="btn btn-ghost mt-2 w-full justify-center text-[13px] text-ink-3"
          onClick={onBack}
        >
          ← Back
        </button>
      </div>
    </>
  )
}

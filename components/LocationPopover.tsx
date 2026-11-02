'use client'
import { MapPin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Location } from '@/lib/types'
import { useOutsideClick } from '@/lib/use-outside-click'
import { LocationPanel } from './deferred'

interface Props {
  location: Location
  savedLocations: Location[]
  /** Max saved shortcuts for the current tier. */
  limit: number
  onApply: (next: { location: Location; savedLocations: Location[] }) => void
}

/** The header's place button; its panel (components/LocationPanel.tsx) loads on demand. */
export default function LocationPopover({ location, savedLocations, limit, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useOutsideClick(ref, open, () => setOpen(false))

  // Escape closes the panel and returns focus to the place button, as the account menu
  // and the profile switcher do. The place search's own Escape (closing its suggestion
  // list) comes first: it marks the key handled, and only a second Escape gets here.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        title={location.city}
        className="flex max-w-full min-w-0 items-center gap-1 rounded-md px-[7px] py-[3px] max-sm:px-1 text-[13px] text-ink-3 transition-colors duration-100 hover:bg-surface-metric"
        onClick={() => setOpen(o => !o)}
      >
        <MapPin size={14} className="shrink-0" />
        {/* One line at every width, so the header keeps its single row: a name too long
            for the room the controls leave ends in an ellipsis, and the full name stays
            the button's accessible name and its title. */}
        <span className="min-w-0 truncate leading-[1.25]" data-testid="header-place-name">
          {location.city}
        </span>
      </button>

      {open && (
        <LocationPanel
          location={location}
          savedLocations={savedLocations}
          limit={limit}
          onApply={onApply}
          anchorRef={ref}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

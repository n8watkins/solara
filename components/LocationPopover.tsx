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
        className="flex max-w-full items-center gap-1 rounded-md px-[7px] py-[3px] text-[13px] text-ink-3 transition-colors duration-100 hover:bg-surface-metric"
        onClick={() => setOpen(o => !o)}
      >
        <MapPin size={14} className="shrink-0" />
        {/* A long name takes a second line on a narrow phone instead of being cut off
            ("San Luis O..."); past two lines it ends in an ellipsis. */}
        <span
          className="line-clamp-2 text-left leading-[1.25] break-words"
          data-testid="header-place-name"
        >
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

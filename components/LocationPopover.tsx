'use client'
import { MapPin, Plane } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import type { PlaceControls } from '@/lib/places'
import { useOutsideClick } from '@/lib/use-outside-click'
import { LocationPanel } from './deferred'
import t from '@/messages/app'

/**
 * The header's place name, which opens the place menu (components/LocationPanel.tsx, on
 * demand). During a visit (ROADMAP item 53) it shows a plane in the accent colour and
 * tells a screen reader where home is.
 */
export default function LocationPopover({ places }: { places: PlaceControls }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useOutsideClick(ref, open, () => setOpen(false))
  const { shown, home, visiting } = places

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

  function close({ refocus }: { refocus: boolean }) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={visiting ? t.visitingPlace(shown.city, home.city) : undefined}
        title={visiting ? t.visitingPlace(shown.city, home.city) : shown.city}
        data-visiting={visiting || undefined}
        className={clsx(
          'flex max-w-full min-w-0 items-center gap-1 rounded-md px-[7px] py-[3px] text-[13px] transition-colors duration-100 max-sm:px-1',
          visiting
            ? 'bg-accent-soft font-semibold text-accent hover:brightness-95'
            : 'text-ink-3 hover:bg-surface-metric',
        )}
        onClick={() => setOpen(o => !o)}
      >
        {visiting ? (
          <Plane size={14} className="shrink-0" aria-hidden="true" />
        ) : (
          <MapPin size={14} className="shrink-0" aria-hidden="true" />
        )}
        {/* One line at every width, so the header keeps its single row: a name too long
            for the room the controls leave ends in an ellipsis, and the full name stays
            the button's accessible name and its title. During a visit the name says where
            home is too. */}
        <span className="min-w-0 truncate leading-[1.25]" data-testid="header-place-name">
          {shown.city}
        </span>
      </button>

      {open && <LocationPanel id={panelId} places={places} anchorRef={ref} onClose={close} />}
    </div>
  )
}

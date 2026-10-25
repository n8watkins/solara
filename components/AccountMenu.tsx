'use client'
import { LogOut, Settings, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { User } from 'firebase/auth'
import clsx from 'clsx'
import { accountInitial } from '@/lib/header-display'
import { nextIndex } from '@/lib/roving-focus'
import { useOutsideClick } from '@/lib/use-outside-click'

/** The account menu's items, in order. */
function menuItems(list: HTMLElement | null): HTMLElement[] {
  return Array.from(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

/** What the account menu shows of the account: a Firebase User, or Auth's stored copy. */
export type AccountIdentity = Pick<User, 'displayName' | 'email' | 'photoURL'>

interface Props {
  user: AccountIdentity
  onOpenSettings: () => void
  onSignOut: () => void
}

/**
 * The avatar button and its menu (Settings, Account & billing, Sign out), with
 * the WAI-ARIA menu button keyboard pattern.
 */
export default function AccountMenu({ user, onOpenSettings, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  // Which item takes focus when the menu opens (menu button pattern).
  const [focus, setFocus] = useState<'first' | 'last'>('first')
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useOutsideClick(rootRef, open, () => setOpen(false))

  // Escape closes the menu and returns focus to the menu button.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // An opened menu moves focus to its first (or, from ArrowUp, last) item.
  useEffect(() => {
    if (!open) return
    const items = menuItems(listRef.current)
    ;(focus === 'last' ? items.at(-1) : items[0])?.focus()
  }, [open, focus])

  function openMenu(at: 'first' | 'last') {
    setFocus(at)
    setOpen(true)
  }

  function onButtonKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    openMenu(e.key === 'ArrowUp' ? 'last' : 'first')
  }

  // Arrow keys move between items (wrapping), Home and End jump to the ends,
  // Space activates the link item like a button, and Tab leaves the menu.
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems(listRef.current)
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Tab') {
      // Tab then moves on from the menu button, as if the menu were not there.
      buttonRef.current?.focus()
      setOpen(false)
      return
    }
    if (e.key === ' ' && e.target instanceof HTMLAnchorElement) {
      e.preventDefault()
      e.target.click()
      return
    }
    const next = nextIndex(e.key, index, items.length)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        id="account-menu-button"
        onClick={() => (open ? setOpen(false) : openMenu('first'))}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        aria-label="Account menu"
        title={user.displayName ?? user.email ?? 'Account'}
        className={clsx(
          'flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[0.5px] border-line-strong p-0',
          user.photoURL ? 'bg-surface-metric' : 'bg-accent',
        )}
      >
        {user.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element -- Remote account avatar in a static export with images.unoptimized; next/image would add nothing.
          <img
            src={user.photoURL}
            alt={user.displayName ?? 'Account'}
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <span className="text-[14px] leading-none font-bold text-accent-on">
            {accountInitial(user)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 z-40 max-w-[calc(100vw-24px)] min-w-[200px] overflow-hidden rounded-xl border-[0.5px] border-line-strong bg-surface-card p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.22)]">
          {(user.email || user.displayName) && (
            <div className="mb-1 border-b-[0.5px] border-line-strong px-2.5 pt-2 pb-2.5">
              {user.displayName && (
                <p className="truncate text-[13px] font-[650] text-ink">{user.displayName}</p>
              )}
              {user.email && (
                <p
                  className={clsx('truncate text-[12px] text-ink-3', user.displayName && 'mt-0.5')}
                >
                  {user.email}
                </p>
              )}
            </div>
          )}
          <div
            ref={listRef}
            id="account-menu"
            role="menu"
            aria-labelledby="account-menu-button"
            onKeyDown={onMenuKeyDown}
          >
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="hdr-menu-item"
            >
              <Settings size={16} /> Settings
            </button>
            <a
              role="menuitem"
              tabIndex={-1}
              href="/account/"
              className="hdr-menu-item no-underline"
            >
              <UserRound size={16} /> Account & billing
            </a>
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              className="hdr-menu-item text-danger"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

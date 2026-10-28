'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject, SyntheticEvent } from 'react'
import clsx from 'clsx'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'

interface Props {
  /**
   * Called when the user asks to close the dialog: Escape, the platform close
   * request (for example the Android back gesture) or a click on the backdrop.
   * The parent decides whether to unmount; a dialog with unsaved changes can
   * confirm first and simply ignore the request.
   */
  onClose: () => void
  /** id of the visible title. Prefer this over `label`. */
  labelledBy?: string
  /** Accessible name when there is no visible title. */
  label?: string
  describedBy?: string
  /**
   * `card` is a centered panel sized to its content. `sheet` has a fixed height
   * on desktop and fills the whole screen on phones, for long multi-section
   * content such as Settings. `narrow` is a card for a single column of choices.
   */
  variant?: 'card' | 'narrow' | 'sheet'
  children: ReactNode
}

// The <dialog> element is the panel itself; the browser draws ::backdrop
// behind it in the top layer. Only an open dialog gets a layout, so a closed
// one keeps the UA `display: none`. The 16 px gutter on every side keeps the
// page visible around a card.
const PANEL =
  'm-auto box-border w-[calc(100%-32px)] overflow-hidden rounded-[20px] border-[0.5px] border-line-strong bg-surface-card p-0 text-ink shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop:bg-black/45 focus:outline-none open:flex open:flex-col'

const VARIANTS = {
  card: 'max-h-[min(88vh,760px)] max-w-[820px]',
  narrow: 'max-h-[min(88vh,760px)] max-w-[560px]',
  // Fixed height on desktop so switching sections does not resize the panel;
  // the whole screen on phones so options are not trapped in a small box.
  sheet:
    'h-[min(88vh,720px)] max-h-[calc(100%-32px)] max-w-[860px] max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:shadow-none',
}

/**
 * The one modal dialog primitive. It renders a native `<dialog>` opened with
 * `showModal()`, so the browser provides the top layer, the backdrop, the
 * focus trap and inertness of the rest of the page. On top of that it routes
 * every close request through `onClose`, locks body scroll, and returns focus
 * to the element that opened it.
 *
 * Mount it to open, unmount it to close.
 */
export default function Dialog({
  onClose,
  labelledBy,
  label,
  describedBy,
  variant = 'card',
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const pointerDownOnBackdrop = useRef(false)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })
  useBodyScrollLock()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Opening in a layout effect keeps the closed dialog from ever painting.
    if (!dialog.open) dialog.showModal()
    // Start on the dialog itself rather than its first control: screen
    // readers announce the title, and the close button does not light up
    // with a focus ring the moment the dialog opens. Tab moves inside.
    dialog.focus()

    // The browser can still close the dialog on its own: Chrome lets a second
    // close request through without user activation in between. Keep the
    // parent's state in sync instead of leaving an invisible dialog mounted.
    let closingFromUnmount = false
    const handleNativeClose = () => {
      if (closingFromUnmount) return
      onCloseRef.current()
      // The parent may decline (for example, unsaved changes it wants to
      // keep). If it is still mounted a frame later, reopen it.
      requestAnimationFrame(() => {
        if (!closingFromUnmount && dialog.isConnected && !dialog.open) dialog.showModal()
      })
    }
    dialog.addEventListener('close', handleNativeClose)

    return () => {
      closingFromUnmount = true
      dialog.removeEventListener('close', handleNativeClose)
      if (dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    // Handle Escape ourselves: preventing the key's default stops the native
    // close, so a dialog with unsaved changes can ask before it goes away.
    // Stopping propagation keeps a parent dialog (React bubbles through
    // portals and nested trees) from closing as well.
    event.preventDefault()
    event.stopPropagation()
    onCloseRef.current()
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // A close request we cannot veto ends in a native `close` event, which is
    // handled above; only route the cancelable ones here to avoid asking twice.
    // React bubbles `cancel` through the component tree, so a nested dialog
    // must not let its parent see it.
    event.stopPropagation()
    if (!event.cancelable) return
    event.preventDefault()
    onCloseRef.current()
  }

  function isBackdrop(event: MouseEvent<HTMLDialogElement>) {
    const dialog = ref.current
    if (!dialog || event.target !== dialog) return false
    const rect = dialog.getBoundingClientRect()
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
  }

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={clsx(PANEL, VARIANTS[variant])}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      // A drag that starts inside the panel and ends on the backdrop is a text
      // selection, not a dismissal, so both ends must be on the backdrop.
      onPointerDown={event => {
        pointerDownOnBackdrop.current = isBackdrop(event)
      }}
      onClick={event => {
        if (pointerDownOnBackdrop.current && isBackdrop(event)) onCloseRef.current()
        pointerDownOnBackdrop.current = false
      }}
    >
      {children}
    </dialog>
  )
}

/**
 * Scrollable regions must be reachable by keyboard (WCAG 2.1.1). While the
 * element overflows it is a tab stop, so arrow keys can scroll it even when
 * it holds no focusable content; otherwise it stays out of the tab order.
 * The element's single child is the content wrapper whose size is watched.
 */
export function useKeyboardScrollable(ref: RefObject<HTMLElement | null>) {
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setScrollable(el.scrollHeight > el.clientHeight + 1)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [ref])
  return scrollable ? 0 : undefined
}

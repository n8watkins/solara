'use client'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'solara_install_dismissed'

/** The iOS share glyph (box with an up-arrow) so the instruction reads at a glance. */
function ShareIcon() {
  return (
    <svg
      width="11"
      height="13"
      viewBox="0 0 16 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'inline', verticalAlign: '-1px' }}
    >
      <path d="M8 1.5 V11" />
      <path d="M5 4 L8 1 L11 4" />
      <path d="M4 8 H2.5 A1.5 1.5 0 0 0 1 9.5 V16.5 A1.5 1.5 0 0 0 2.5 18 H13.5 A1.5 1.5 0 0 0 15 16.5 V9.5 A1.5 1.5 0 0 0 13.5 8 H12" />
    </svg>
  )
}

/**
 * "Add to home screen" prompt. Two paths:
 *  - Chromium (Android/desktop): capture the deferred `beforeinstallprompt` event
 *    and offer a one-tap Install button.
 *  - iOS Safari: that event never fires and install can't be triggered
 *    programmatically, so surface the manual Share, then Add to Home Screen
 *    instructions instead.
 * Hidden if already installed (standalone), already dismissed, or unsupported.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<'chromium' | 'ios' | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already installed (running standalone) → never prompt.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone
    if (standalone) return
    if (localStorage.getItem(DISMISS_KEY)) return

    // iOS (incl. iPadOS 13+, which reports as MacIntel with a touch screen) never
    // fires beforeinstallprompt, and only Safari can add to the Home Screen. Show
    // manual instructions for that case.
    const ua = window.navigator.userAgent
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)
    if (isIOSSafari) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
      setMode('ios')
      return
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setMode('chromium')
    }
    const onInstalled = () => {
      setMode(null)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setMode(null)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {}
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setMode(null)
    setDeferred(null)
  }

  if (!mode) return null

  const wrap: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    borderRadius: '12px',
    marginBottom: '16px',
    background: 'rgba(249,115,22,0.08)',
    border: '0.5px solid rgba(249,115,22,0.25)',
  }
  const dismissBtn: CSSProperties = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-3)',
    fontSize: '18px',
    padding: '0 4px',
    flexShrink: 0,
  }

  if (mode === 'ios') {
    return (
      <div style={wrap}>
        <span style={{ fontSize: '22px', flexShrink: 0 }}>☀️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
            Add Solara to your home screen
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
            Tap <ShareIcon /> Share, then <strong>Add to Home Screen</strong> to open Solara in one
            tap.
          </p>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" style={dismissBtn}>
          ×
        </button>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <span style={{ fontSize: '22px', flexShrink: 0 }}>☀️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
          Add Solara to your home screen
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
          One tap each morning to check your sun window.
        </p>
      </div>
      <button
        className="btn btn-primary"
        onClick={() => void install()}
        style={{ fontSize: '13px', padding: '8px 14px', flexShrink: 0 }}
      >
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" style={dismissBtn}>
        ×
      </button>
    </div>
  )
}

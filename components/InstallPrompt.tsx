'use client'
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'solara_install_dismissed'

/**
 * Custom "Add to home screen" prompt. Captures the browser's deferred
 * beforeinstallprompt event and surfaces a branded banner — installing Solara
 * to the home screen is the strongest daily-return lever for a morning UV check.
 * Stays hidden if already installed, already dismissed, or unsupported (iOS).
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already installed (running standalone) → never prompt.
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone
    if (standalone) return
    if (localStorage.getItem(DISMISS_KEY)) return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setVisible(false)
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
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setVisible(false)
    setDeferred(null)
  }

  if (!visible) return null

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 14px', borderRadius: '12px', marginBottom: '16px',
        background: 'rgba(249,115,22,0.08)', border: '0.5px solid rgba(249,115,22,0.25)',
      }}
    >
      <span style={{ fontSize: '22px', flexShrink: 0 }}>☀️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>Add Solara to your home screen</p>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>One tap each morning to check your sun window.</p>
      </div>
      <button className="btn btn-primary" onClick={install} style={{ fontSize: '13px', padding: '8px 14px', flexShrink: 0 }}>Install</button>
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '18px', padding: '0 4px', flexShrink: 0 }}>×</button>
    </div>
  )
}

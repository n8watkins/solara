'use client'
import { useState } from 'react'
import type { UserPreferences } from '@/lib/types'
import { isFeedConfigured, randomFeedToken, buildFeedUrl } from '@/lib/feed'

interface Props {
  prefs: UserPreferences
  onPrefsUpdate: (prefs: UserPreferences) => void
}

/**
 * Live calendar feed (P7b). Lets a signed-in user subscribe their calendar app to a
 * stable URL that re-fetches as the forecast changes — unlike the one-shot .ics export.
 * Requires the Cloud Function (Blaze) to be deployed AND a uid, because the per-user
 * token must be persisted to Firestore for the function to resolve the feed.
 */
export default function CalendarFeed({ prefs, onPrefsUpdate }: Props) {
  const [copied, setCopied] = useState(false)

  // Ops-gated (no functions URL) or anonymous (token never reaches Firestore) → hide.
  if (!isFeedConfigured() || !prefs.uid) return null

  const token = prefs.calendarFeedToken
  const url = token ? buildFeedUrl(token) : null

  function enable() {
    onPrefsUpdate({ ...prefs, calendarFeedToken: randomFeedToken() })
  }

  function regenerate() {
    if (!confirm('Regenerate the feed link? Your existing subscription will stop updating until you re-subscribe with the new link.')) return
    onPrefsUpdate({ ...prefs, calendarFeedToken: randomFeedToken() })
    setCopied(false)
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the field is selectable as a fallback */ }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '10px', marginBottom: '12px', background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)' }}>
      <span style={{ fontSize: '16px', flexShrink: 0 }}>🔄</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!url ? (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>
              Subscribe your calendar to a live sun-plan feed that updates as the forecast changes.
            </p>
            <button className="btn" onClick={enable} style={{ marginTop: '8px', fontSize: '12px' }}>
              Create feed link
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>
              Add this URL in your calendar app as a subscribed calendar (Google/Apple/Outlook):
            </p>
            <input
              type="text"
              readOnly
              value={url}
              onFocus={e => e.currentTarget.select()}
              style={{ marginTop: '8px', width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '7px 9px', borderRadius: '8px', border: '0.5px solid var(--border-md)', background: 'var(--bg)', color: 'var(--text-2)' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => void copy()} style={{ fontSize: '12px' }}>
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
              <button className="btn" onClick={regenerate} style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                Regenerate
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
              Anyone with this link can see your plan — keep it private. Regenerate to revoke.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase'
import type { FeedTokenState } from '@/lib/feed'
import {
  buildFeedUrl,
  isFeedConfigured,
  revokeFeedToken,
  rotateFeedToken,
  watchFeedToken,
} from '@/lib/feed'
import type { UserPreferences } from '@/lib/types'

interface Props {
  prefs: UserPreferences
  /** Not used: the feed token is server-owned now. Kept so existing call sites compile. */
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

type Busy = 'create' | 'regenerate' | 'revoke' | null

/**
 * Live calendar feed. Lets a signed-in user subscribe their calendar app to a stable URL
 * that re-fetches as the forecast changes, unlike the one-shot .ics export. The server
 * mints and stores the link's token; this component only shows, rotates or revokes it.
 */
export default function CalendarFeed({ prefs }: Props) {
  const uid = prefs.uid
  const configured = isFeedConfigured() && !!uid

  // Hidden when the Functions are not deployed or nobody is signed in.
  if (!configured) return null
  return <CalendarFeedPanel key={uid} uid={uid} />
}

function CalendarFeedPanel({ uid }: { uid: string }) {
  const [feed, setFeed] = useState<FeedTokenState>({ status: 'loading' })
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(
    () =>
      watchFeedToken(uid, setFeed, () =>
        setMessage('Could not load your feed link. Reload to try again.'),
      ),
    [uid],
  )

  const token = feed.status === 'ready' ? feed.token : null
  const url = token ? buildFeedUrl(token) : null

  function currentUser() {
    const user = auth?.currentUser
    if (!user || user.uid !== uid) throw new Error('Sign in again to manage your feed.')
    return user
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>) {
    setBusy(kind)
    setMessage('')
    setCopied(false)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  function create() {
    void run('create', () => rotateFeedToken(currentUser()))
  }

  function regenerate() {
    if (
      !confirm(
        'Regenerate the feed link? Your existing subscription will stop updating until you re-subscribe with the new link.',
      )
    )
      return
    void run('regenerate', () => rotateFeedToken(currentUser()))
  }

  function revoke() {
    if (!confirm('Turn off the feed? Calendars subscribed to this link will stop updating.')) return
    void run('revoke', () => revokeFeedToken(currentUser()))
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked - the field is selectable as a fallback */
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '10px',
        marginBottom: '12px',
        background: 'var(--bg-metric)',
        border: '0.5px solid var(--border-md)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '16px', flexShrink: 0 }}>
        🔄
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {feed.status === 'loading' ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>
            Loading your calendar feed...
          </p>
        ) : !url ? (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>
              Subscribe your calendar to a live sun-plan feed that updates as the forecast changes.
            </p>
            <button
              className="btn"
              onClick={create}
              disabled={busy !== null}
              style={{ marginTop: '8px', fontSize: '12px' }}
            >
              {busy === 'create' ? 'Creating...' : 'Create feed link'}
            </button>
          </>
        ) : (
          <>
            <label
              htmlFor="calendar-feed-url"
              style={{ display: 'block', margin: 0, fontSize: '13px', color: 'var(--text-2)' }}
            >
              Add this URL in your calendar app as a subscribed calendar (Google/Apple/Outlook):
            </label>
            <input
              id="calendar-feed-url"
              type="text"
              readOnly
              value={url}
              onFocus={e => e.currentTarget.select()}
              style={{
                marginTop: '8px',
                width: '100%',
                boxSizing: 'border-box',
                fontSize: '12px',
                padding: '7px 9px',
                borderRadius: '8px',
                border: '0.5px solid var(--border-md)',
                background: 'var(--bg)',
                color: 'var(--text-2)',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={() => void copy()}
                disabled={busy !== null}
                style={{ fontSize: '12px' }}
              >
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
              <button
                className="btn"
                onClick={regenerate}
                disabled={busy !== null}
                style={{ fontSize: '12px', color: 'var(--text-3)' }}
              >
                {busy === 'regenerate' ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button
                className="btn"
                onClick={revoke}
                disabled={busy !== null}
                style={{ fontSize: '12px', color: 'var(--text-3)' }}
              >
                {busy === 'revoke' ? 'Turning off...' : 'Turn off'}
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
              Anyone with this link can see your plan - keep it private. Regenerate to revoke it.
            </p>
          </>
        )}
        {message && (
          <p role="status" style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-2)' }}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
